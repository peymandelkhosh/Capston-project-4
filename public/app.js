'use strict';

// ── API helper ────────────────────────────────────────────────
const api = {
  get:   (p)    => fetch(p).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
  post:  (p, b) => fetch(p, {method:'POST',  headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
  put:   (p, b) => fetch(p, {method:'PUT',   headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
  patch: (p)    => fetch(p, {method:'PATCH'}).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
  del:   (p)    => fetch(p, {method:'DELETE'}).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
};

// ── Utilities ─────────────────────────────────────────────────
const today  = () => new Date().toISOString().slice(0, 10);
const fmtD   = d  => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) : '—';
const fmtT   = t  => { if(!t) return ''; const [h,m]=t.split(':'); const hr=parseInt(h); return `${hr%12||12}:${m} ${hr>=12?'PM':'AM'}`; };
const moodEm = m  => ['','😢','😕','😐','🙂','😄'][m] || '😐';
const esc    = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const actIcon= t  => ({Exercise:'🏋️',Running:'🏃',Studying:'📚',Reading:'📖',Meditation:'🧘',Work:'💼',Yoga:'🤸',Cycling:'🚴',Other:'⚡'})[t]||'⚡';

let _toastT = null;
function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = type;
  clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Modals ────────────────────────────────────────────────────
const openModal  = n => document.getElementById(`modal-${n}`).classList.remove('hidden');
const closeModal = n => document.getElementById(`modal-${n}`).classList.add('hidden');

document.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => closeModal(el.dataset.close))
);

// ── Router ────────────────────────────────────────────────────
const SECTIONS = ['dashboard','activities','tasks','schedules','journal','medals'];

function goTo(section, prefill=null) {
  if (!SECTIONS.includes(section)) section = 'dashboard';
  history.replaceState(null,'',`#${section}`);
  SECTIONS.forEach(s => {
    document.getElementById(`section-${s}`).classList.toggle('active', s===section);
    document.getElementById(`nav-${s}`).classList.toggle('active', s===section);
  });
  document.getElementById('topbar-title').textContent = section.charAt(0).toUpperCase()+section.slice(1);
  loaders[section]();
  if (prefill) setTimeout(() => prefillSection(section, prefill), 280);
  document.getElementById('sidebar').classList.remove('open');
}

function prefillSection(section, payload) {
  const map = {
    activities: () => openActivityModal(null, payload),
    tasks:      () => openTaskModal(null, payload),
    schedules:  () => openSchedModal(null, payload),
    journal:    () => openJournalModal(null, payload),
  };
  if (map[section]) map[section]();
}

window.addEventListener('DOMContentLoaded', () => {
  goTo(location.hash.slice(1) || 'dashboard');
  initTopbar(); initChat(); initVoice();
});
window.addEventListener('hashchange', () => goTo(location.hash.slice(1) || 'dashboard'));

document.querySelectorAll('.nav-item').forEach(a =>
  a.addEventListener('click', e => { e.preventDefault(); goTo(a.dataset.section); })
);
document.getElementById('sidebar-toggle').addEventListener('click', () =>
  document.getElementById('sidebar').classList.toggle('open')
);

function initTopbar() {
  const now  = new Date();
  const hour = now.getHours();
  const greet = hour<12 ? 'Good morning' : hour<17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting').textContent = `${greet}! 👋`;
  document.getElementById('topbar-date').textContent = now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
}

// ── Section loaders ───────────────────────────────────────────
const loaders = { dashboard:loadDashboard, activities:loadActivities, tasks:loadTasks, schedules:loadSchedules, journal:loadJournal, medals:loadMedals };

// ─ Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [aStats, tList, mStats, upcoming] = await Promise.all([
      api.get('/api/activities/stats'),
      api.get('/api/tasks/pending'),
      api.get('/api/journal/stats'),
      api.get('/api/schedules/upcoming'),
    ]);
    document.getElementById('stat-act-count').textContent  = aStats.total_count  || 0;
    document.getElementById('stat-task-count').textContent = tList.length         || 0;
    document.getElementById('stat-act-mins').textContent   = aStats.total_minutes || 0;
    const avg = mStats.avg_mood;
    document.getElementById('stat-mood-avg').textContent = avg ? `${moodEm(Math.round(avg))} ${parseFloat(avg).toFixed(1)}` : '—';
    renderUpcoming(upcoming.slice(0,5));
    renderCalendar();
  } catch(e) { console.error('Dashboard', e); }
}

