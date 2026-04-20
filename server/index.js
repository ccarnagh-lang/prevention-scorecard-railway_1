const express  = require('express');
const session  = require('express-session');
const PgStore  = require('connect-pg-simple')(session);
const bcrypt   = require('bcryptjs');
const path     = require('path');
const { migrate, pool } = require('./migrate');
const db       = require('./database');
const docxGen  = require('./docxGenerator');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  store: process.env.DATABASE_URL
    ? new PgStore({ pool, tableName: 'sessions' })
    : undefined,
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));

// ── AUTH MIDDLEWARE ───────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.session.user.role))
      return res.status(403).json({ error: 'Access denied' });
    next();
  };
}
function scopeProgram(req, res, next) {
  const u = req.session.user;
  req.programScope = u.role === 'executive' || u.role === 'admin'
    ? (req.query.program_id || null)
    : u.program_id;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!['admin', 'executive'].includes(req.session.user.role))
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── AUTH ──────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await db.getUserByEmail(email.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    await db.updateLastLogin(user.id);
    req.session.user = {
      id: user.id, email: user.email, name: user.name,
      initials: user.initials, role: user.role, program_id: user.program_id,
    };
    await db.logAction(user.id, user.name, 'login', 'session', null, `Role: ${user.role}`);
    res.json({ user: req.session.user });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session?.user || null });
});

// ── PROGRAMS ──────────────────────────────────────────────────
app.get('/api/programs', requireAuth, async (req, res) => {
  try {
    let programs = await db.getAllPrograms();
    const u = req.session.user;
    if (u.role !== 'executive' && u.role !== 'admin')
      programs = programs.filter(p => p.id === u.program_id);
    const scores  = await db.getProgramScores();
    const scoreMap = {};
    scores.forEach(s => { scoreMap[s.id] = s; });
    res.json(programs.map(p => ({ ...p, ...(scoreMap[p.id] || {}) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DASHBOARD ─────────────────────────────────────────────────
app.get('/api/dashboard', requireAuth, scopeProgram, async (req, res) => {
  try {
    res.json(await db.getDashboard(req.programScope, req.query.week_ending));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── ROSTER ────────────────────────────────────────────────────
app.get('/api/roster', requireAuth, scopeProgram, async (req, res) => {
  try { res.json(await db.getRoster(req.programScope, req.query.active !== 'false')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/roster', requireAuth, requireRole('executive','admin','program_director','supervisor'), async (req, res) => {
  try {
    const data = req.body;
    const u = req.session.user;
    if (u.role !== 'executive' && u.role !== 'admin') data.program_id = u.program_id;
    await db.addCase(data);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/roster/:caseId', requireAuth, async (req, res) => {
  try { await db.updateCase(req.params.caseId, req.body); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── ENTRIES ───────────────────────────────────────────────────
app.get('/api/entries', requireAuth, scopeProgram, async (req, res) => {
  try {
    res.json(await db.getEntries({
      programId:  req.programScope,
      caseId:     req.query.case_id,
      weekEnding: req.query.week_ending,
      planner:    req.query.planner,
      dateFrom:   req.query.date_from,
      dateTo:     req.query.date_to,
      limit:      req.query.limit ? parseInt(req.query.limit) : 1000,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/entries', requireAuth, async (req, res) => {
  try {
    const u     = req.session.user;
    const entry = req.body;
    if (u.role !== 'executive' && u.role !== 'admin') entry.program_id = u.program_id;
    await db.saveEntry(entry, u.id, u.name, u.role);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

app.put('/api/entries/:id', requireAuth, async (req, res) => {
  try { await db.updateEntry(req.params.id, req.body, req.session.user.id); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/entries/:id/review', requireAuth, requireRole('executive','admin','program_director','supervisor'), async (req, res) => {
  try { await db.reviewEntry(req.params.id, req.session.user.id); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/entries/latest', requireAuth, scopeProgram, async (req, res) => {
  try { res.json(await db.getLatestPerCase(req.programScope)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STAFF ─────────────────────────────────────────────────────
app.get('/api/staff', requireAuth, scopeProgram, async (req, res) => {
  try {
    const pid = req.programScope || req.session.user.program_id;
    if (!pid) return res.json([]);
    res.json(await db.getStaff(pid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SUPERVISION LOG ───────────────────────────────────────────
app.get('/api/supervision-log', requireAuth, scopeProgram, async (req, res) => {
  try {
    res.json(await db.getSupervisionLog({
      programId: req.programScope,
      staffName: req.query.staff_name,
      caseId:    req.query.case_id,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/supervision-log', requireAuth, requireRole('executive','admin','program_director','supervisor'), async (req, res) => {
  try {
    const u = req.session.user;
    const data = req.body;
    if (u.role !== 'executive' && u.role !== 'admin') data.program_id = u.program_id;
    await db.addSupervisionNote(data, u.id, u.name, u.role);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/supervision-log/:id/resolve', requireAuth, async (req, res) => {
  try { await db.resolveSupervisionNote(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── EXPORTS ───────────────────────────────────────────────────
app.get('/api/export/csv', requireAuth, scopeProgram, async (req, res) => {
  try {
    const entries = await db.getEntries({
      programId: req.programScope,
      dateFrom:  req.query.date_from,
      dateTo:    req.query.date_to,
      limit:     10000,
    });
    const csv      = await db.entriesToCSV(entries, req.query.mode || 'full');
    const filename = `scorecard_${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/export/supervisory-note', requireAuth, async (req, res) => {
  try {
    const { caseId, ...opts } = req.body;
    const entries   = await db.getEntries({ caseId, limit: 100 });
    const rosterAll = await db.getRoster(null, false);
    const roster    = rosterAll.find(r => r.case_id === caseId);
    const supNotes  = await db.getSupervisionLog({ caseId });
    const buf = await docxGen.generateSupNote({ caseId, ...opts, roster, latest: entries[0] || null, supNotes });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Supervisory_Note_${caseId}.docx"`);
    res.send(buf);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── ADMIN ─────────────────────────────────────────────────────
app.get('/api/admin/users',    requireAdmin, async (req, res) => {
  try { res.json(await db.getAllUsers()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/users',   requireAdmin, async (req, res) => {
  try {
    await db.createUser(req.body);
    await db.logAction(req.session.user.id, req.session.user.name, 'create_user', 'user', req.body.email, `Role: ${req.body.role}`);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try { await db.updateUser(req.params.id, req.body); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  try { await db.resetPassword(req.params.id, req.body.password); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try { await db.deactivateUser(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/programs',  requireAdmin, async (req, res) => {
  try { res.json(await db.getAllPrograms()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/programs', requireAdmin, async (req, res) => {
  try { await db.createProgram(req.body); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── SPA FALLBACK ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── BOOT ──────────────────────────────────────────────────────
async function start() {
  if (process.env.DATABASE_URL) {
    await migrate();
  } else {
    console.warn('[server] No DATABASE_URL set — running without database (login will fail)');
    console.warn('[server] Set DATABASE_URL to your PostgreSQL connection string');
  }
  app.listen(PORT, () => {
    console.log(`\nPrevention Scorecard running on port ${PORT}`);
    if (process.env.ADMIN_EMAIL) {
      console.log(`Admin login: ${process.env.ADMIN_EMAIL}`);
    }
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
