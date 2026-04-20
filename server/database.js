/**
 * server/database.js — PostgreSQL data layer using node-postgres (pg)
 */
const { pool } = require('./migrate');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function queryOne(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

// ── SCORE CALCULATION ─────────────────────────────────────────
function calcAllScores(responses) {
  const score = cadence => {
    const items = responses.filter(r =>
      !r.unscored &&
      (cadence === 'all' || r.cadence === cadence) &&
      r.response &&
      !['Not applicable', 'N/A', ''].includes(r.response)
    );
    if (!items.length) return null;
    return Math.round(items.filter(r => r.response === 'Yes').length / items.length * 100);
  };
  const ws = score('weekly');
  const ms = score('monthly');
  const qs = score('quarterly');
  const valid = [ws, ms, qs].filter(s => s != null);
  const ls = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  const w9  = responses.find(r => r.id === 'W9');
  const w10 = responses.find(r => r.id === 'W10');
  const sf  = w9?.response === 'Yes' &&
    (w10?.response === 'No' || w10?.response === 'Some but not all') ? 'Yes' : 'No';
  const q1  = responses.find(r => r.id === 'Q1');
  const fasp = q1?.response === 'Yes' ? 'Current'
             : q1?.response === 'No'  ? 'Overdue' : 'Pending';
  return { ws, ms, qs, ls, sf, fasp };
}

module.exports = {

  // ── AUTH ───────────────────────────────────────────────────
  async getUserByEmail(email) {
    return queryOne('SELECT * FROM users WHERE email=$1 AND active=true', [email]);
  },

  async updateLastLogin(userId) {
    await query('UPDATE users SET last_login=NOW() WHERE id=$1', [userId]);
  },

  // ── USER MANAGEMENT (admin) ────────────────────────────────
  async getAllUsers() {
    return query(
      'SELECT id,email,name,initials,role,program_id,active,created_at,last_login FROM users ORDER BY role,name'
    );
  },

  async createUser(data) {
    const hash = bcrypt.hashSync(data.password, 10);
    const initials = (data.initials || data.name.split(' ').map(p => p[0]).join('').slice(0, 2)).toUpperCase();
    return queryOne(
      `INSERT INTO users (email,password,name,initials,role,program_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [data.email.toLowerCase().trim(), hash, data.name, initials, data.role, data.program_id || null]
    );
  },

  async updateUser(id, data) {
    await query(
      'UPDATE users SET name=$1,role=$2,program_id=$3,active=$4 WHERE id=$5',
      [data.name, data.role, data.program_id || null, data.active !== false, id]
    );
  },

  async resetPassword(id, newPassword) {
    const hash = bcrypt.hashSync(newPassword, 10);
    await query('UPDATE users SET password=$1 WHERE id=$2', [hash, id]);
  },

  async deactivateUser(id) {
    await query('UPDATE users SET active=false WHERE id=$1', [id]);
  },

  // ── PROGRAMS ───────────────────────────────────────────────
  async getAllPrograms() {
    return query('SELECT * FROM programs WHERE active=true ORDER BY name');
  },

  async createProgram(data) {
    await query(
      `INSERT INTO programs (id,name,modality,borough,site_code)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=$2,modality=$3,borough=$4,site_code=$5`,
      [data.id, data.name, data.modality || null, data.borough || null, data.site_code || null]
    );
  },

  async getProgramScores() {
    const programs = await this.getAllPrograms();
    return Promise.all(programs.map(async p => {
      const scores = await queryOne(
        `SELECT ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms,
                ROUND(AVG(quarterly_score))::int as qs, ROUND(AVG(lifetime_score))::int as ls
         FROM entries WHERE program_id=$1`, [p.id]
      ) || {};
      const cases = parseInt((await queryOne(
        'SELECT COUNT(*) as c FROM roster WHERE program_id=$1 AND active=true', [p.id]
      ))?.c || 0);
      const flags = parseInt((await queryOne(
        "SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE program_id=$1 AND safety_flag='Yes'", [p.id]
      ))?.c || 0);
      const fasp = parseInt((await queryOne(
        "SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE program_id=$1 AND fasp_status='Overdue'", [p.id]
      ))?.c || 0);
      return { ...p, cases, ...scores, flags, fasp };
    }));
  },

  async getWeeklyTrend(programId) {
    const rows = programId
      ? await query(
          `SELECT week_ending, ROUND(AVG(weekly_score))::int as score
           FROM entries WHERE weekly_score IS NOT NULL AND program_id=$1
           GROUP BY week_ending ORDER BY week_ending DESC LIMIT 12`, [programId])
      : await query(
          `SELECT week_ending, ROUND(AVG(weekly_score))::int as score
           FROM entries WHERE weekly_score IS NOT NULL
           GROUP BY week_ending ORDER BY week_ending DESC LIMIT 12`);
    return rows.reverse();
  },

  // ── ROSTER ─────────────────────────────────────────────────
  async getRoster(programId, activeOnly = true) {
    let sql = 'SELECT * FROM roster WHERE 1=1';
    const params = [];
    if (programId)  { sql += ` AND program_id=$${params.push(programId)}`; }
    if (activeOnly) { sql += ' AND active=true'; }
    sql += ' ORDER BY case_id';
    return query(sql, params);
  },

  async addCase(data) {
    await query(
      `INSERT INTO roster (case_id,household_id,program_id,planner_name,supervisor_name,open_date,children_count,modality,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (case_id) DO NOTHING`,
      [data.case_id, data.household_id, data.program_id, data.planner_name,
       data.supervisor_name, data.open_date, data.children_count || 1, data.modality, data.notes || '']
    );
  },

  async updateCase(caseId, data) {
    await query(
      'UPDATE roster SET planner_name=$1,supervisor_name=$2,children_count=$3,active=$4,notes=$5 WHERE case_id=$6',
      [data.planner_name, data.supervisor_name, data.children_count, data.active !== false, data.notes || '', caseId]
    );
  },

  // ── ENTRIES ────────────────────────────────────────────────
  async saveEntry(entry, userId, userName, userRole) {
    const responses = entry.responses || [];
    const { ws, ms, qs, ls, sf, fasp } = calcAllScores(responses);
    const recordId = 'LOG-' + uuidv4().slice(0, 8).toUpperCase();
    await query(
      `INSERT INTO entries
       (record_id,case_id,program_id,week_ending,submitted_by,submitted_name,submitted_role,
        case_planner,household_id,children_count,submission_notes,responses,
        weekly_score,monthly_score,quarterly_score,lifetime_score,safety_flag,fasp_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [recordId, entry.case_id, entry.program_id, entry.week_ending,
       userId, userName, userRole, entry.case_planner, entry.household_id,
       entry.children_count, entry.submission_notes, JSON.stringify(responses),
       ws, ms, qs, ls, sf, fasp]
    );
  },

  async updateEntry(id, entry, userId) {
    const responses = entry.responses || [];
    const { ws, ms, qs, ls, sf, fasp } = calcAllScores(responses);
    await query(
      `UPDATE entries SET responses=$1,weekly_score=$2,monthly_score=$3,quarterly_score=$4,
       lifetime_score=$5,safety_flag=$6,fasp_status=$7,case_planner=$8,children_count=$9,
       submission_notes=$10,last_edited_by=$11,last_edited_at=NOW()
       WHERE id=$12 AND reviewed=false`,
      [JSON.stringify(responses), ws, ms, qs, ls, sf, fasp,
       entry.case_planner, entry.children_count, entry.submission_notes, userId, id]
    );
  },

  async reviewEntry(id, reviewerId) {
    await query(
      'UPDATE entries SET reviewed=true,reviewed_by=$1,reviewed_at=NOW() WHERE id=$2',
      [reviewerId, id]
    );
  },

  async getEntries({ caseId, programId, weekEnding, planner, dateFrom, dateTo, limit = 500 }) {
    let sql = 'SELECT * FROM entries WHERE 1=1';
    const params = [];
    if (caseId)     { sql += ` AND case_id=$${params.push(caseId)}`; }
    if (programId)  { sql += ` AND program_id=$${params.push(programId)}`; }
    if (weekEnding) { sql += ` AND week_ending=$${params.push(weekEnding)}`; }
    if (planner)    { sql += ` AND case_planner=$${params.push(planner)}`; }
    if (dateFrom)   { sql += ` AND week_ending>=$${params.push(dateFrom)}`; }
    if (dateTo)     { sql += ` AND week_ending<=$${params.push(dateTo)}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.push(limit)}`;
    const rows = await query(sql, params);
    return rows.map(e => ({
      ...e,
      responses: Array.isArray(e.responses) ? e.responses : JSON.parse(e.responses || '[]'),
    }));
  },

  async getLatestPerCase(programId) {
    let sql = `
      SELECT e.* FROM entries e
      JOIN (
        SELECT case_id, MAX(id) as mid FROM entries
        ${programId ? 'WHERE program_id=$1' : ''}
        GROUP BY case_id
      ) m ON e.id = m.mid
      ORDER BY e.case_id`;
    const rows = await query(sql, programId ? [programId] : []);
    return rows.map(e => ({
      ...e,
      responses: Array.isArray(e.responses) ? e.responses : JSON.parse(e.responses || '[]'),
    }));
  },

  // ── DASHBOARD ──────────────────────────────────────────────
  async getDashboard(programId, weekEnding) {
    const we = weekEnding || new Date().toISOString().slice(0, 10);
    const pf = programId ? ` AND program_id='${programId}'` : '';

    const totalCases = parseInt((await queryOne(
      `SELECT COUNT(*) as c FROM roster WHERE active=true${pf.replace(/program_id='.*?'/, `program_id=$1`)}`,
      programId ? [programId] : []
    ))?.c || 0);

    const safetyFlags = parseInt((await queryOne(
      `SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE safety_flag='Yes'${pf}`,
      programId ? [programId] : []
    ))?.c || 0);

    const faspOver = parseInt((await queryOne(
      `SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE fasp_status='Overdue'${pf}`,
      programId ? [programId] : []
    ))?.c || 0);

    const scoresQuery = programId
      ? `SELECT ROUND(AVG(CASE WHEN week_ending=$1 THEN weekly_score END))::int as weekly,
               ROUND(AVG(monthly_score))::int as monthly,
               ROUND(AVG(quarterly_score))::int as quarterly,
               ROUND(AVG(lifetime_score))::int as lifetime
         FROM entries WHERE program_id=$2`
      : `SELECT ROUND(AVG(CASE WHEN week_ending=$1 THEN weekly_score END))::int as weekly,
               ROUND(AVG(monthly_score))::int as monthly,
               ROUND(AVG(quarterly_score))::int as quarterly,
               ROUND(AVG(lifetime_score))::int as lifetime
         FROM entries`;
    const scores = await queryOne(scoresQuery, programId ? [we, programId] : [we]) || {};

    const byPlannerQuery = programId
      ? `SELECT case_planner,
               ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms,
               ROUND(AVG(quarterly_score))::int as qs, ROUND(AVG(lifetime_score))::int as ls,
               COUNT(*) as entries
         FROM entries WHERE case_planner IS NOT NULL AND program_id=$1
         GROUP BY case_planner ORDER BY case_planner`
      : `SELECT case_planner,
               ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms,
               ROUND(AVG(quarterly_score))::int as qs, ROUND(AVG(lifetime_score))::int as ls,
               COUNT(*) as entries
         FROM entries WHERE case_planner IS NOT NULL
         GROUP BY case_planner ORDER BY case_planner`;
    const byPlanner = await query(byPlannerQuery, programId ? [programId] : []);

    const caseScores = await this.getLatestPerCase(programId);
    const trend      = await this.getWeeklyTrend(programId);
    const programs   = programId ? null : await this.getProgramScores();

    return { totalCases, safetyFlags, faspOver, scores, byPlanner, caseScores, trend, programs };
  },

  // ── SUPERVISION LOG ────────────────────────────────────────
  async getSupervisionLog(filters = {}) {
    let sql = 'SELECT * FROM supervision_log WHERE 1=1';
    const params = [];
    if (filters.programId) { sql += ` AND program_id=$${params.push(filters.programId)}`; }
    if (filters.staffName) { sql += ` AND staff_name=$${params.push(filters.staffName)}`; }
    if (filters.caseId)    { sql += ` AND case_id=$${params.push(filters.caseId)}`; }
    sql += ' ORDER BY staff_name, created_at DESC';
    return query(sql, params);
  },

  async addSupervisionNote(data, authorId, authorName, authorRole) {
    await query(
      `INSERT INTO supervision_log
       (program_id,case_id,staff_name,author_id,author_name,author_role,domain,content,action_item,due_date,status,entry_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [data.program_id, data.case_id, data.staff_name, authorId, authorName, authorRole,
       data.domain, data.content, data.action_item || null, data.due_date || null,
       data.status || 'Open', data.entry_type || 'note']
    );
  },

  async resolveSupervisionNote(id) {
    await query(
      "UPDATE supervision_log SET resolved=true,status='Resolved',resolved_at=NOW() WHERE id=$1",
      [id]
    );
  },

  // ── STAFF ──────────────────────────────────────────────────
  async getStaff(programId) {
    const users = await query(
      "SELECT id,name,initials,email,role FROM users WHERE program_id=$1 AND role='staff' AND active=true",
      [programId]
    );
    return Promise.all(users.map(async u => {
      const scores = await queryOne(
        `SELECT ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms,
                ROUND(AVG(quarterly_score))::int as qs, COUNT(*) as entries
         FROM entries WHERE case_planner=$1 AND program_id=$2`, [u.name, programId]
      ) || {};
      const cases = parseInt((await queryOne(
        'SELECT COUNT(*) as c FROM roster WHERE planner_name=$1 AND program_id=$2 AND active=true',
        [u.name, programId]
      ))?.c || 0);
      return { ...u, ...scores, cases };
    }));
  },

  // ── AUDIT LOG ──────────────────────────────────────────────
  async logAction(userId, userName, action, entityType, entityId, detail) {
    await query(
      'INSERT INTO audit_log (user_id,user_name,action,entity_type,entity_id,detail) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, userName, action, entityType, entityId, detail]
    );
  },

  // ── CSV EXPORT ─────────────────────────────────────────────
  async entriesToCSV(entries, mode = 'full') {
    const esc = v => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    if (mode === 'summary') {
      const cols = ['case_id','program_id','week_ending','case_planner','submitted_name',
        'weekly_score','monthly_score','quarterly_score','lifetime_score',
        'safety_flag','fasp_status','reviewed','created_at'];
      return [cols.join(','), ...entries.map(e => cols.map(c => esc(e[c])).join(','))].join('\r\n');
    }
    const IDS = ['W1','W2','W3','W4','W5','W6','W9','W10','W11','W12',
      'M1','M2','M3','M4','M5','M6','Q1','Q2','Q3','Q4','Q5','Q6','Q7',
      'Q8','Q9','Q10','Q11','Q12','Q13','Q14','Q16','Q17'];
    const base = ['record_id','program_id','case_id','week_ending','case_planner',
      'submitted_name','submitted_role','children_count'];
    const header = [...base, ...IDS.flatMap(id => [`${id}_Response`,`${id}_Notes`]),
      'Weekly_Score','Monthly_Score','Quarterly_Score','Lifetime_Score',
      'Safety_Flag','FASP_Status','Reviewed'].join(',');
    const rows = entries.map(e => {
      const rmap = {};
      (e.responses || []).forEach(r => { rmap[r.id+'_r'] = r.response||''; rmap[r.id+'_n'] = r.notes||''; });
      return [
        ...base.map(c => esc(e[c])),
        ...IDS.flatMap(id => [esc(rmap[id+'_r']), esc(rmap[id+'_n'])]),
        esc(e.weekly_score != null ? e.weekly_score+'%' : ''),
        esc(e.monthly_score != null ? e.monthly_score+'%' : ''),
        esc(e.quarterly_score != null ? e.quarterly_score+'%' : ''),
        esc(e.lifetime_score != null ? e.lifetime_score+'%' : ''),
        esc(e.safety_flag), esc(e.fasp_status), esc(e.reviewed ? 'Yes' : 'No'),
      ].join(',');
    });
    return [header, ...rows].join('\r\n');
  },
};
