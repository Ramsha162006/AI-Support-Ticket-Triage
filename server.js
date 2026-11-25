import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createMemoryStore } from './db/memoryStore.js';
import { createMysqlStore, isMysqlConfigured } from './db/mysqlStore.js';
import { createRedisCache } from './db/redisCache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_CATEGORIES = ['Billing', 'Technical', 'Refund', 'Account', 'General'];
const VALID_URGENCIES = ['High', 'Medium', 'Low'];
const CACHE_KEY_SNAPSHOT = 'tickets:snapshot:v1';

const app = express();
app.use(express.json({ limit: '1mb' }));

const redisCache = createRedisCache();
let activeStore = createMemoryStore();

function getGeminiApiKey() {
  const raw = process.env.GEMINI_API_KEY?.trim();
  if (!raw || raw === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return raw;
}

function normalizeCategory(value) {
  if (typeof value !== 'string') return 'General';
  const match = VALID_CATEGORIES.find(
    (c) => c.toLowerCase() === value.trim().toLowerCase()
  );
  return match || 'General';
}

function normalizeUrgency(value) {
  if (typeof value !== 'string') return 'Medium';
  const match = VALID_URGENCIES.find(
    (u) => u.toLowerCase() === value.trim().toLowerCase()
  );
  return match || 'Medium';
}

function ruleBasedTriage({ customerName, issueDescription }) {
  const text = issueDescription.toLowerCase();
  const firstName = customerName.trim().split(/\s+/)[0] || 'there';

  let category = 'General';
  if (/(refund|money back|reimburse|return|cancel and refund|credit back)/.test(text)) {
    category = 'Refund';
  } else if (/(charge|invoice|billing|payment|card|subscription|double.?charg|overcharg|receipt)/.test(text)) {
    category = 'Billing';
  } else if (/(error|bug|crash|timeout|500|502|503|504|api|webhook|down|broken|latency|fail|not loading)/.test(text)) {
    category = 'Technical';
  } else if (/(password|login|sign in|2fa|two-factor|account|locked|verify|email change|access|sso)/.test(text)) {
    category = 'Account';
  }

  let urgency = 'Low';
  if (
    /(urgent|immediately|asap|critical|outage|down|production|charged twice|duplicate charge|unauthorized|fraud|blocked|cannot access|locked out|504|500)/.test(
      text
    )
  ) {
    urgency = 'High';
  } else if (
    /(fail|error|issue|problem|refund|delay|broken|unable|slow|reset|timeout|help)/.test(
      text
    )
  ) {
    urgency = 'Medium';
  }

  const replyTemplates = {
    Billing: `Hi ${firstName},\n\nThank you for reaching out regarding your billing concern. I have flagged this for our billing team to review the transaction details and confirm the status of your account. We will follow up with an update shortly.\n\nBest regards,\nSupport Team`,
    Refund: `Hi ${firstName},\n\nThank you for contacting us about your refund request. I have logged your request with our billing specialists so we can verify eligibility and process any applicable credit back to your original payment method as quickly as possible.\n\nBest regards,\nSupport Team`,
    Technical: `Hi ${firstName},\n\nThank you for reporting this technical issue. Our engineering support team is reviewing the behavior you described. If you have any timestamps, request IDs, or screenshots available, feel free to reply with them while we investigate.\n\nBest regards,\nSupport Team`,
    Account: `Hi ${firstName},\n\nThank you for reaching out about your account access. To protect your security, we have initiated an account verification check and will send step-by-step recovery instructions to your registered email address.\n\nBest regards,\nSupport Team`,
    General: `Hi ${firstName},\n\nThank you for getting in touch with our support team. We have received your message and routed it to the right specialist, who will follow up with a detailed response shortly.\n\nBest regards,\nSupport Team`,
  };

  return {
    category,
    urgency,
    draftReply: replyTemplates[category],
    triageSource: 'fallback',
  };
}

async function triageTicketWithAI({ customerName, customerEmail, issueDescription }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return ruleBasedTriage({ customerName, issueDescription });
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const prompt = [
    `Analyze the following customer support ticket and classify it accurately.`,
    `Customer Name: ${customerName}`,
    `Customer Email: ${customerEmail}`,
    `Issue Description: ${issueDescription}`,
  ].join('\n');

const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  let response;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction:
            'You are an expert customer support triage specialist. Classify each ticket into exactly one category (Billing, Technical, Refund, Account, or General) and one urgency level (High, Medium, or Low). High urgency is for production outages, security lockouts, duplicate charges, or critical blockers. Write a concise, polite, empathetic, and actionable draftReply addressed to the customer by first name, signed "Support Team".',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: {
                type: Type.STRING,
                enum: VALID_CATEGORIES,
                description: 'The primary support category.',
              },
              urgency: {
                type: Type.STRING,
                enum: VALID_URGENCIES,
                description: 'Ticket urgency level.',
              },
              draftReply: {
                type: Type.STRING,
                description: 'A polite, helpful customer support response.',
              },
            },
            required: ['category', 'urgency', 'draftReply'],
          },
        },
      });
      break;
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 0;
      const isTransient = status === 502 || status === 503 || status === 504;
      if (isTransient && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
        continue;
      }
      console.error('Gemini AI failed, using fallback:', err.message);
      return ruleBasedTriage({ customerName, issueDescription });
    }
  }

  const rawText = (response?.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty triage response.');
  }

  const parsed = JSON.parse(rawText);
  const category = normalizeCategory(parsed.category);
  const urgency = normalizeUrgency(parsed.urgency);
  const draftReply =
    typeof parsed.draftReply === 'string' && parsed.draftReply.trim().length > 0
      ? parsed.draftReply.trim()
      : ruleBasedTriage({ customerName, issueDescription }).draftReply;

  return {
    category,
    urgency,
    draftReply,
    triageSource: model,
  };
}