function renderUpcoming(items) {
  const el = document.getElementById('upcoming-list');
  el.innerHTML = items.length
    ? items.map(s=>`<div class="item-row"><span class="item-icon">📅</span><div class="item-body"><div class="item-title">${esc(s.title)}</div><div class="item-meta">${fmtD(s.date)} · ${fmtT(s.time)}</div></div></div>`).join('')
    : '<div class="empty-state"><span>📅</span><p>No upcoming events</p></div>';
}

// ─ Activities ─────────────────────────────────────────────────
async function loadActivities() {
  try {
    const items = await api.get('/api/activities');
    const list  = document.getElementById('activities-list');
    const empty = document.getElementById('activities-empty');
    if (!items.length) { list.innerHTML=''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    list.innerHTML = items.map(a=>`
      <div class="item-row">
        <span class="item-icon">${actIcon(a.type)}</span>
        <div class="item-body"><div class="item-title">${esc(a.type)} · ${a.duration} min</div><div class="item-meta">${fmtD(a.date)}${a.notes?' · '+esc(a.notes):''}</div></div>
        <div class="item-actions">
          <button class="btn-icon" onclick="openActivityModal(${a.id})">✏️</button>
          <button class="btn-icon danger" onclick="delActivity(${a.id})">🗑️</button>
        </div>
      </div>`).join('');
  } catch(e) { toast('Failed to load activities','error'); }
}

function openActivityModal(id=null, pre={}) {
  document.getElementById('modal-act-title').textContent = id ? 'Edit Activity' : 'Log Activity';
  document.getElementById('act-id').value       = id||'';
  document.getElementById('act-type').value     = pre.type||'';
  document.getElementById('act-duration').value = pre.duration||'';
  document.getElementById('act-date').value     = pre.date||today();
  document.getElementById('act-notes').value    = pre.notes||'';
  if (id) api.get('/api/activities').then(items => {
    const a = items.find(x=>x.id===id);
    if(a){ document.getElementById('act-type').value=a.type; document.getElementById('act-duration').value=a.duration; document.getElementById('act-date').value=a.date; document.getElementById('act-notes').value=a.notes||''; }
  });
  openModal('activity');
}
window.openActivityModal = openActivityModal;

document.getElementById('btn-add-activity').addEventListener('click', ()=>openActivityModal());
document.getElementById('form-activity').addEventListener('submit', async e=>{
  e.preventDefault();
  const id = document.getElementById('act-id').value;
  const data = { type:document.getElementById('act-type').value, duration:parseInt(document.getElementById('act-duration').value), notes:document.getElementById('act-notes').value, date:document.getElementById('act-date').value };
  try {
    id ? await api.put(`/api/activities/${id}`,data) : await api.post('/api/activities',data);
    closeModal('activity'); loadActivities(); loadDashboard(); toast(id?'Updated ✓':'Logged ✓');
  } catch(e) { toast('Save failed','error'); }
});

async function delActivity(id) {
  if(!confirm('Delete this activity?')) return;
  try { await api.del(`/api/activities/${id}`); loadActivities(); toast('Deleted ✓'); }
  catch(e) { toast('Delete failed','error'); }
}
window.delActivity = delActivity;

// ─ Tasks ──────────────────────────────────────────────────────
let taskFilter = 'all';

async function loadTasks() {
  try {
    const all = await api.get('/api/tasks');
    const items = all.filter(t => taskFilter==='all' || t.status===taskFilter);
    const list  = document.getElementById('tasks-list');
    const empty = document.getElementById('tasks-empty');
    if(!items.length){ list.innerHTML=''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    list.innerHTML = items.map(t=>`
      <div class="item-row task-row ${t.status}">
        <div class="task-check ${t.status==='done'?'done':''}" onclick="toggleTask(${t.id},'${t.status}')">${t.status==='done'?'✓':''}</div>
        <div class="item-body">
          <div class="item-title">${esc(t.title)}</div>
          <div class="item-meta">${t.due_date?fmtD(t.due_date)+' · ':''}<span class="badge badge-${t.priority}">${t.priority}</span>${t.notes?' · '+esc(t.notes):''}</div>
        </div>
        <div class="item-actions">
          <button class="btn-icon" onclick="openTaskModal(${t.id})">✏️</button>
          <button class="btn-icon danger" onclick="delTask(${t.id})">🗑️</button>
        </div>
      </div>`).join('');
  } catch(e) { toast('Failed to load tasks','error'); }
}

document.querySelectorAll('.filter-btn').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); taskFilter=btn.dataset.filter; loadTasks();
}));

