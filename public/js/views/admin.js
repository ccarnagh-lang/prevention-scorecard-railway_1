/* admin.js — Admin panel for managing users and programs */

const AdminViews = {

  async render() {
    UI.setTitle('Admin Panel');
    UI.setTopbar(`<span class="wpill">System Administration</span>`);

    const [users, programs] = await Promise.all([
      API.get('/api/admin/users') || [],
      API.get('/api/admin/programs') || [],
    ]);

    UI.setContent(`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">

        <!-- USERS -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div class="section-head" style="margin:0">Users</div>
            <button class="btn btn-p btn-sm" onclick="AdminViews.addUser()">+ Add user</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Program</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${(users||[]).map(u => `<tr>
                  <td style="font-weight:600">${u.name}</td>
                  <td style="font-size:12px;color:#888">${u.email}</td>
                  <td><span class="badge ${u.role==='executive'?'badge-purple':u.role==='program_director'?'badge-navy':u.role==='supervisor'?'badge-amber':u.role==='admin'?'badge-red':'badge-gray'}">${u.role}</span></td>
                  <td style="font-size:12px;color:#888">${u.program_id||'All'}</td>
                  <td>${u.active||u.active===1?'<span class="badge badge-green">Active</span>':'<span class="badge badge-gray">Inactive</span>'}</td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-xs" onclick="AdminViews.editUser(${u.id},'${u.name}','${u.role}','${u.program_id||''}')">Edit</button>
                      <button class="btn btn-xs" onclick="AdminViews.resetPassword(${u.id},'${u.name}')">Reset pw</button>
                    </div>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- PROGRAMS -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div class="section-head" style="margin:0">Programs</div>
            <button class="btn btn-p btn-sm" onclick="AdminViews.addProgram()">+ Add program</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Site code</th><th>Name</th><th>Modality</th><th>Borough</th><th>Status</th></tr></thead>
              <tbody>
                ${(programs||[]).map(p => `<tr>
                  <td class="mono" style="color:#1B3A5C;font-weight:600">${p.site_code||p.id}</td>
                  <td>${p.name}</td>
                  <td><span class="badge badge-purple">${p.modality||'—'}</span></td>
                  <td style="font-size:12px;color:#888">${p.borough||'—'}</td>
                  <td>${p.active||p.active===1?'<span class="badge badge-green">Active</span>':'<span class="badge badge-gray">Inactive</span>'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>

          <div style="margin-top:20px">
            <div class="section-head" style="margin-bottom:12px">System info</div>
            <div class="card">
              <div style="font-size:13px;color:#333;line-height:2">
                <div><span style="color:#888;font-weight:600">Database: </span>${window._usePostgres ? 'Neon PostgreSQL (persistent)' : 'In-memory (demo mode)'}</div>
                <div><span style="color:#888;font-weight:600">Total users: </span>${(users||[]).length}</div>
                <div><span style="color:#888;font-weight:600">Total programs: </span>${(programs||[]).length}</div>
                <div><span style="color:#888;font-weight:600">Session: </span>${Auth.user?.email}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
  },

  addUser() {
    const programs = [];
    UI.modal(`
      <div class="modal-title">Add new user</div>
      <div class="grid-2">
        <div class="field"><label>Full name</label><input type="text" id="au-name" placeholder="First Last"></div>
        <div class="field"><label>Email address</label><input type="email" id="au-email" placeholder="name@agency.org"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Temporary password</label><input type="text" id="au-pw" placeholder="They can change this later"></div>
        <div class="field"><label>Role</label>
          <select id="au-role" onchange="AdminViews.toggleProgramField(this.value)">
            <option value="staff">Case Planner (staff)</option>
            <option value="supervisor">Supervisor</option>
            <option value="program_director">Program Director</option>
            <option value="executive">Executive</option>
          </select></div>
      </div>
      <div class="field" id="au-prog-wrap" style="margin-top:8px">
        <label>Program</label>
        <input type="text" id="au-prog" placeholder="e.g. p1 — run setup to see program IDs">
      </div>
      <div style="font-size:11px;color:#888;margin-top:10px;padding:8px;background:#F8F9FB;border-radius:6px">
        The user will log in with this email and temporary password. Ask them to change their password after first login.
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Create user</button>
      </div>`,
      async () => {
        const name  = document.getElementById('au-name')?.value?.trim();
        const email = document.getElementById('au-email')?.value?.trim();
        const pw    = document.getElementById('au-pw')?.value?.trim();
        const role  = document.getElementById('au-role')?.value;
        const prog  = document.getElementById('au-prog')?.value?.trim();
        if (!name || !email || !pw) { UI.toast('Name, email, and password are required', 'error'); return; }
        try {
          await API.post('/api/admin/users', { name, email, password: pw, role, program_id: prog || null });
          UI.toast(`User ${name} created`, 'success');
          await AdminViews.render();
        } catch(e) { UI.toast('Failed: ' + e.message, 'error'); }
      }
    );
  },

  toggleProgramField(role) {
    const wrap = document.getElementById('au-prog-wrap');
    if (wrap) wrap.style.display = role === 'executive' || role === 'admin' ? 'none' : 'block';
  },

  editUser(id, name, role, programId) {
    UI.modal(`
      <div class="modal-title">Edit user — ${name}</div>
      <div class="field" style="margin-bottom:10px"><label>Full name</label><input type="text" id="eu-name" value="${name}"></div>
      <div class="field" style="margin-bottom:10px"><label>Role</label>
        <select id="eu-role">
          <option value="staff" ${role==='staff'?'selected':''}>Case Planner (staff)</option>
          <option value="supervisor" ${role==='supervisor'?'selected':''}>Supervisor</option>
          <option value="program_director" ${role==='program_director'?'selected':''}>Program Director</option>
          <option value="executive" ${role==='executive'?'selected':''}>Executive</option>
        </select></div>
      <div class="field" style="margin-bottom:10px"><label>Program ID</label><input type="text" id="eu-prog" value="${programId}" placeholder="e.g. p1"></div>
      <div class="field" style="margin-bottom:10px"><label>Status</label>
        <select id="eu-active"><option value="true">Active</option><option value="false">Inactive</option></select></div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Save changes</button>
      </div>`,
      async () => {
        try {
          await API.put(`/api/admin/users/${id}`, {
            name:       document.getElementById('eu-name')?.value,
            role:       document.getElementById('eu-role')?.value,
            program_id: document.getElementById('eu-prog')?.value || null,
            active:     document.getElementById('eu-active')?.value === 'true',
          });
          UI.toast('User updated', 'success');
          await AdminViews.render();
        } catch(e) { UI.toast('Failed: ' + e.message, 'error'); }
      }
    );
  },

  resetPassword(id, name) {
    UI.modal(`
      <div class="modal-title">Reset password — ${name}</div>
      <div class="field" style="margin-bottom:8px"><label>New password</label>
        <input type="text" id="rp-pw" placeholder="Enter a temporary password"></div>
      <div style="font-size:11px;color:#888;padding:8px;background:#F8F9FB;border-radius:6px">
        The user will need to log in with this new password. Notify them directly.
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-r" data-confirm>Reset password</button>
      </div>`,
      async () => {
        const pw = document.getElementById('rp-pw')?.value?.trim();
        if (!pw || pw.length < 6) { UI.toast('Password must be at least 6 characters', 'error'); return; }
        try {
          await API.post(`/api/admin/users/${id}/reset-password`, { password: pw });
          UI.toast('Password reset for ' + name, 'success');
        } catch(e) { UI.toast('Failed: ' + e.message, 'error'); }
      }
    );
  },

  addProgram() {
    UI.modal(`
      <div class="modal-title">Add program</div>
      <div class="grid-2">
        <div class="field"><label>Program ID (short code)</label><input type="text" id="ap-id" placeholder="e.g. p7"></div>
        <div class="field"><label>Site code</label><input type="text" id="ap-site" placeholder="e.g. 5530"></div>
      </div>
      <div class="field" style="margin-bottom:10px"><label>Program name</label><input type="text" id="ap-name" placeholder="e.g. 5530 Queens BSFT"></div>
      <div class="grid-2">
        <div class="field"><label>Modality</label>
          <select id="ap-mod"><option>BSFT</option><option>CPP</option><option>FS-MM</option><option>TST</option></select></div>
        <div class="field"><label>Borough</label>
          <select id="ap-borough"><option>Bronx</option><option>Brooklyn</option><option>Manhattan</option><option>Queens</option><option>Staten Island</option></select></div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Add program</button>
      </div>`,
      async () => {
        const id   = document.getElementById('ap-id')?.value?.trim();
        const name = document.getElementById('ap-name')?.value?.trim();
        if (!id || !name) { UI.toast('Program ID and name required', 'error'); return; }
        try {
          await API.post('/api/admin/programs', {
            id, name,
            site_code: document.getElementById('ap-site')?.value,
            modality:  document.getElementById('ap-mod')?.value,
            borough:   document.getElementById('ap-borough')?.value,
          });
          UI.toast('Program added', 'success');
          await AdminViews.render();
        } catch(e) { UI.toast('Failed: ' + e.message, 'error'); }
      }
    );
  },
};
