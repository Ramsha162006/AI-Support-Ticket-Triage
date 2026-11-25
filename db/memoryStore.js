const DEFAULT_SEED_TICKETS = [
  {
    customerName: 'Elena Vance',
    customerEmail: 'elena.vance@northstar-ops.io',
    issueDescription:
      'We were charged twice ($299.00) on invoice #INV-88412 this morning after upgrading our team workspace seat count. Please reverse the duplicate charge immediately so our accounting reconciliation is not blocked.',
    category: 'Billing',
    urgency: 'High',
    draftReply:
      'Hi Elena,\n\nThank you for flagging the duplicate charge on invoice #INV-88412. I have escalated this to our billing team to verify the double transaction of $299.00 and initiate an immediate reversal back to your original payment method. You will receive a confirmation receipt within 1–2 business hours.\n\nBest regards,\nSupport Team',
    status: 'Open',
    triageSource: 'seed',
    minutesAgo: 18,
  },
  {
    customerName: 'Marcus Chen',
    customerEmail: 'm.chen@foundrylabs.dev',
    issueDescription:
      'Our production webhook endpoint started returning intermittent 504 gateway timeouts after rotating our signing secret in the developer dashboard. Incoming order events are backing up in the retry queue.',
    category: 'Technical',
    urgency: 'High',
    draftReply:
      'Hi Marcus,\n\nWe understand how critical webhook delivery is for your production order pipeline. Could you share the timestamp of the secret rotation and your endpoint ID? Meanwhile, please verify your endpoint is reading the updated signature header from the latest secret version while our engineering team inspects the delivery logs.\n\nBest regards,\nSupport Team',
    status: 'Open',
    triageSource: 'seed',
    minutesAgo: 47,
  },
  {
    customerName: 'Priya Nair',
    customerEmail: 'priya@veridianstudio.com',
    issueDescription:
      'I changed my phone number and can no longer receive SMS codes for two-factor authentication on my account. I still have access to my recovery email.',
    category: 'Account',
    urgency: 'Medium',
    draftReply:
      'Hi Priya,\n\nNo problem at all—we can help restore access to your account. Since you still have access to your recovery email, I have triggered an identity verification link to priya@veridianstudio.com so we can safely reset your 2FA phone number. Please check your inbox and let us know once completed.\n\nBest regards,\nSupport Team',
    status: 'Resolved',
    triageSource: 'seed',
    minutesAgo: 135,
    resolvedMinutesAgo: 92,
  },
];

export function createMemoryStore() {
  let nextId = 1;
  const tickets = [];

  async function init() {
    if (tickets.length > 0) return;
    const now = Date.now();
    for (const item of DEFAULT_SEED_TICKETS) {
      const createdAt = new Date(now - item.minutesAgo * 60 * 1000).toISOString();
      const resolvedAt =
        item.status === 'Resolved' && item.resolvedMinutesAgo
          ? new Date(now - item.resolvedMinutesAgo * 60 * 1000).toISOString()
          : null;
      tickets.push({
        id: nextId++,
        customerName: item.customerName,
        customerEmail: item.customerEmail,
        issueDescription: item.issueDescription,
        category: item.category,
        urgency: item.urgency,
        draftReply: item.draftReply,
        status: item.status,
        triageSource: item.triageSource,
        createdAt,
        resolvedAt,
      });
    }
  }

  async function listTickets() {
    return [...tickets].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async function createTicket({
    customerName,
    customerEmail,
    issueDescription,
    category,
    urgency,
    draftReply,
    triageSource = 'ai',
  }) {
    const ticket = {
      id: nextId++,
      customerName,
      customerEmail,
      issueDescription,
      category,
      urgency,
      draftReply,
      status: 'Open',
      triageSource,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    tickets.unshift(ticket);
    return ticket;
  }

  async function resolveTicket(id) {
    const numericId = Number(id);
    const ticket = tickets.find((t) => t.id === numericId);
    if (!ticket) return null;
    if (ticket.status !== 'Resolved') {
      ticket.status = 'Resolved';
      ticket.resolvedAt = new Date().toISOString();
    }
    return ticket;
  }

  async function getStats() {
    const total = tickets.length;
    const highUrgency = tickets.filter(
      (t) => t.urgency === 'High' && t.status !== 'Resolved'
    ).length;
    const highUrgencyTotal = tickets.filter((t) => t.urgency === 'High').length;
    const resolved = tickets.filter((t) => t.status === 'Resolved').length;
    const open = total - resolved;
    return {
      total,
      highUrgency: highUrgencyTotal,
      highUrgencyOpen: highUrgency,
      open,
      resolved,
    };
  }

  return {
    name: 'memory',
    init,
    listTickets,
    createTicket,
    resolveTicket,
    getStats,
  };
}