function openTaskModal(id=null, pre={}) {
  document.getElementById('modal-task-title').textContent = id ? 'Edit Task' : 'Add Task';
  document.getElementById('task-id').value       = id||'';
  document.getElementById('task-title').value    = pre.title||'';
  document.getElementById('task-due').value      = pre.due_date||'';
  document.getElementById('task-priority').value = pre.priority||'medium';
  document.getElementById('task-notes').value    = pre.notes||'';
  if(id) api.get('/api/tasks').then(items=>{ const t=items.find(x=>x.id===id); if(t){ document.getElementById('task-title').value=t.title; document.getElementById('task-due').value=t.due_date||''; document.getElementById('task-priority').value=t.priority; document.getElementById('task-notes').value=t.notes||''; } });
  openModal('task');
}
window.openTaskModal = openTaskModal;
document.getElementById('btn-add-task').addEventListener('click',()=>openTaskModal());

document.getElementById('form-task').addEventListener('submit', async e=>{
  e.preventDefault();
  const id=document.getElementById('task-id').value;
  const data={title:document.getElementById('task-title').value,notes:document.getElementById('task-notes').value,due_date:document.getElementById('task-due').value||null,priority:document.getElementById('task-priority').value,status:'pending'};
  try{ id?await api.put(`/api/tasks/${id}`,data):await api.post('/api/tasks',data); closeModal('task'); loadTasks(); loadDashboard(); toast(id?'Updated ✓':'Task added ✓'); }
  catch(e){ toast('Save failed','error'); }
});

async function toggleTask(id, status) {
  try{ status==='done'?await api.put(`/api/tasks/${id}`,{title:'',due_date:null,priority:'medium',notes:'',status:'pending'}):await api.patch(`/api/tasks/${id}/complete`); loadTasks(); loadDashboard(); }
  catch(e){ toast('Update failed','error'); }
}
window.toggleTask = toggleTask;

async function delTask(id){ if(!confirm('Delete task?'))return; try{ await api.del(`/api/tasks/${id}`); loadTasks(); toast('Deleted ✓'); }catch(e){ toast('Failed','error'); } }
window.delTask = delTask;