function validateTicketInput(body) {
  const customerName =
    typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerEmail =
    typeof body?.customerEmail === 'string' ? body.customerEmail.trim() : '';
  const issueDescription =
    typeof body?.issueDescription === 'string' ? body.issueDescription.trim() : '';

  if (customerName.length < 2 || customerName.length > 120) {
    return {
      error: 'Customer name must be between 2 and 120 characters.',
    };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(customerEmail) || customerEmail.length > 180) {
    return {
      error: 'Please provide a valid customer email address.',
    };
  }

  if (issueDescription.length < 10 || issueDescription.length > 4000) {
    return {
      error: 'Issue description must be between 10 and 4000 characters.',
    };
  }

  return {
    data: { customerName, customerEmail, issueDescription },
  };
}

async function getSnapshot() {
  const cached = await redisCache.get(CACHE_KEY_SNAPSHOT);
  if (cached && Array.isArray(cached.tickets) && cached.stats) {
    return { ...cached, cached: true };
  }

  const [tickets, stats] = await Promise.all([
    activeStore.listTickets(),
    activeStore.getStats(),
  ]);

  const snapshot = { tickets, stats };
  await redisCache.set(CACHE_KEY_SNAPSHOT, snapshot, 60);
  return { ...snapshot, cached: false };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    storage: activeStore.name,
    cache: redisCache.isConnected() ? 'redis' : 'none',
    aiConfigured: Boolean(getGeminiApiKey()),
  });
});

app.get('/api/tickets', async (req, res) => {
  try {
    const snapshot = await getSnapshot();
    const categoryFilter =
      typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const statusFilter =
      typeof req.query.status === 'string' ? req.query.status.trim() : '';

    let filteredTickets = snapshot.tickets;
    if (categoryFilter && categoryFilter !== 'All') {
      filteredTickets = filteredTickets.filter(
        (t) => t.category.toLowerCase() === categoryFilter.toLowerCase()
      );
    }
    if (statusFilter && statusFilter !== 'All') {
      filteredTickets = filteredTickets.filter(
        (t) => t.status.toLowerCase() === statusFilter.toLowerCase()
      );
    }

    res.json({
      tickets: filteredTickets,
      stats: snapshot.stats,
      storage: activeStore.name,
      cached: snapshot.cached,
    });
  } catch (err) {
    console.error('[GET /api/tickets] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve support tickets.' });
  }
});

app.post('/api/tickets', async (req, res) => {
  const validation = validateTicketInput(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const { customerName, customerEmail, issueDescription } = validation.data;

  try {
    const triage = await triageTicketWithAI({
      customerName,
      customerEmail,
      issueDescription,
    });

    const ticket = await activeStore.createTicket({
      customerName,
      customerEmail,
      issueDescription,
      category: triage.category,
      urgency: triage.urgency,
      draftReply: triage.draftReply,
      triageSource: triage.triageSource,
    });

    await redisCache.del(CACHE_KEY_SNAPSHOT);
    const stats = await activeStore.getStats();

    return res.status(201).json({
      ticket,
      stats,
      storage: activeStore.name,
    });
  } catch (err) {
    console.error('[POST /api/tickets] Error:', err);
    const statusCode = typeof err?.status === 'number' ? err.status : 500;
    const message =
      statusCode === 400 || statusCode === 403
        ? 'Gemini API key error. Please verify GEMINI_API_KEY in your environment settings.'
        : statusCode === 429
          ? 'Gemini API quota exceeded. Please try again shortly.'
          : statusCode === 503
            ? 'AI triage service is temporarily unavailable. Please try again in a moment.'
            : 'Failed to auto-triage and save the support ticket.';

    return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      error: message,
    });
  }
});

app.patch('/api/tickets/:id/resolve', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  try {
    const ticket = await activeStore.resolveTicket(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    await redisCache.del(CACHE_KEY_SNAPSHOT);
    const stats = await activeStore.getStats();

    return res.json({
      ticket,
      stats,
      storage: activeStore.name,
    });
  } catch (err) {
    console.error('[PATCH /api/tickets/:id/resolve] Error:', err);
    return res.status(500).json({ error: 'Failed to mark ticket as resolved.' });
  }
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found.' });
  }
  return res.sendFile(path.join(publicDir, 'index.html'));
});

async function initializeInfrastructure() {
  if (isMysqlConfigured()) {
    const mysqlStore = createMysqlStore();
    try {
      await mysqlStore.init();
      activeStore = mysqlStore;
      console.log('[Storage] Connected to MySQL store.');
    } catch (err) {
      console.warn(
        '[Storage] MySQL unavailable, falling back to in-memory store:',
        err.message
      );
      activeStore = createMemoryStore();
      await activeStore.init();
    }
  } else {
    activeStore = createMemoryStore();
    await activeStore.init();
    console.log('[Storage] Using in-memory store (MySQL env vars not set).');
  }

  const redisOk = await redisCache.init();
  console.log(
    redisOk
      ? '[Cache] Connected to Redis cache.'
      : '[Cache] Redis not configured or unreachable; running without cache.'
  );
}

const PORT = Number(process.env.PORT || 3000);

initializeInfrastructure()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`AI Smart Support & Ticket Triage System listening on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
