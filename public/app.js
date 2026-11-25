(() => {
  const SAMPLE_PRESETS = {
    billing: {
      customerName: 'Hannah Brooks',
      customerEmail: 'hannah.brooks@arcadiahealth.com',
      issueDescription:
        'Our company credit card was charged twice for our monthly Enterprise plan ($490 x 2) on invoice #90214. Please void the duplicate billing charge as soon as possible.',
    },
    technical: {
      customerName: 'Devon Patel',
      customerEmail: 'devon@kinetix-ai.io',
      issueDescription:
        'Production API requests to /v2/events are returning HTTP 503 service unavailable errors across us-east since 09:15 UTC. Customer data ingestion is currently blocked.',
    },
    refund: {
      customerName: 'Sofia Alvarez',
      customerEmail: 'sofia.alvarez@brightleaf.co',
      issueDescription:
        'I accidentally renewed my annual Pro subscription yesterday and would like to request a full refund within the 14-day grace period since I am switching to the free tier.',
    },
    account: {
      customerName: 'Liam OConnor',
      customerEmail: 'liam@northportstudio.org',
      issueDescription:
        'I cannot sign in to my workspace account after updating our SSO provider certificate. Our team members are getting an invalid assertion error on login.',
    },
  };

  const state = {
    tickets: [],
    stats: {
      total: 0,
      highUrgency: 0,
      highUrgencyOpen: 0,
      open: 0,
      resolved: 0,
    },
    statusFilter: 'All',
    categoryFilter: 'All',
    searchQuery: '',
    loading: true,
    submitting: false,
    resolvingIds: new Set(),
  };

  const dom = {
    html: document.documentElement,
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeToggleLabel: document.getElementById('themeToggleLabel'),
    ticketForm: document.getElementById('ticketForm'),
    customerName: document.getElementById('customerName'),
    customerEmail: document.getElementById('customerEmail'),
    issueDescription: document.getElementById('issueDescription'),
    charCounter: document.getElementById('charCounter'),
    formAlert: document.getElementById('formAlert'),
    submitBtn: document.getElementById('submitBtn'),
    submitSpinner: document.getElementById('submitSpinner'),
    submitBtnText: document.getElementById('submitBtnText'),
    refreshBtn: document.getElementById('refreshBtn'),
    kpiTotal: document.getElementById('kpiTotal'),
    kpiOpenSubtext: document.getElementById('kpiOpenSubtext'),
    kpiHighUrgency: document.getElementById('kpiHighUrgency'),
    kpiHighOpenSubtext: document.getElementById('kpiHighOpenSubtext'),
    kpiResolved: document.getElementById('kpiResolved'),
    kpiResolutionRate: document.getElementById('kpiResolutionRate'),
    statusFilters: document.getElementById('statusFilters'),
    categoryFilters: document.getElementById('categoryFilters'),
    searchInput: document.getElementById('searchInput'),
    queueError: document.getElementById('queueError'),
    queueErrorText: document.getElementById('queueErrorText'),
    retryLoadBtn: document.getElementById('retryLoadBtn'),
    ticketList: document.getElementById('ticketList'),
  };

  function initTheme() {
    const saved = localStorage.getItem('triage_theme');
    const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
    applyTheme(theme);
  }

  function applyTheme(theme) {
    dom.html.setAttribute('data-theme', theme);
    localStorage.setItem('triage_theme', theme);
    dom.themeToggleLabel.textContent =
      theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  }

  function toggleTheme() {
    const current = dom.html.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  function formatTimestamp(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function showFormAlert(message, type) {
    dom.formAlert.textContent = message;
    dom.formAlert.className = `alert-banner ${
      type === 'error' ? 'alert-error' : 'alert-success'
    }`;
  }

  function clearFormAlert() {
    dom.formAlert.textContent = '';
    dom.formAlert.className = 'alert-banner hidden';
  }

  function updateCharCounter() {
    const length = dom.issueDescription.value.length;
    dom.charCounter.textContent = `${length} / 4000`;
  }

  function setSubmitting(isSubmitting) {
    state.submitting = isSubmitting;
    dom.submitBtn.disabled = isSubmitting;
    dom.submitSpinner.classList.toggle('hidden', !isSubmitting);
    dom.submitBtnText.textContent = isSubmitting
      ? 'Analyzing & Triaging...'
      : 'Submit & Auto-Triage';
  }

  function renderStats() {
    const { total, highUrgency, highUrgencyOpen, open, resolved } = state.stats;
    dom.kpiTotal.textContent = String(total);
    dom.kpiOpenSubtext.textContent = `${open} open in queue`;
    dom.kpiHighUrgency.textContent = String(highUrgency);
    dom.kpiHighOpenSubtext.textContent = `${highUrgencyOpen} active high priority`;
    dom.kpiResolved.textContent = String(resolved);
    const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;
    dom.kpiResolutionRate.textContent = `${rate}% resolution rate`;
  }

  function getFilteredTickets() {
    const q = state.searchQuery.trim().toLowerCase();
    return state.tickets.filter((ticket) => {
      if (
        state.statusFilter !== 'All' &&
        ticket.status.toLowerCase() !== state.statusFilter.toLowerCase()
      ) {
        return false;
      }
      if (
        state.categoryFilter !== 'All' &&
        ticket.category.toLowerCase() !== state.categoryFilter.toLowerCase()
      ) {
        return false;
      }
      if (q) {
        const haystack = [
          ticket.customerName,
          ticket.customerEmail,
          ticket.issueDescription,
          ticket.category,
          `#${ticket.id}`,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  function createUrgencyBadge(urgency) {
    const span = document.createElement('span');
    const normalized = (urgency || 'Medium').toLowerCase();
    const classMap = {
      high: 'badge-urgency-high',
      medium: 'badge-urgency-medium',
      low: 'badge-urgency-low',
    };
    const labelMap = {
      high: 'High Urgency',
      medium: 'Medium Urgency',
      low: 'Low Urgency',
    };
    span.className = `badge ${classMap[normalized] || 'badge-urgency-medium'}`;
    span.textContent = labelMap[normalized] || 'Medium Urgency';
    return span;
  }

  function createTicketElement(ticket) {
    const isResolved = ticket.status === 'Resolved';
    const isResolving = state.resolvingIds.has(ticket.id);

    const card = document.createElement('article');
    card.className = `ticket-card${isResolved ? ' ticket-card-resolved' : ''}`;
    card.dataset.ticketId = String(ticket.id);

    // Header
    const header = document.createElement('div');
    header.className = 'ticket-header';

    const identity = document.createElement('div');
    identity.className = 'ticket-identity';

    const nameEl = document.createElement('h3');
    nameEl.className = 'ticket-customer-name';
    nameEl.textContent = ticket.customerName;

    const metaLine = document.createElement('div');
    metaLine.className = 'ticket-meta-line';

    const idSpan = document.createElement('span');
    idSpan.className = 'ticket-id-mono tabular-nums';
    idSpan.textContent = `#TKT-${String(ticket.id).padStart(4, '0')}`;

    const sep1 = document.createElement('span');
    sep1.setAttribute('aria-hidden', 'true');
    sep1.textContent = '·';

    const emailSpan = document.createElement('span');
    emailSpan.textContent = ticket.customerEmail;

    const sep2 = document.createElement('span');
    sep2.setAttribute('aria-hidden', 'true');
    sep2.textContent = '·';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'tabular-nums';
    timeSpan.textContent = formatTimestamp(ticket.createdAt);

    metaLine.append(idSpan, sep1, emailSpan, sep2, timeSpan);
    identity.append(nameEl, metaLine);

    const badges = document.createElement('div');
    badges.className = 'ticket-badges';

    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'badge badge-category';
    categoryBadge.textContent = ticket.category;

    const urgencyBadge = createUrgencyBadge(ticket.urgency);

    const statusBadge = document.createElement('span');
    statusBadge.className = `badge ${
      isResolved ? 'badge-status-resolved' : 'badge-status-open'
    }`;
    statusBadge.textContent = ticket.status;

    badges.append(categoryBadge, urgencyBadge, statusBadge);
    header.append(identity, badges);

    // Issue Description
    const issueEl = document.createElement('p');
    issueEl.className = 'ticket-issue';
    issueEl.textContent = ticket.issueDescription;

    // Draft Reply Section
    const draftSection = document.createElement('div');
    draftSection.className = 'draft-reply-section';

    const draftHeader = document.createElement('div');
    draftHeader.className = 'draft-reply-header';

    const draftLabel = document.createElement('span');
    draftLabel.className = 'draft-reply-label';
    draftLabel.textContent = 'AI-Generated Draft Reply';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-secondary btn-compact';
    copyBtn.textContent = 'Copy Reply';
    copyBtn.addEventListener('click', () => handleCopyReply(ticket.draftReply, copyBtn));

    draftHeader.append(draftLabel, copyBtn);

    const draftText = document.createElement('p');
    draftText.className = 'draft-reply-text';
    draftText.textContent = ticket.draftReply;

    draftSection.append(draftHeader, draftText);

    // Footer Actions
    const footer = document.createElement('div');
    footer.className = 'ticket-footer';

    const footerNote = document.createElement('span');
    footerNote.className = 'ticket-footer-note tabular-nums';
    footerNote.textContent = isResolved && ticket.resolvedAt
      ? `Resolved ${formatTimestamp(ticket.resolvedAt)}`
      : ticket.triageSource === 'fallback'
        ? 'Triaged via rule-based engine'
        : ticket.triageSource === 'seed'
          ? 'Sample queue ticket'
          : 'Triaged by Gemini AI';

    const actions = document.createElement('div');
    actions.className = 'ticket-actions';

    if (!isResolved) {
      const resolveBtn = document.createElement('button');
      resolveBtn.type = 'button';
      resolveBtn.className = 'btn btn-success-subtle btn-compact';
      resolveBtn.disabled = isResolving;
      resolveBtn.textContent = isResolving ? 'Resolving...' : 'Mark Resolved';
      resolveBtn.addEventListener('click', () => handleResolveTicket(ticket.id));
      actions.append(resolveBtn);
    }

    footer.append(footerNote, actions);

    card.append(header, issueEl, draftSection, footer);
    return card;
  }

  function renderTickets() {
    dom.ticketList.replaceChildren();

    if (state.loading) {
      for (let i = 0; i < 2; i += 1) {
        const skel = document.createElement('div');
        skel.className = 'skeleton-card';
        dom.ticketList.appendChild(skel);
      }
      return;
    }

    const filtered = getFilteredTickets();

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';

      const title = document.createElement('h3');
      title.className = 'empty-state-title';
      title.textContent =
        state.tickets.length === 0
          ? 'No support tickets in queue'
          : 'No tickets match your current filters';

      const desc = document.createElement('p');
      desc.className = 'empty-state-desc';
      desc.textContent =
        state.tickets.length === 0
          ? 'Submit a customer ticket using the intake form to see AI categorization, urgency scoring, and draft replies.'
          : 'Try clearing the category, status, or search filter to view all support tickets.';

      empty.append(title, desc);

      if (state.tickets.length > 0) {
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'btn btn-secondary btn-compact';
        resetBtn.textContent = 'Reset Filters';
        resetBtn.addEventListener('click', resetFilters);
        empty.appendChild(resetBtn);
      }

      dom.ticketList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const ticket of filtered) {
      fragment.appendChild(createTicketElement(ticket));
    }
    dom.ticketList.appendChild(fragment);
  }

  function resetFilters() {
    state.statusFilter = 'All';
    state.categoryFilter = 'All';
    state.searchQuery = '';
    dom.searchInput.value = '';
    syncFilterButtons();
    renderTickets();
  }

  function syncFilterButtons() {
    dom.statusFilters.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.status === state.statusFilter);
    });
    dom.categoryFilters.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.category === state.categoryFilter);
    });
  }

  async function fetchTickets() {
    state.loading = true;
    dom.queueError.classList.add('hidden');
    renderTickets();

    try {
      const res = await fetch('/api/tickets');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch tickets.');
      }
      state.tickets = Array.isArray(data.tickets) ? data.tickets : [];
      if (data.stats) {
        state.stats = data.stats;
      }
      state.loading = false;
      renderStats();
      renderTickets();
    } catch (err) {
      state.loading = false;
      dom.queueErrorText.textContent =
        err?.message || 'Unable to connect to the ticket triage server.';
      dom.queueError.classList.remove('hidden');
      renderTickets();
    }
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    clearFormAlert();

    const customerName = dom.customerName.value.trim();
    const customerEmail = dom.customerEmail.value.trim();
    const issueDescription = dom.issueDescription.value.trim();

    if (customerName.length < 2) {
      showFormAlert('Please enter the customer name (at least 2 characters).', 'error');
      dom.customerName.focus();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      showFormAlert('Please enter a valid customer email address.', 'error');
      dom.customerEmail.focus();
      return;
    }

    if (issueDescription.length < 10) {
      showFormAlert(
        'Please provide a detailed issue description (at least 10 characters).',
        'error'
      );
      dom.issueDescription.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerEmail,
          issueDescription,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to triage ticket.');
      }

      if (data.ticket) {
        state.tickets.unshift(data.ticket);
      }
      if (data.stats) {
        state.stats = data.stats;
      }

      dom.ticketForm.reset();
      updateCharCounter();
      showFormAlert(
        `Ticket #TKT-${String(data.ticket.id).padStart(4, '0')} triaged as ${data.ticket.category} (${data.ticket.urgency} urgency).`,
        'success'
      );

      renderStats();
      renderTickets();
    } catch (err) {
      showFormAlert(
        err?.message || 'An unexpected error occurred while submitting the ticket.',
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolveTicket(id) {
    if (state.resolvingIds.has(id)) return;
    state.resolvingIds.add(id);
    renderTickets();

    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/resolve`, {
        method: 'PATCH',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resolve ticket.');
      }

      if (data.ticket) {
        state.tickets = state.tickets.map((t) =>
          t.id === data.ticket.id ? data.ticket : t
        );
      }
      if (data.stats) {
        state.stats = data.stats;
      }

      renderStats();
    } catch (err) {
      dom.queueErrorText.textContent =
        err?.message || 'Unable to mark ticket as resolved.';
      dom.queueError.classList.remove('hidden');
    } finally {
      state.resolvingIds.delete(id);
      renderTickets();
    }
  }

  async function handleCopyReply(text, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        document.body.removeChild(helper);
      }
      const original = button.textContent;
      button.textContent = 'Copied';
      button.disabled = true;
      setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 1500);
    } catch {
      button.textContent = 'Copy failed';
      setTimeout(() => {
        button.textContent = 'Copy Reply';
      }, 1500);
    }
  }

  function bindEvents() {
    dom.themeToggleBtn.addEventListener('click', toggleTheme);
    dom.ticketForm.addEventListener('submit', handleFormSubmit);
    dom.issueDescription.addEventListener('input', updateCharCounter);
    dom.refreshBtn.addEventListener('click', fetchTickets);
    dom.retryLoadBtn.addEventListener('click', fetchTickets);

    dom.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderTickets();
    });

    dom.statusFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-status]');
      if (!btn) return;
      state.statusFilter = btn.dataset.status;
      syncFilterButtons();
      renderTickets();
    });

    dom.categoryFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-category]');
      if (!btn) return;
      state.categoryFilter = btn.dataset.category;
      syncFilterButtons();
      renderTickets();
    });

    document.querySelectorAll('.preset-btn[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = SAMPLE_PRESETS[btn.dataset.preset];
        if (!preset) return;
        clearFormAlert();
        dom.customerName.value = preset.customerName;
        dom.customerEmail.value = preset.customerEmail;
        dom.issueDescription.value = preset.issueDescription;
        updateCharCounter();
        dom.issueDescription.focus();
      });
    });
  }

  initTheme();
  updateCharCounter();
  bindEvents();
  fetchTickets();
})();
