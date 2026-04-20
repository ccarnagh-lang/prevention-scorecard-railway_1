/**
 * server/migrate.js
 * Creates all tables and the first admin account.
 * Safe to run multiple times — IF NOT EXISTS throughout.
 * Called automatically when the server starts.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[db] Running migrations...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        email      TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        name       TEXT NOT NULL,
        initials   TEXT,
        role       TEXT NOT NULL,
        program_id TEXT,
        active     BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS programs (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        modality   TEXT,
        borough    TEXT,
        site_code  TEXT,
        active     BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS roster (
        case_id         TEXT PRIMARY KEY,
        household_id    TEXT,
        program_id      TEXT NOT NULL,
        planner_name    TEXT,
        supervisor_name TEXT,
        open_date       TEXT,
        children_count  INTEGER DEFAULT 1,
        modality        TEXT,
        active          BOOLEAN DEFAULT true,
        notes           TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id               SERIAL PRIMARY KEY,
        record_id        TEXT UNIQUE NOT NULL,
        case_id          TEXT NOT NULL,
        program_id       TEXT NOT NULL,
        week_ending      TEXT NOT NULL,
        submitted_by     INTEGER,
        submitted_name   TEXT,
        submitted_role   TEXT,
        case_planner     TEXT,
        household_id     TEXT,
        children_count   INTEGER,
        submission_notes TEXT,
        responses        JSONB DEFAULT '[]',
        weekly_score     REAL,
        monthly_score    REAL,
        quarterly_score  REAL,
        lifetime_score   REAL,
        safety_flag      TEXT DEFAULT 'No',
        fasp_status      TEXT DEFAULT 'Pending',
        reviewed         BOOLEAN DEFAULT false,
        reviewed_by      INTEGER,
        reviewed_at      TIMESTAMPTZ,
        last_edited_by   INTEGER,
        last_edited_at   TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS supervision_log (
        id          SERIAL PRIMARY KEY,
        program_id  TEXT,
        case_id     TEXT,
        staff_name  TEXT,
        author_id   INTEGER,
        author_name TEXT,
        author_role TEXT,
        domain      TEXT,
        content     TEXT NOT NULL,
        action_item TEXT,
        due_date    TEXT,
        status      TEXT DEFAULT 'Open',
        resolved    BOOLEAN DEFAULT false,
        resolved_at TIMESTAMPTZ,
        entry_type  TEXT DEFAULT 'note',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER,
        user_name   TEXT,
        action      TEXT,
        entity_type TEXT,
        entity_id   TEXT,
        detail      TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid    TEXT PRIMARY KEY,
        sess   JSONB NOT NULL,
        expire TIMESTAMPTZ NOT NULL
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire)
    `);

    // Create first admin account if no users exist yet
    const existing = await client.query('SELECT COUNT(*) as c FROM users');
    if (parseInt(existing.rows[0].c) === 0) {
      const bcrypt = require('bcryptjs');
      const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@agency.org';
      const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe2025!';
      const adminName     = process.env.ADMIN_NAME     || 'System Administrator';
      const hash = bcrypt.hashSync(adminPassword, 10);
      await client.query(
        `INSERT INTO users (email, password, name, initials, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [adminEmail, hash, adminName, 'SA', 'admin']
      );
      console.log(`[db] Admin account created: ${adminEmail}`);
      console.log(`[db] Temporary password:    ${adminPassword}`);
      console.log('[db] Please change this password after first login!');
    }

    console.log('[db] Migrations complete.');
  } finally {
    client.release();
  }
}

module.exports = { migrate, pool };
