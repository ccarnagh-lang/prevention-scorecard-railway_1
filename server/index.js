const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const multer   = require('multer');
const { migrate, pool } = require('./migrate');
const db       = require('./database');
const docxGen  = require('./docxGenerator');

const app    = express();
const PORT   = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax', secure: false },
}));

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Access denied' });
    next();
  };
}
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!['admin','executive'].includes(req.session.user.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}
function scopeProgram(req, res, next) {
  const u = req.session.user;
  req.programScope = (u.role === 'executive' || u.role === 'admin')
    ? (req.query.program_id || null) : u.program_id;
  next();
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await db.getUserByEmail(email.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    await db.updateLastLogin(user.id);
    req.session.user = { id:user.id, email:user.email, name:user.name, initials:user.initials, role:user.role, program_id:user.program_id };
    await db.logAction(user.id, user.name, 'login', 'session', null, `Role: ${user.role}`);
    res.json({ user: req.session.user });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ success: true })); });
app.get('/api/auth/me', (req, res) => res.json({ user: req.session?.user || null }));

app.get('/api/programs', requireAuth, async (req, res) => {
  try {
    let programs = await db.getAllPrograms();
    const u = req.session.user;
    if (u.role !== 'executive' && u.role !== 'admin')
      programs = programs.filter(p => p.id === u.program_id);
    const scores = await db.getProgramScores();
    const scoreMap = {}; scores.forEach(s => { scoreMap[s.id] = s; });
    res.json(programs.map(p => ({ ...p, ...(scoreMap[p.id]||{}) })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dashboard', requireAuth, scopeProgram, async (req, res) => {
  try { res.json(await db.getDashboard(req.programScope, req.query.week_ending)); }
  catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/roster', requireAuth, scopeProgram, async (req, res) => {
  try { res.json(await db.getRoster(req.programScope, req.query.active !== 'false')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/roster', requireAuth, requireRole('executive','admin','program_director','supervisor'), async (req, res) => {
  try {
    const data = req.body;
    const u = req.session.user;
    if (u.role !== 'executive' && u.role !== 'admin') data.program_id = u.program_id;
    await db.addCase(data);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/roster/:caseId', requireAuth, async (req, res) => {
  try { await db.updateCase(req.params.caseId, req.body); res.json({ success: true }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/children/:caseId', requireAuth, async (req, res) => {
  try { res.json(await db.getChildrenForCase(req.params.caseId)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/children', requireAuth, scopeProgram, async (req, res) => {
try { res.json(await db.getAllActiveChildren(req.programScope)); } catch(e) { res.status(500).json({ error: e.message }); }