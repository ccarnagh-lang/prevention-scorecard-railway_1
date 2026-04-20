/* executive.js */
const ExecViews = {
  async dashboard(data) {
    const d = data || await API.get('/api/dashboard') || {};
    const progs = d.programs || [];
    UI.setTopbar(`
      <select id="ex-prog" onchange="ExecViews.filterByProgram()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All programs</option>
        ${progs.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
      </select>
      <select style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option>All boroughs</option><option>Bronx</option><option>Manhattan</option><option>Queens</option><option>Staten Island</option>
      </select>
      <input type="date" value="2025-01-01" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      <span style="color:#aaa;font-size:12px">to</span>
      <input type="date" value="2025-04-25" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      <button class="btn btn-navy btn-sm" onclick="window.open('/api/export/csv','_blank')">Export CSV</button>`);

    const totalCases = progs.reduce((a,p)=>a+(p.cases||0),0);
    const totalFlags = progs.reduce((a,p)=>a+(p.flags||0),0);
    const totalFasp  = progs.reduce((a,p)=>a+(p.fasp||0),0);
    const avgWs = progs.length ? Math.round(progs.reduce((a,p)=>a+(p.ws||0),0)/progs.length) : null;

    const tabs = [
      {id:'weekly',  label:'Weekly'},
      {id:'monthly', label:'Monthly'},
      {id:'quarterly',label:'Quarterly'},
      {id:'ytd',     label:'Year to Date'},
    ];

    UI.setContent(`
      <div class="metric-grid">
        <div class="mc"><div class="mc-label">Agency-wide score</div><div class="mc-value" style="color:${UI.scoreColor(avgWs)}">${avgWs!=null?avgWs+'%':'—'}</div><div class="mc-sub">Across ${progs.length} programs</div></div>
        <div class="mc"><div class="mc-label">Total active cases</div><div class="mc-value">${totalCases}</div><div class="mc-sub">All programs</div></div>
        <div class="mc"><div class="mc-label">Safety flags</div><div class="mc-value" style="color:#A32D2D">${totalFlags}</div><div class="mc-sub">Immediate review required</div></div>
        <div class="mc"><div class="mc-label">FASP overdue</div><div class="mc-value" style="color:#BA7517">${totalFasp}</div><div class="mc-sub">Submit to ACS</div></div>
      </div>

      <div class="tab-bar" id="exec-tabs">
        ${tabs.map((t,i)=>`<div class="tab${i===0?' active':''}" onclick="ExecViews.switchTab('${t.id}',this)">${t.label}</div>`).join('')}
      </div>
      <div id="exec-tab-content"></div>

      <div class="chart-grid" style="margin-bottom:14px">
        <div class="card"><div class="card-title">Program compliance — weekly score</div>
          <div style="position:relative;height:200px"><canvas id="c-prog" role="img" aria-label="Program compliance bar chart">Program data.</canvas></div></div>
        <div class="card"><div class="card-title">Agency score trend — 12 weeks</div>
          <div style="position:relative;height:200px"><canvas id="c-trend" role="img" aria-label="Score trend line chart">Trend data.</canvas></div></div>
      </div>

      <div class="section-head">All programs — click to drill down</div>
      <div id="prog-list">${progs.map(p=>`
        <div class="prog-card" id="pc-${p.id}" onclick="ExecViews.toggleProg('${p.id}')">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:14px;font-weight:600;color:#1B3A5C">${p.name}</div>
              <div style="font-size:11px;color:#888;margin-top:2px">${p.borough||'—'} &nbsp;|&nbsp; ${p.modality||'—'} &nbsp;|&nbsp; ${p.cases||0} cases</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${UI.badge(p.ws)}<span style="font-size:11px;color:#888">weekly</span>
              ${(p.flags||0)>0?`<span class="badge badge-red">${p.flags} flag${p.flags>1?'s':''}</span>`:''}
              ${(p.fasp||0)>0?`<span class="badge badge-amber">${p.fasp} FASP</span>`:''}
            </div>
          </div>
          <div class="prog-bar" style="margin-top:8px"><div class="prog-fill" style="width:${p.ws||0}%;background:${(p.ws||0)>=90?'#1D9E75':(p.ws||0)>=75?'#EF9F27':'#E24B4A'}"></div></div>
          <div class="prog-drill" id="pd-${p.id}">
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
              ${[['Monthly',p.ms],['Quarterly',p.qs],['Lifetime',p.ls],['# Planners',p.planners||'—']].map(([l,v])=>`
                <div style="text-align:center"><div style="font-size:10px;color:#888;margin-bottom:3px;font-weight:600">${l}</div>
                <div style="font-size:16px;font-weight:700;color:${typeof v==='number'?UI.scoreColor(v):'#555'}">${typeof v==='number'&&v!=null?Math.round(v)+'%':v||'—'}</div></div>`).join('')}
            </div>
          </div>
        </div>`).join('')}</div>
    `);

    ExecViews.switchTab('weekly', document.querySelector('.tab.active'));

    if (progs.length) {
      UI.mkChart('c-prog', {
        type:'bar',
        data:{ labels:progs.map(p=>p.name.split(' ').slice(0,2).join(' ')),
          datasets:[{label:'Weekly %',data:progs.map(p=>p.ws||0),backgroundColor:progs.map(p=>(p.ws||0)>=90?'#1D9E75':(p.ws||0)>=75?'#EF9F27':'#E24B4A'),borderRadius:5}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
          scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%',font:{size:10}}},x:{ticks:{font:{size:10},maxRotation:30}}}}
      });
    }

    const trend = d.allTrend || d.trend || [];
    if (trend.length) UI.trendChart('c-trend', trend.map(t=>({...t,score:t.score})), '#1D9E75');
  },

  switchTab(id, el) {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    el?.classList.add('active');
    const domains = [
      {name:'Administration',pct:88},{name:'Assessment',pct:82},{name:'Safety/Risk',pct:75},
      {name:'Engagement',pct:79},{name:'FASP',pct:70},{name:'FTC',pct:83},
    ];
    const labels = {weekly:'Week ending Apr 25, 2025',monthly:'April 2025',quarterly:'Q1 2025 (Jan–Mar)',ytd:'Year to date (Jan–Apr 2025)'};
    document.getElementById('exec-tab-content').innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="card-title">Compliance by domain — <span style="color:#888;font-weight:400">${labels[id]}</span></div>
        ${UI.domainBars(domains)}
      </div>`;
  },

  toggleProg(id) {
    const drill = document.getElementById('pd-'+id);
    const card  = document.getElementById('pc-'+id);
    const open  = drill.style.display !== 'none';
    document.querySelectorAll('.prog-drill').forEach(d=>d.style.display='none');
    document.querySelectorAll('.prog-card').forEach(c=>c.classList.remove('expanded'));
    if (!open) { drill.style.display='block'; card.classList.add('expanded'); }
  },

  filterByProgram() {
    const pid = document.getElementById('ex-prog')?.value;
    if (pid) {
      App.nav('dash');
    }
  },
};