// ─ Schedules ──────────────────────────────────────────────────
async function loadSchedules() {
  try{
    const items = await api.get('/api/schedules');
    const list  = document.getElementById('schedules-list');
    const empty = document.getElementById('schedules-empty');
    if(!items.length){ list.innerHTML=''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    list.innerHTML = items.map(s=>`
      <div class="item-row">
        <span class="item-icon">📅</span>
        <div class="item-body"><div class="item-title">${esc(s.title)}</div><div class="item-meta">${fmtD(s.date)} · ${fmtT(s.time)} · <em>${esc(s.recurrence)}</em></div></div>
        <div class="item-actions">
          <button class="btn-icon" onclick="openSchedModal(${s.id})">✏️</button>
          <button class="btn-icon danger" onclick="delSched(${s.id})">🗑️</button>
        </div>
      </div>`).join('');
  }catch(e){ toast('Failed to load schedules','error'); }
}

function openSchedModal(id=null, pre={}) {
  document.getElementById('modal-sched-title').textContent = id?'Edit Event':'Add Event';
  document.getElementById('sched-id').value    = id||'';
  document.getElementById('sched-title').value = pre.title||'';
  document.getElementById('sched-date').value  = pre.date||today();
  document.getElementById('sched-time').value  = pre.time||'09:00';
  document.getElementById('sched-recur').value = pre.recurrence||'none';
  document.getElementById('sched-notes').value = pre.notes||'';
  if(id) api.get('/api/schedules').then(items=>{ const s=items.find(x=>x.id===id); if(s){ document.getElementById('sched-title').value=s.title; document.getElementById('sched-date').value=s.date; document.getElementById('sched-time').value=s.time; document.getElementById('sched-recur').value=s.recurrence; document.getElementById('sched-notes').value=s.notes||''; } });
  openModal('schedule');
}
window.openSchedModal = openSchedModal;
document.getElementById('btn-add-schedule').addEventListener('click',()=>openSchedModal());
document.getElementById('dash-add-sched').addEventListener('click',()=>{ goTo('schedules'); setTimeout(()=>openSchedModal(),280); });

document.getElementById('form-schedule').addEventListener('submit', async e=>{
  e.preventDefault();
  const id=document.getElementById('sched-id').value;
  const data={title:document.getElementById('sched-title').value,date:document.getElementById('sched-date').value,time:document.getElementById('sched-time').value,recurrence:document.getElementById('sched-recur').value,notes:document.getElementById('sched-notes').value};
  try{ id?await api.put(`/api/schedules/${id}`,data):await api.post('/api/schedules',data); closeModal('schedule'); loadSchedules(); loadDashboard(); toast(id?'Updated ✓':'Event saved ✓'); }
  catch(e){ toast('Save failed','error'); }
});

async function delSched(id){ if(!confirm('Delete event?'))return; try{ await api.del(`/api/schedules/${id}`); loadSchedules(); loadDashboard(); toast('Deleted ✓'); }catch(e){ toast('Failed','error'); } }
window.delSched = delSched;

// ─ Journal ────────────────────────────────────────────────────
let selMood = 3;

async function loadJournal() {
  try{
    const [items, stats] = await Promise.all([api.get('/api/journal'), api.get('/api/journal/stats')]);
    renderMoodChart(items.slice(0,14).reverse());
    const list  = document.getElementById('journal-list');
    const empty = document.getElementById('journal-empty');
    if(!items.length){ list.innerHTML=''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    list.innerHTML = items.map(j=>`
      <div class="item-row">
        <span class="item-icon">${moodEm(j.mood)}</span>
        <div class="item-body"><div class="item-title">${esc(j.content.slice(0,80))}${j.content.length>80?'…':''}</div><div class="item-meta">${fmtD(j.date)}${j.ai_insight?' · 💡 '+esc(j.ai_insight.slice(0,55)):''}</div></div>
        <div class="item-actions">
          <button class="btn-icon" onclick="openJournalModal(${j.id})">✏️</button>
          <button class="btn-icon danger" onclick="delJournal(${j.id})">🗑️</button>
        </div>
      </div>`).join('');
  }catch(e){ toast('Failed to load journal','error'); }
}

function renderMoodChart(entries) {
  const el = document.getElementById('mood-chart');
  if(!entries.length){ el.innerHTML='<div style="color:var(--text-3);font-size:12px;padding:8px">No entries yet</div>'; return; }
  el.innerHTML = entries.map(e=>`<div class="mood-bar" style="height:${(e.mood/5)*100}%" title="${fmtD(e.date)}: ${moodEm(e.mood)} ${e.mood}/5"></div>`).join('');
}

function openJournalModal(id=null, pre={}) {
  document.getElementById('modal-jour-title').textContent = id?'Edit Entry':'Journal Entry';
  document.getElementById('jour-id').value      = id||'';
  document.getElementById('jour-content').value = pre.content||'';
  document.getElementById('jour-date').value    = pre.date||today();
  selMood = pre.mood||3;
  document.querySelectorAll('.mood-btn').forEach(b=>b.classList.toggle('active',parseInt(b.dataset.mood)===selMood));
  if(id) api.get('/api/journal').then(items=>{ const j=items.find(x=>x.id===id); if(j){ document.getElementById('jour-content').value=j.content; document.getElementById('jour-date').value=j.date; selMood=j.mood; document.querySelectorAll('.mood-btn').forEach(b=>b.classList.toggle('active',parseInt(b.dataset.mood)===j.mood)); } });
  openModal('journal');
}
window.openJournalModal = openJournalModal;

document.querySelectorAll('.mood-btn').forEach(btn=>btn.addEventListener('click',()=>{
  selMood=parseInt(btn.dataset.mood);
  document.querySelectorAll('.mood-btn').forEach(b=>b.classList.toggle('active',b===btn));
}));
document.getElementById('btn-add-journal').addEventListener('click',()=>openJournalModal());

document.getElementById('form-journal').addEventListener('submit', async e=>{
  e.preventDefault();
  const id=document.getElementById('jour-id').value;
  const labels=['','terrible','bad','neutral','good','great'];
  const data={content:document.getElementById('jour-content').value,mood:selMood,mood_label:labels[selMood]||'neutral',date:document.getElementById('jour-date').value,ai_insight:''};
  try{ id?await api.put(`/api/journal/${id}`,data):await api.post('/api/journal',data); closeModal('journal'); loadJournal(); toast(id?'Updated ✓':'Entry saved ✓'); }
  catch(e){ toast('Save failed','error'); }
});

async function delJournal(id){ if(!confirm('Delete entry?'))return; try{ await api.del(`/api/journal/${id}`); loadJournal(); toast('Deleted ✓'); }catch(e){ toast('Failed','error'); } }
window.delJournal = delJournal;

// ─ Medals ─────────────────────────────────────────────────────
async function loadMedals() {
  try{
    const items = await api.get('/api/medals');
    const grid  = document.getElementById('medals-grid');
    const empty = document.getElementById('medals-empty');
    if(!items.length){ grid.innerHTML=''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    const td = today();
    grid.innerHTML = items.map(m=>`
      <div class="medal-card glass ${m.last_logged===td?'medal-logged':''}">
        <span class="medal-emoji">${m.icon}</span>
        <div class="medal-name">${esc(m.name)}</div>
        <div class="medal-streak">${m.streak}</div>
        <div class="medal-streak-lbl">day streak 🔥</div>
        <button class="medal-log-btn" onclick="logMedal(${m.id})">${m.last_logged===td?'✓ Logged Today':'+ Log Today'}</button>
        <button class="medal-del-btn" onclick="delMedal(${m.id})">🗑️</button>
      </div>`).join('');
  }catch(e){ toast('Failed to load medals','error'); }
}

document.getElementById('btn-add-medal').addEventListener('click',()=>openModal('medal'));
document.getElementById('form-medal').addEventListener('submit', async e=>{
  e.preventDefault();
  const data={name:document.getElementById('medal-name').value,icon:document.getElementById('medal-icon').value||'🏅'};
  try{ await api.post('/api/medals',data); closeModal('medal'); document.getElementById('form-medal').reset(); document.getElementById('medal-icon').value='🏅'; loadMedals(); toast('Medal created ✓'); }
  catch(e){ toast('Save failed','error'); }
});

async function logMedal(id){ try{ await api.post(`/api/medals/${id}/log`); loadMedals(); toast('Streak updated! 🔥'); }catch(e){ toast('Failed','error'); } }
window.logMedal = logMedal;
async function delMedal(id){ if(!confirm('Delete medal?'))return; try{ await api.del(`/api/medals/${id}`); loadMedals(); toast('Deleted ✓'); }catch(e){ toast('Failed','error'); } }
window.delMedal = delMedal;

// ── Calendar ──────────────────────────────────────────────────
let calView = 'month', calDate = new Date();

async function renderCalendar() {
  const title = document.getElementById('cal-title');
  const body  = document.getElementById('calendar-body');
  let scheds = [];
  try{ scheds = await api.get('/api/schedules'); }catch(_){}

  if (calView==='month') {
    title.textContent = calDate.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    body.innerHTML = monthGrid(calDate, scheds);
  } else if (calView==='week') {
    const ws = weekStart(calDate), we = new Date(ws); we.setDate(we.getDate()+6);
    title.textContent = `${ws.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${we.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
    body.innerHTML = dayGrid(ws, scheds);
  } else {
    title.textContent = calDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    body.innerHTML = dayGrid(calDate, scheds);
  }
}

function monthGrid(date, scheds) {
  const y=date.getFullYear(), m=date.getMonth();
  const first=new Date(y,m,1), last=new Date(y,m+1,0);
  const td=today();
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let h='<div class="cal-month-grid">';
  h+=days.map(d=>`<div class="cal-day-hdr">${d}</div>`).join('');
  for(let i=0;i<first.getDay();i++){ const d=new Date(y,m,-first.getDay()+i+1); h+=`<div class="cal-day other-month"><div class="cal-dn">${d.getDate()}</div></div>`; }
  for(let d=1;d<=last.getDate();d++){
    const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dots=scheds.filter(s=>s.date===ds);
    h+=`<div class="cal-day${ds===td?' today':''}"><div class="cal-dn">${d}</div>${dots.length?`<div class="cal-dot" title="${dots.map(s=>s.title).join(', ')}"></div>`:''}</div>`;
  }
  return h+'</div>';
}

function dayGrid(date, scheds) {
  const ds=date.toISOString().slice(0,10);
  const dayScheds=scheds.filter(s=>s.date===ds);
  let h='<div class="cal-time-grid">';
  for(let hr=6;hr<=22;hr++){
    h+=`<div class="cal-hr-lbl">${fmtT(hr+':00')}</div>`;
    const evts=dayScheds.filter(s=>s.time&&parseInt(s.time.split(':')[0])===hr);
    h+=`<div class="cal-hr-slot">${evts.map(e=>`<span class="cal-pill">${esc(e.title)}</span>`).join('')}</div>`;
  }
  return h+'</div>';
}

function weekStart(d){ const dt=new Date(d); dt.setDate(dt.getDate()-dt.getDay()); return dt; }

document.getElementById('cal-prev').addEventListener('click',()=>{ calView==='month'?calDate.setMonth(calDate.getMonth()-1):calDate.setDate(calDate.getDate()-(calView==='week'?7:1)); renderCalendar(); });
document.getElementById('cal-next').addEventListener('click',()=>{ calView==='month'?calDate.setMonth(calDate.getMonth()+1):calDate.setDate(calDate.getDate()+(calView==='week'?7:1)); renderCalendar(); });
document.querySelectorAll('.view-tab').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.view-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); calView=btn.dataset.view; renderCalendar(); }));

// ── Chat Widget ───────────────────────────────────────────────
let pendIntent=null, pendPayload=null;

function initChat() {
  document.getElementById('chat-toggle').addEventListener('click', toggleChat);
  document.getElementById('chat-close').addEventListener('click',  ()=>{ document.getElementById('chat-panel').classList.add('hidden'); document.getElementById('chat-icon').textContent='💬'; });
  document.getElementById('chat-send').addEventListener('click', sendMsg);
  document.getElementById('chat-input').addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMsg(); } });
  addAI("👋 Hi! I'm your SyncRoutine AI.\n\nTry:\n• \"Log 30 min reading\"\n• \"Schedule dentist at 2pm tomorrow\"\n• \"Add task: buy groceries\"\n• \"How many activities this week?\"\n\nOr tap 🎙️ to speak!");
}

function toggleChat(){ const p=document.getElementById('chat-panel'); const hide=p.classList.toggle('hidden'); document.getElementById('chat-icon').textContent=hide?'💬':'✕'; }

async function sendMsg() {
  const inp=document.getElementById('chat-input');
  const msg=inp.value.trim(); if(!msg) return;
  inp.value='';
  addUser(msg);
  const tid=addTyping();
  try{
    const res=await api.post('/api/chat',{message:msg});
    rmTyping(tid); addAI(res.reply);
    if(res.requiresConfirmation&&res.intent&&res.payload){ pendIntent=res.intent; pendPayload=res.payload; addConfirm(); }
  }catch(e){ rmTyping(tid); addAI('⚠️ Could not connect to AI. Check your GEMINI_API_KEY in .env.'); }
}

function addUser(t){ const el=mk('div','bubble user'); el.textContent=t; msgs().appendChild(el); scrollChat(); }
function addAI(t)  { const el=mk('div','bubble ai');   el.textContent=t; msgs().appendChild(el); scrollChat(); }
function addTyping(){ const el=mk('div','bubble ai typing'); el.id='typing-'+Date.now(); el.innerHTML='<div class="tdot"></div><div class="tdot"></div><div class="tdot"></div>'; msgs().appendChild(el); scrollChat(); return el.id; }
function rmTyping(id){ const e=document.getElementById(id); if(e) e.remove(); }
function msgs(){ return document.getElementById('chat-messages'); }
function scrollChat(){ const m=msgs(); m.scrollTop=m.scrollHeight; }
function mk(tag,cls){ const el=document.createElement(tag); el.className=cls; return el; }

function addConfirm() {
  const row=mk('div','confirm-row');

  const yes=mk('button','cbtn yes'); yes.textContent='✅ Confirm & Save';
  yes.addEventListener('click',()=>{ row.remove(); doConfirm(); });

  const preview=mk('button','cbtn preview'); preview.textContent='👁️ Preview & Edit';
  preview.addEventListener('click',()=>{ row.remove(); doPreview(); });

  const no=mk('button','cbtn no'); no.textContent='❌ Cancel';
  no.addEventListener('click',()=>{ row.remove(); pendIntent=pendPayload=null; addAI('Cancelled — nothing saved.'); });

  row.append(yes, preview, no);
  msgs().appendChild(row);
  scrollChat();
}

async function doConfirm() {
  const tid=addTyping();
  try{
    await api.post('/api/chat/confirm',{intent:pendIntent,payload:pendPayload});
    rmTyping(tid); addAI('✅ Saved! Your dashboard has been updated.');
    const cur=location.hash.slice(1)||'dashboard';
    if(loaders[cur]) loaders[cur]();
    toast('Saved by AI ✓');
    pendIntent=pendPayload=null;
  }catch(e){ rmTyping(tid); addAI('⚠️ Save failed. Please try again.'); }
}

function doPreview() {
  const m={LOG_ACTIVITY:'activities',CREATE_TASK:'tasks',ADD_SCHEDULE:'schedules',LOG_JOURNAL:'journal',LOG_MEDAL:'medals'};
  const sec=m[pendIntent]||'dashboard';
  document.getElementById('chat-panel').classList.add('hidden');
  document.getElementById('chat-icon').textContent='💬';
  goTo(sec, pendPayload);
  pendIntent=pendPayload=null;
}

// ── Voice ─────────────────────────────────────────────────────
let recorder=null, chunks=[], recording=false;

function initVoice() {
  document.getElementById('voice-btn').addEventListener('click', toggleRec);
}

async function toggleRec() {
  if(recording){ recorder.stop(); return; }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    recorder=new MediaRecorder(stream); chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);
    recorder.onstop=async()=>{
      recording=false; document.getElementById('voice-btn').classList.remove('rec');
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(chunks,{type:'audio/webm'});
      await sendVoice(blob);
    };
    recorder.start(); recording=true;
    document.getElementById('voice-btn').classList.add('rec');
    addAI('🎙️ Recording… tap mic again to stop.');
  }catch(e){ toast('Microphone access denied','error'); }
}

async function sendVoice(blob) {
  const tid=addTyping();
  try{
    const form=new FormData(); form.append('audio',blob,'voice.webm');
    const res=await fetch('/api/chat/voice',{method:'POST',body:form});
    const data=await res.json(); rmTyping(tid);
    if(data.transcript) addAI(`📝 Heard: "${data.transcript}"`);
    if(data.reply) addAI(data.reply);
    if(data.requiresConfirmation&&data.intent&&data.payload){ pendIntent=data.intent; pendPayload=data.payload; addConfirm(); }
  }catch(e){ rmTyping(tid); addAI('⚠️ Voice processing failed.'); }
}
