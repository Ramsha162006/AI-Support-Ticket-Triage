import mysql from 'mysql2/promise';

function mapRowToTicket(row) {
  return {
    id: Number(row.id),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    issueDescription: row.issue_description,
    category: row.category,
    urgency: row.urgency,
    draftReply: row.draft_reply,
    status: row.status,
    triageSource: row.triage_source,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at
      ? row.resolved_at instanceof Date
        ? row.resolved_at.toISOString()
        : new Date(row.resolved_at).toISOString()
      : null,
  };
}

export function isMysqlConfigured() {
  return Boolean(
    process.env.DATABASE_URL ||
      (process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE)
  );
}

export function createMysqlStore() {
  let pool = null;

  function buildPoolConfig() {
    if (process.env.DATABASE_URL) {
      return {
        uri: process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      };
    }

    return {
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'support_triage',
      ssl: process.env.MYSQL_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    };
  }

  async function init() {
    const config = buildPoolConfig();
    pool = config.uri
      ? mysql.createPool(config.uri)
      : mysql.createPool(config);

    await pool.query('SELECT 1');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(120) NOT NULL,
        customer_email VARCHAR(180) NOT NULL,
        issue_description TEXT NOT NULL,
        category VARCHAR(32) NOT NULL,
        urgency VARCHAR(16) NOT NULL,
        draft_reply TEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'Open',
        triage_source VARCHAR(24) NOT NULL DEFAULT 'ai',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_tickets_status (status),
        INDEX idx_tickets_category (category),
        INDEX idx_tickets_urgency (urgency),
        INDEX idx_tickets_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  async function listTickets() {
    const [rows] = await pool.query(
      `SELECT id, customer_name, customer_email, issue_description, category, urgency, draft_reply, status, triage_source, created_at, resolved_at
       FROM tickets
       ORDER BY created_at DESC, id DESC`
    );
    return rows.map(mapRowToTicket);
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
    const [result] = await pool.execute(
      `INSERT INTO tickets (customer_name, customer_email, issue_description, category, urgency, draft_reply, status, triage_source)
       VALUES (?, ?, ?, ?, ?, ?, 'Open', ?)`,
      [
        customerName,
        customerEmail,
        issueDescription,
        category,
        urgency,
        draftReply,
        triageSource,
      ]
    );

    const [rows] = await pool.execute(
      `SELECT id, customer_name, customer_email, issue_description, category, urgency, draft_reply, status, triage_source, created_at, resolved_at
       FROM tickets WHERE id = ?`,
      [result.insertId]
    );

    return mapRowToTicket(rows[0]);
  }

  async function resolveTicket(id) {
    const numericId = Number(id);
    const [existingRows] = await pool.execute(
      `SELECT id, status FROM tickets WHERE id = ?`,
      [numericId]
    );

    if (existingRows.length === 0) {
      return null;
    }

    if (existingRows[0].status !== 'Resolved') {
      await pool.execute(
        `UPDATE tickets SET status = 'Resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [numericId]
      );
    }

    const [rows] = await pool.execute(
      `SELECT id, customer_name, customer_email, issue_description, category, urgency, draft_reply, status, triage_source, created_at, resolved_at
       FROM tickets WHERE id = ?`,
      [numericId]
    );

    return mapRowToTicket(rows[0]);
  }

  async function getStats() {
    const [rows] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN urgency = 'High' THEN 1 ELSE 0 END) AS high_urgency,
        SUM(CASE WHEN urgency = 'High' AND status <> 'Resolved' THEN 1 ELSE 0 END) AS high_urgency_open,
        SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN status <> 'Resolved' THEN 1 ELSE 0 END) AS open_count
      FROM tickets
    `);

    const row = rows[0] || {};
    return {
      total: Number(row.total || 0),
      highUrgency: Number(row.high_urgency || 0),
      highUrgencyOpen: Number(row.high_urgency_open || 0),
      open: Number(row.open_count || 0),
      resolved: Number(row.resolved || 0),
    };
  }

  async function close() {
    if (pool) {
      await pool.end();
    }
  }

  return {
    name: 'mysql',
    init,
    listTickets,
    createTicket,
    resolveTicket,
    getStats,
    close,
  };
}
