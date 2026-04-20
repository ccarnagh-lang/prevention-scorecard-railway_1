/* shared.js — Views accessible across multiple roles */

const SharedViews = {

  // ── ENTRY FORM ─────────────────────────────────────────────
  async renderEntry(roster) {
    UI.setTitle('New Entry');
    UI.setTopbar(`<span class="wpill">Week ending ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>`);

    const cases = roster || await API.get('/api/roster') || [];

    const buildRows = reqs => reqs.map(r => UI.buildReqRow(r)).join('');
    const buildSection = (reqs, id) =>
      Object.entries(reqs).map(([key, items]) =>
        `<div class="req-sec-hdr">${key.charAt(0).toUpperCase()+key.slice(1)}</div>` + buildRows(items)
      ).join('');

    UI.setContent(`
      <div class="score-strip">
        <div class="score-tile"><div class="score-tile-label">Weekly score</div><div class="score-tile-value" id="sw">—</div></div>
        <div class="score-tile"><div class="score-tile-label">Monthly score</div><div class="score-tile-value" id="sm">—</div></div>
        <div class="score-tile"><div class="score-tile-label">Quarterly score</div><div class="score-tile-value" id="sq">—</div></div>
        <div class="score-tile"><div class="score-tile-label">Rating</div><div class="score-tile-value" id="sr" style="font-size:14px">—</div></div>
      </div>

      <div class="form-card">
        <div class="fc-title">Case identification</div>
        <div class="grid-3">
          <div class="field"><label>Case ID (CNNX)</label>
            <select id="f-case" onchange="SharedViews.entryAutoFill(this)">
              <option value="">— Select case —</option>
              ${cases.map(c => `<option value="${c.case_id}" data-pl="${c.planner_name}" data-hh="${c.household_id}" data-ch="${c.children_count}">${c.case_id}</option>`).join('')}
            </select></div>
          <div class="field"><label>Case planner</label>
            <select id="f-planner">
              ${[...new Set(cases.map(c=>c.planner_name).filter(Boolean))].map(p=>`<option>${p}</option>`).join('')}
            </select></div>
          <div class="field"><label>Week ending</label><input type="date" id="f-week"></div>
          <div class="field"><label>Household ID</label><input type="text" id="f-hh" placeholder="HH-####"></div>
          <div class="field"><label># Children in home</label><input type="number" id="f-ch" value="1" min="1" max="15"></div>
          <div class="field"><label>Submission notes</label><input type="text" id="f-notes" placeholder="Optional..."></div>
        </div>
      </div>

      <div class="form-card">
        <div class="fc-title">Section A — weekly requirements <span class="field-tag" style="background:#E1F5EE;color:#085041">10 items</span></div>
        ${buildRows(REQS.weekly)}
      </div>
      <div class="form-card">
        <div class="fc-title">Section B — monthly requirements <span class="field-tag" style="background:#E6F1FB;color:#185FA5">5 items</span></div>
        ${buildRows(REQS.monthly)}
      </div>
      <div class="form-card">
        <div class="fc-title">Section C — quarterly requirements <span class="field-tag" style="background:#EEEDFE;color:#3C3489">18 items</span></div>
        ${buildSection(REQS.quarterly)}
      </div>

      <div style="display:flex;gap:8px;padding-bottom:32px">
        <button class="btn btn-p" style="padding:10px 28px;font-size:14px" onclick="SharedViews.submitEntry()">Save entry</button>
        <button class="btn btn-pu" style="padding:10px 20px;font-size:14px" onclick="SharedViews.submitAndNote()">Save &amp; generate sup note</button>
        <button class="btn" onclick="SharedViews.clearEntry()">Clear form</button>
      </div>
    `);

    document.getElementById('f-week').valueAsDate = new Date();
    document.querySelectorAll('.req-sel').forEach(s => this.styleReq(s));
  },

  styleReq(sel) {
    sel.className = 'req-sel';
    const v = sel.value;
    if (v === 'Yes') sel.classList.add('yes');
    else if (v === 'No') sel.classList.add('no');
    else if (v === 'Some but not all') sel.classList.add('partial');
    this.calcScore();
  },

  calcScore() {
    const score = ids => {
      let yes=0, tot=0;
      ids.forEach(id => {
        const el = document.getElementById('rq-'+id);
        if (!el) return;
        const v = el.value;
        if (!v || v === 'Not applicable' || v === '') return;
        tot++;
        if (v === 'Yes') yes++;
      });
      return tot ? Math.round(yes/tot*100) : null;
    };
    const allQ = Object.values(REQS.quarterly).flat().filter(r=>!r.unscored);
    const ws = score(REQS.weekly.filter(r=>!r.unscored).map(r=>r.id));
    const ms = score(REQS.monthly.filter(r=>!r.unscored).map(r=>r.id));
    const qs = score(allQ.map(r=>r.id));
    const swEl = document.getElementById('sw');
    if (swEl) swEl.textContent = ws != null ? ws+'%' : '—';
    const smEl = document.getElementById('sm');
    if (smEl) smEl.textContent = ms != null ? ms+'%' : '—';
    const sqEl = document.getElementById('sq');
    if (sqEl) sqEl.textContent = qs != null ? qs+'%' : '—';
    const srEl = document.getElementById('sr');
    if (srEl && ws != null) srEl.textContent = ws>=90?'Strong':ws>=75?'Adequate':'Needs Attention';
  },

  entryAutoFill(sel) {
    const opt = sel.options[sel.selectedIndex];
    if (!opt.value) return;
    const pl = document.getElementById('f-planner');
    if (pl && opt.dataset.pl) pl.value = opt.dataset.pl;
    const hh = document.getElementById('f-hh');
    if (hh && opt.dataset.hh) hh.value = opt.dataset.hh;
    const ch = document.getElementById('f-ch');
    if (ch && opt.dataset.ch) ch.value = opt.dataset.ch;
  },

  collectEntry() {
    const caseId = document.getElementById('f-case')?.value;
    if (!caseId) { UI.toast('Please select a Case ID', 'error'); return null; }
    const week  = document.getElementById('f-week')?.value;
    if (!week)  { UI.toast('Please enter a week ending date', 'error'); return null; }
    const responses = REQS.allFlat().map(r => ({
      id: r.id, name: r.name, section: r.section, cadence: r.cadence,
      response: document.getElementById('rq-'+r.id)?.value || '',
      notes:    document.getElementById('rn-'+r.id)?.value || '',
      unscored: r.unscored || false,
    }));
    return {
      case_id:          caseId,
      case_planner:     document.getElementById('f-planner')?.value || '',
      week_ending:      week,
      household_id:     document.getElementById('f-hh')?.value || '',
      children_count:   parseInt(document.getElementById('f-ch')?.value) || 1,
      submission_notes: document.getElementById('f-notes')?.value || '',
      responses,
    };
  },

  async submitEntry() {
    const entry = this.collectEntry();
    if (!entry) return;
    try {
      await API.post('/api/entries', entry);
      UI.toast('Entry saved for ' + entry.case_id, 'success');
      this.clearEntry();
    } catch(e) { UI.toast('Save failed: ' + e.message, 'error'); }
  },

  async submitAndNote() {
    const entry = this.collectEntry();
    if (!entry) return;
    try {
      await API.post('/api/entries', entry);
      sessionStorage.setItem('sn_case', entry.case_id);
      App.nav('supnote');
    } catch(e) { UI.toast('Save failed: ' + e.message, 'error'); }
  },

  clearEntry() {
    document.getElementById('f-case').value = '';
    document.getElementById('f-hh').value = '';
    document.getElementById('f-notes').value = '';
    document.getElementById('f-ch').value = '1';
    document.querySelectorAll('.req-sel').forEach(s => { s.selectedIndex=0; this.styleReq(s); });
    document.querySelectorAll('.req-note').forEach(i => i.value = '');
  },

  // ── CASE LIST ─────────────────────────────────────────────
  async renderCases(programId) {
    UI.setTitle('Case List');
    const entries = await API.get('/api/entries/latest' + (programId ? `?program_id=${programId}` : '')) || [];
    UI.setTopbar(`<span class="wpill">${entries.length} cases</span>
      <select id="fl-planner" onchange="SharedViews.filterCases()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All planners</option>
        ${[...new Set(entries.map(e=>e.case_planner).filter(Boolean))].map(p=>`<option>${p}</option>`).join('')}
      </select>
      <select id="fl-fasp" onchange="SharedViews.filterCases()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All FASP</option><option>Current</option><option>Overdue</option><option>Pending</option>
      </select>
      <input type="text" id="fl-search" oninput="SharedViews.filterCases()" placeholder="Search case ID..." style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">`);

    SharedViews._caseData = entries;
    UI.setContent(`
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Case ID</th><th>Case Planner</th><th>Week ending</th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Lifetime</th><th>Safety</th><th>FASP</th><th>Reviewed</th><th></th></tr></thead>
          <tbody id="case-tbody"></tbody>
        </table>
      </div>`);
    this.filterCases();
  },

  filterCases() {
    const pl  = document.getElementById('fl-planner')?.value || '';
    const fp  = document.getElementById('fl-fasp')?.value || '';
    const srch= (document.getElementById('fl-search')?.value || '').toLowerCase();
    const filtered = (SharedViews._caseData || []).filter(e =>
      (!pl   || e.case_planner === pl) &&
      (!fp   || e.fasp_status === fp) &&
      (!srch || (e.case_id||'').toLowerCase().includes(srch))
    );
    document.getElementById('case-tbody').innerHTML = filtered.length
      ? filtered.map(e => `<tr>
          <td class="mono bold" style="color:#1B3A5C">${e.case_id}</td>
          <td>${e.case_planner||'—'}</td>
          <td style="color:#aaa;font-size:12px">${e.week_ending||'—'}</td>
          <td>${UI.badge(e.weekly_score)}</td>
          <td>${UI.badge(e.monthly_score)}</td>
          <td>${UI.badge(e.quarterly_score)}</td>
          <td>${UI.badge(e.lifetime_score)}</td>
          <td>${e.safety_flag==='Yes'?'<span class="badge badge-red">Flag</span>':'<span class="badge badge-gray">—</span>'}</td>
          <td>${UI.faspBadge(e.fasp_status)}</td>
          <td>${e.reviewed?'<span class="badge badge-green">Reviewed</span>':'<span class="badge badge-gray">Pending</span>'}</td>
          <td><button class="btn btn-xs" onclick="sessionStorage.setItem('sn_case','${e.case_id}');App.nav('supnote')">Sup note</button></td>
        </tr>`).join('')
      : '<tr><td colspan="11" class="empty-state">No cases match filters</td></tr>';
  },

  // ── SUPERVISION LOG ─────────────────────────────────────
  async renderSuplog(programId) {
    UI.setTitle('Supervision Log');
    const [logs, staff] = await Promise.all([
      API.get('/api/supervision-log' + (programId ? `?program_id=${programId}` : '')),
      API.get('/api/staff' + (programId ? `?program_id=${programId}` : '')),
    ]);
    const supLogs = logs || [];
    const staffList = staff || [];

    UI.setTopbar(`
      <select id="sl-staff" onchange="SharedViews.renderSuplogContent()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All staff</option>
        ${staffList.map(s=>`<option>${s.name}</option>`).join('')}
      </select>
      <button class="btn btn-p btn-sm" onclick="SharedViews.addSupNote('${programId||''}')">+ Add note</button>`);

    SharedViews._supLogs  = supLogs;
    SharedViews._supStaff = staffList;
    this.renderSuplogContent();
  },

  renderSuplogContent() {
    const filterStaff = document.getElementById('sl-staff')?.value || '';
    const logs  = SharedViews._supLogs  || [];
    const staff = SharedViews._supStaff || [];

    const staffNames = filterStaff ? [filterStaff] : [...new Set(staff.map(s=>s.name))];

    let html = '';
    staffNames.forEach(name => {
      const sdata = staff.find(s=>s.name===name);
      const sLogs = logs.filter(l => l.staff_name===name).sort((a,b)=>b.created_at.localeCompare(a.created_at));

      html += `
        <div class="staff-section">
          <div class="staff-header">
            <div class="staff-info">
              <div class="staff-av" style="background:#1B3A5C">${UI.initials(name)}</div>
              <div>
                <div class="staff-name">${name}</div>
                <div class="staff-meta">${sdata?.cases||0} cases &nbsp;|&nbsp; ${sLogs.length} supervision entries ${sdata?.ws!=null?`&nbsp;|&nbsp; Weekly avg: ${Math.round(sdata.ws)}%`:''}</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${sdata?.ws != null ? UI.badge(sdata.ws) : ''}
              <button class="btn btn-p btn-xs" onclick="sessionStorage.setItem('sn_case','');sessionStorage.setItem('sn_staff','${name}');App.nav('supnote')">Generate note</button>
            </div>
          </div>
          <div class="thread">
            ${sLogs.length ? sLogs.map(l => {
              const isMe = l.author_role === 'supervisor' || l.author_role === 'program_director' || l.author_role === 'executive';
              return `
                <div class="thread-entry">
                  <div class="thread-av" style="background:${isMe?'#993C1D':'#1B3A5C'}">${UI.initials(l.author_name)}</div>
                  <div style="flex:1">
                    <div class="thread-bubble${isMe?' mine':''}">
                      <div class="thread-meta">${l.author_name} &nbsp;·&nbsp; ${l.author_role} &nbsp;·&nbsp; ${l.created_at?.slice(0,10)||''}${l.domain?` &nbsp;·&nbsp; ${l.domain}`:''}</div>
                      <div class="thread-text">${l.content}</div>
                      ${l.action_item?`<div class="thread-action">Action: ${l.action_item}${l.due_date?' — due '+l.due_date:''}</div>`:''}
                    </div>
                    ${!l.resolved && isMe ? `<div style="margin-top:4px"><button class="btn btn-xs" onclick="SharedViews.resolveNote(${l.id})">Mark resolved</button></div>` : ''}
                    ${l.resolved ? `<div style="font-size:11px;color:#aaa;margin-top:4px">Resolved ${l.resolved_at?.slice(0,10)||''}</div>` : ''}
                  </div>
                </div>`;
            }).join('') : '<div style="color:#aaa;font-size:12px;text-align:center;padding:12px">No supervision notes yet for this staff member.</div>'}
            <div class="thread-add">
              <input type="text" id="note-input-${name.replace(/\s/g,'_')}" placeholder="Add a supervision note...">
              <button class="btn btn-p btn-sm" onclick="SharedViews.postNote('${name}','${SharedViews._currentProgramId||''}')">Post</button>
            </div>
          </div>
        </div>`;
    });

    document.getElementById('main-content').innerHTML = html || '<div class="empty-state">No staff found.</div>';
    SharedViews._currentProgramId = (SharedViews._supLogs||[])[0]?.program_id || '';
  },

  async postNote(staffName, programId) {
    const inputId = 'note-input-' + staffName.replace(/\s/g,'_');
    const input = document.getElementById(inputId);
    if (!input?.value.trim()) return;
    try {
      await API.post('/api/supervision-log', {
        program_id: programId,
        staff_name: staffName,
        content: input.value.trim(),
        entry_type: 'note',
      });
      input.value = '';
      await this.renderSuplog(programId);
      UI.toast('Note added', 'success');
    } catch(e) { UI.toast('Failed: '+e.message, 'error'); }
  },

  async resolveNote(id) {
    await API.put(`/api/supervision-log/${id}/resolve`, {});
    UI.toast('Marked as resolved', 'success');
    await this.renderSuplog(SharedViews._currentProgramId);
  },

  addSupNote(programId) {
    const staff = SharedViews._supStaff || [];
    UI.modal(`
      <div class="modal-title">Add supervision note</div>
      <div class="grid-2">
        <div class="field"><label>Staff member</label>
          <select id="mn-staff"><option value="">Select...</option>${staff.map(s=>`<option>${s.name}</option>`).join('')}</select></div>
        <div class="field"><label>Case ID (optional)</label><input type="text" id="mn-case" placeholder="QNS-2024-###"></div>
      </div>
      <div class="field" style="margin-bottom:10px"><label>Domain / Area</label><input type="text" id="mn-domain" placeholder="e.g. Safety/Risk — W9/W10"></div>
      <div class="field" style="margin-bottom:10px"><label>Supervision note</label><textarea id="mn-content" rows="4" placeholder="Describe the finding, observation, or guidance..."></textarea></div>
      <div class="field" style="margin-bottom:10px"><label>Action item (optional)</label><input type="text" id="mn-action" placeholder="What must be completed?"></div>
      <div class="grid-2">
        <div class="field"><label>Due date</label><input type="date" id="mn-due"></div>
        <div class="field"><label>Status</label><select id="mn-status"><option>Open</option><option>In Progress</option></select></div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Save note</button>
      </div>`,
      async () => {
        const staff = document.getElementById('mn-staff')?.value;
        const content = document.getElementById('mn-content')?.value;
        if (!staff || !content) { UI.toast('Staff and note content required', 'error'); return; }
        await API.post('/api/supervision-log', {
          program_id:  programId,
          case_id:     document.getElementById('mn-case')?.value || null,
          staff_name:  staff,
          domain:      document.getElementById('mn-domain')?.value,
          content,
          action_item: document.getElementById('mn-action')?.value,
          due_date:    document.getElementById('mn-due')?.value,
          status:      document.getElementById('mn-status')?.value,
        });
        UI.toast('Supervision note saved', 'success');
        await SharedViews.renderSuplog(programId);
      }
    );
  },

  // ── SUPERVISORY NOTE ────────────────────────────────────
  async renderSupnote(programId) {
    UI.setTitle('Supervisory Note');
    const roster = await API.get('/api/roster' + (programId?`?program_id=${programId}`:'')) || [];
    const preCase = sessionStorage.getItem('sn_case') || '';
    sessionStorage.removeItem('sn_case');

    let dischargeReady = false;

    UI.setTopbar(`
      <select id="sn-case" onchange="SharedViews.refreshNote()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">— Select case —</option>
        ${roster.map(r=>`<option value="${r.case_id}" ${r.case_id===preCase?'selected':''}>${r.case_id} — ${r.planner_name||'—'}</option>`).join('')}
      </select>
      <button class="btn btn-pu btn-sm" onclick="SharedViews.exportNote()">Export .docx</button>
      <button class="btn btn-sm" onclick="window.print()">Print PDF</button>`);

    UI.setContent(`
      <div style="display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start">
        <div>
          <div class="form-card" style="margin-bottom:10px">
            <div class="fc-title">Note settings</div>
            <div class="field" style="margin-bottom:10px"><label>Supervisor</label>
              <input type="text" id="sn-sup" value="${Auth.user?.name||''}" oninput="SharedViews.refreshNote()"></div>
            <div class="field" style="margin-bottom:10px"><label>License / Credential</label>
              <input type="text" id="sn-lic" placeholder="LMSW #XXXXXX"></div>
            <div class="field" style="margin-bottom:10px"><label>Title</label>
              <input type="text" id="sn-title" value="Program Supervisor — Prevention Services"></div>
            <div style="border-top:1px solid #F0F2F5;padding-top:12px;margin-top:4px">
              <div style="font-size:11px;font-weight:600;color:#666;margin-bottom:8px">Discharge readiness</div>
              <div class="disc-toggle" style="margin-bottom:10px">
                <button class="disc-btn no" id="disc-no"  onclick="SharedViews.setDischarge(false)">Not ready</button>
                <button class="disc-btn"    id="disc-yes" onclick="SharedViews.setDischarge(true)">Ready for discharge</button>
              </div>
              <div class="field" style="margin-bottom:10px"><label>Discharge notes</label>
                <textarea id="sn-disc" rows="3" oninput="SharedViews.refreshNote()"></textarea></div>
            </div>
            <div class="field" style="margin-bottom:10px"><label>Supervisor narrative</label>
              <textarea id="sn-narr" rows="5" oninput="SharedViews.refreshNote()"></textarea></div>
            <div style="border-top:1px solid #F0F2F5;padding-top:12px">
              <div style="font-size:11px;font-weight:600;color:#666;margin-bottom:6px">E-signature</div>
              <div class="field" style="margin-bottom:6px"><label>Type full name to sign</label>
                <input type="text" id="sn-sig" placeholder="${Auth.user?.name||'Your name'}" oninput="SharedViews.refreshNote()" style="font-style:italic;font-size:14px"></div>
              <div style="font-size:11px;color:#aaa">By signing you certify this review is accurate and actions have been communicated to the case planner.</div>
            </div>
          </div>
          <button class="btn btn-pu btn-block" style="padding:11px;font-size:13px;margin-bottom:7px" onclick="SharedViews.exportNote()">Export as Word (.docx)</button>
          <button class="btn btn-block" style="padding:10px;font-size:12px;margin-bottom:7px" onclick="window.print()">Print / Save as PDF</button>
          <button class="btn btn-block" style="padding:9px;font-size:12px" onclick="SharedViews.refreshNote()">Refresh preview</button>
        </div>
        <div style="background:#fff;border:1px solid #E8ECF0;border-radius:10px;overflow:hidden">
          <div style="background:#1B3A5C;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:13px;font-weight:600;color:#fff">Supervisory Case Note &amp; Compliance Report</div>
              <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:2px">Prevention Services &nbsp;|&nbsp; CONFIDENTIAL</div></div>
            <div style="text-align:right"><div style="font-size:10px;color:rgba(255,255,255,.4)">Case</div>
              <div style="font-size:14px;font-weight:700;color:#fff" id="np-caseid">${preCase||'—'}</div></div>
          </div>
          <div style="max-height:780px;overflow-y:auto;padding:20px;font-size:12px;line-height:1.6;color:#333" id="np-body">
            <div class="empty-state">Select a case above to generate the supervisory note preview.</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#F8F9FB;border-top:1px solid #E8ECF0">
            <span style="font-size:11px;color:#aaa" id="np-status">Select a case to begin</span>
            <div style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn-xs" onclick="window.print()">Print</button>
              <button class="btn btn-xs btn-pu" onclick="SharedViews.exportNote()">Export .docx</button>
            </div>
          </div>
        </div>
      </div>`);

    if (preCase) await this.refreshNote();
  },

  setDischarge(val) {
    SharedViews._discharge = val;
    document.getElementById('disc-yes').className = 'disc-btn'+(val?' yes':'');
    document.getElementById('disc-no').className  = 'disc-btn'+(val?''  :' no');
    this.refreshNote();
  },

  async refreshNote() {
    const caseId = document.getElementById('sn-case')?.value;
    if (!caseId) return;
    document.getElementById('np-caseid').textContent = caseId;

    const [entries, roster] = await Promise.all([
      API.get(`/api/entries?case_id=${caseId}&limit=100`),
      API.get('/api/roster?active=false'),
    ]);
    const latest = (entries||[])[0] || null;
    const rc = (roster||[]).find(r => r.case_id === caseId);
    const resp = latest?.responses || [];
    const byId = {}; resp.forEach(r => { byId[r.id] = r; });
    const names = REQS.nameMap();

    const sup  = document.getElementById('sn-sup')?.value || Auth.user?.name || '';
    const sig  = document.getElementById('sn-sig')?.value || '';
    const narr = document.getElementById('sn-narr')?.value || '';
    const disc = document.getElementById('sn-disc')?.value || '';
    const dr   = SharedViews._discharge || false;
    const today= new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

    const ws = latest?.weekly_score!=null?Math.round(latest.weekly_score)+'%':'—';
    const ms = latest?.monthly_score!=null?Math.round(latest.monthly_score)+'%':'—';
    const qs = latest?.quarterly_score!=null?Math.round(latest.quarterly_score)+'%':'—';
    const ls = latest?.lifetime_score!=null?Math.round(latest.lifetime_score)+'%':'—';
    const sc  = latest?.weekly_score || 0;
    const rating = sc>=90?'Strong':sc>=75?'Adequate':'Needs Attention';
    const rBg  = sc>=90?'#EAF3DE':sc>=75?'#FAEEDA':'#FCEBEB';
    const rClr = sc>=90?'#27500A':sc>=75?'#633806':'#791F1F';
    const fasp = latest?.fasp_status || 'Pending';
    const sf   = latest?.safety_flag  || 'No';

    const reqRow = id => {
      const r = byId[id] || {};
      const rc2 = UI.respClass(r.response);
      return `<tr><td class="mono" style="color:#534AB7;font-size:10px">${id}</td>
        <td style="font-size:11px">${names[id]||id}</td>
        <td><span style="padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;background:${r.response==='Yes'?'#EAF3DE':r.response==='No'?'#FCEBEB':r.response==='Some but not all'?'#FAEEDA':'#F5F7FA'};color:${r.response==='Yes'?'#27500A':r.response==='No'?'#791F1F':r.response==='Some but not all'?'#633806':'#aaa'}">${r.response||'—'}</span></td>
        <td style="font-size:11px;color:#555">${r.notes||''}</td></tr>`;
    };

    const wids = REQS.weekly.map(r=>r.id);
    const mids = REQS.monthly.map(r=>r.id);
    const qids = Object.values(REQS.quarterly).flat().map(r=>r.id);

    document.getElementById('np-body').innerHTML = `
      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Case identification</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 20px;margin-bottom:12px;font-size:12px">
        ${[['Case ID',caseId],['Report date',today],['Case planner',rc?.planner_name||latest?.case_planner||'—'],['Supervisor',sup],['Program',rc?.program_id||'—'],['FASP status',fasp]].map(([l,v])=>`<div><span style="color:#888;font-weight:600">${l}: </span><span>${v}</span></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">
        ${[['Weekly',ws,latest?.weekly_score],['Monthly',ms,null],['Quarterly',qs,null],['Lifetime',ls,null]].map(([l,v,s])=>`
          <div style="background:#1B3A5C;border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:9px;color:rgba(255,255,255,.4);margin-bottom:3px;font-weight:600">${l}</div>
            <div style="font-size:18px;font-weight:700;color:${s!=null?(s>=90?'#5DCAA5':s>=75?'#FAC775':'#F09595'):'#A0C4E8'}">${v}</div>
          </div>`).join('')}
      </div>
      <div style="padding:7px 12px;border-radius:6px;background:${rBg};color:${rClr};font-size:12px;font-weight:700;text-align:center;margin-bottom:14px">Overall Rating: ${rating}</div>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Section A — weekly requirements</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px">
        <thead><tr style="background:#1B3A5C">${['ID','Requirement','Response','Notes'].map(h=>`<th style="color:#fff;padding:5px 8px;text-align:left;font-weight:600;font-size:10px">${h}</th>`).join('')}</tr></thead>
        <tbody>${wids.map(reqRow).join('')}</tbody>
      </table>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Section B — monthly requirements</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px">
        <thead><tr style="background:#1B3A5C">${['ID','Requirement','Response','Notes'].map(h=>`<th style="color:#fff;padding:5px 8px;text-align:left;font-weight:600;font-size:10px">${h}</th>`).join('')}</tr></thead>
        <tbody>${mids.map(reqRow).join('')}</tbody>
      </table>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Section C — quarterly requirements</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px">
        <thead><tr style="background:#1B3A5C">${['ID','Requirement','Response','Notes'].map(h=>`<th style="color:#fff;padding:5px 8px;text-align:left;font-weight:600;font-size:10px">${h}</th>`).join('')}</tr></thead>
        <tbody>${qids.map(reqRow).join('')}</tbody>
      </table>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="padding:10px;border-radius:8px;background:${sf==='Yes'?'#FCEBEB':'#EAF3DE'}">
          <div style="font-size:10px;font-weight:700;color:${sf==='Yes'?'#791F1F':'#27500A'};margin-bottom:3px">Active safety flag</div>
          <div style="font-size:18px;font-weight:700;color:${sf==='Yes'?'#791F1F':'#27500A'}">${sf==='Yes'?'YES — Action required':'None this period'}</div>
        </div>
        <div style="padding:10px;border-radius:8px;background:${fasp==='Overdue'?'#FCEBEB':fasp==='Current'?'#EAF3DE':'#FAEEDA'}">
          <div style="font-size:10px;font-weight:700;color:${fasp==='Overdue'?'#791F1F':fasp==='Current'?'#27500A':'#633806'};margin-bottom:3px">FASP status</div>
          <div style="font-size:18px;font-weight:700;color:${fasp==='Overdue'?'#791F1F':fasp==='Current'?'#27500A':'#633806'}">${fasp}</div>
        </div>
      </div>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Discharge readiness</div>
      <div style="display:grid;grid-template-columns:70px 1fr;gap:12px;background:#F8F9FB;border-radius:8px;padding:12px;margin-bottom:12px;align-items:center">
        <div style="width:70px;height:70px;border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${dr?'#EAF3DE':'#FCEBEB'}">
          <div style="font-size:9px;font-weight:700;color:${dr?'#27500A':'#791F1F'}">READY</div>
          <div style="font-size:26px;font-weight:800;color:${dr?'#27500A':'#791F1F'}">${dr?'YES':'NO'}</div>
        </div>
        <div style="font-size:12px;color:#333;font-style:italic;line-height:1.5">${disc||'No discharge notes provided.'}</div>
      </div>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Supervisor narrative</div>
      <div style="font-size:12px;color:#333;font-style:italic;line-height:1.6;padding:10px 12px;background:#F8F9FB;border-radius:6px;margin-bottom:14px">${narr||'No narrative entered.'}</div>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;padding-bottom:4px;border-bottom:2px solid #0F6E56">E-signature</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${[['Supervisor signature',sig||''],['Date',today],['Printed name',sup||''],['License',document.getElementById('sn-lic')?.value||''],['Case planner acknowledgment',''],['Date acknowledged','']].map(([l,v])=>`
          <div><div style="border-top:1.5px solid #1B3A5C;padding-top:3px;margin-top:24px;font-size:15px;font-style:italic;font-family:Georgia,serif;color:#222;min-height:22px">${v}</div>
          <div style="font-size:10px;color:#aaa;margin-top:2px">${l}</div></div>`).join('')}
      </div>
      <div style="margin-top:16px;padding-top:10px;border-top:1px solid #E8ECF0;font-size:10px;color:#ccc;font-style:italic">Generated: ${today} | Prevention Services Scorecard | Confidential</div>
    `;

    const statusEl = document.getElementById('np-status');
    if (statusEl) statusEl.textContent = latest ? `Ready to export — ${caseId} | ${latest.week_ending}` : 'No entries yet for this case';
  },

  async exportNote() {
    const caseId = document.getElementById('sn-case')?.value;
    if (!caseId) { UI.toast('Please select a case first', 'error'); return; }
    try {
      UI.toast('Generating Word document...', '', 2000);
      await API.download('/api/export/supervisory-note', {
        caseId,
        supervisorName:  document.getElementById('sn-sup')?.value || '',
        supervisorLicense: document.getElementById('sn-lic')?.value || '',
        supervisorTitle: document.getElementById('sn-title')?.value || '',
        narrative:       document.getElementById('sn-narr')?.value || '',
        dischargeReady:  SharedViews._discharge || false,
        dischargeNotes:  document.getElementById('sn-disc')?.value || '',
        signature:       document.getElementById('sn-sig')?.value || '',
        signatureDate:   new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),
      }, `Supervisory_Note_${caseId}_${new Date().toISOString().slice(0,10)}.docx`);
      UI.toast('Word document downloaded', 'success');
    } catch(e) { UI.toast('Export failed: '+e.message, 'error'); }
  },

  // ── ROSTER ─────────────────────────────────────────────────
  async renderRoster(programId) {
    UI.setTitle('Case Roster');
    const roster = await API.get('/api/roster?active=false' + (programId?`&program_id=${programId}`:'')) || [];
    UI.setTopbar(`<button class="btn btn-p btn-sm" onclick="SharedViews.addCase('${programId||''}')">+ Add case</button>`);
    UI.setContent(`
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Case ID</th><th>Household ID</th><th>Case Planner</th><th>Supervisor</th><th>Open Date</th><th>Modality</th><th>Children</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>${roster.map(r=>`<tr>
            <td class="mono bold" style="color:#1B3A5C">${r.case_id}</td>
            <td style="font-size:12px">${r.household_id||'—'}</td>
            <td>${r.planner_name||'—'}</td>
            <td>${r.supervisor_name||'—'}</td>
            <td style="font-size:12px;color:#aaa">${r.open_date||'—'}</td>
            <td><span class="badge badge-purple">${r.modality||'—'}</span></td>
            <td style="text-align:center">${r.children_count||'—'}</td>
            <td>${r.active?'<span class="badge badge-green">Active</span>':'<span class="badge badge-gray">Inactive</span>'}</td>
            <td style="font-size:11px;color:#aaa">${r.notes||''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`);
  },

  addCase(programId) {
    UI.modal(`
      <div class="modal-title">Add case to roster</div>
      <div class="grid-2">
        <div class="field"><label>Case ID (CNNX)</label><input type="text" id="ac-id" placeholder="QNS-2024-###"></div>
        <div class="field"><label>Household ID</label><input type="text" id="ac-hh" placeholder="HH-####"></div>
        <div class="field"><label>Case planner</label><input type="text" id="ac-pl"></div>
        <div class="field"><label>Supervisor</label><input type="text" id="ac-sup" value="${Auth.user?.name||''}"></div>
        <div class="field"><label>Modality</label><select id="ac-mod"><option>BSFT</option><option>CPP</option><option>FS-MM</option><option>TST</option></select></div>
        <div class="field"><label>Open date</label><input type="date" id="ac-date"></div>
        <div class="field"><label># Children</label><input type="number" id="ac-ch" value="1" min="1" max="15"></div>
        <div class="field"><label>Notes</label><input type="text" id="ac-notes"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Add case</button>
      </div>`,
      async () => {
        const caseId = document.getElementById('ac-id')?.value?.trim();
        if (!caseId) { UI.toast('Case ID required','error'); return; }
        await API.post('/api/roster', {
          case_id: caseId, household_id: document.getElementById('ac-hh')?.value,
          program_id: programId || Auth.user?.program_id,
          planner_name: document.getElementById('ac-pl')?.value,
          supervisor_name: document.getElementById('ac-sup')?.value,
          modality: document.getElementById('ac-mod')?.value,
          open_date: document.getElementById('ac-date')?.value,
          children_count: parseInt(document.getElementById('ac-ch')?.value)||1,
          notes: document.getElementById('ac-notes')?.value,
        });
        UI.toast('Case added to roster','success');
        await SharedViews.renderRoster(programId);
      }
    );
  },

  // ── ALERTS ─────────────────────────────────────────────────
  async renderAlerts(programId) {
    UI.setTitle('Alerts');
    const entries = await API.get('/api/entries/latest' + (programId?`?program_id=${programId}`:'')) || [];
    const alerts = [];
    entries.forEach(e => {
      if (e.safety_flag==='Yes') alerts.push({t:'Safety plan missing — '+e.case_id,b:`Safety concerns raised (W9=Yes) but plan not documented. Case planner: ${e.case_planner||'—'}.`,a:'Complete safety plan immediately. Upload to Connections.',sev:'critical'});
      if (e.fasp_status==='Overdue') alerts.push({t:'FASP overdue — '+e.case_id,b:`FASP not completed. Case planner: ${e.case_planner||'—'}. Immediate ACS submission required.`,a:'Submit FASP to ACS this week. Document barriers if unable.',sev:'critical'});
    });
    const supLogs = await API.get('/api/supervision-log' + (programId?`?program_id=${programId}`:'')) || [];
    supLogs.filter(l=>!l.resolved && l.due_date && new Date(l.due_date) < new Date()).forEach(l=>{
      alerts.push({t:'Supervision action item overdue — '+l.case_id,b:`Action item past due: "${l.action_item}". Staff: ${l.staff_name||'—'}.`,a:'Follow up in next supervision session.',sev:'warn'});
    });
    const count = alerts.filter(a=>a.sev==='critical').length;
    UI.setTopbar(`<span class="wpill">${alerts.length} alert${alerts.length!==1?'s':''} — ${count} critical</span>`);
    UI.setContent(alerts.length ? alerts.map(a=>`
      <div class="alert-item ${a.sev!=='critical'?'warn':''}">
        <div class="alert-title">${a.t}</div>
        <div class="alert-body">${a.b}</div>
        <div class="alert-action">Required action: ${a.a}</div>
      </div>`).join('')
      : '<div class="empty-state">No active alerts — all cases in good standing.</div>');
  },
};
