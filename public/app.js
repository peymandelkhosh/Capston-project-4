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
const SECTIONS = ['dashboard','activities','todos','schedules','journal','medals','milestones','news'];

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
    todos:      () => openTodoModal(null, payload),
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

const loaders = { dashboard:loadDashboard, activities:loadActivities, todos:loadTodos, schedules:loadSchedules, journal:loadJournal, medals:loadMedals, milestones:loadMilestones, news:loadNews };

// ─ Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [aStats, mStats, upcoming] = await Promise.all([
      api.get('/api/activities/stats'),
      api.get('/api/journal/stats'),
      api.get('/api/schedules/upcoming'),
    ]);
    document.getElementById('stat-act-count').textContent  = aStats.total_count  || 0;
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
  document.getElementById('act-time').value     = pre.time||'';
  if (id) api.get('/api/activities').then(items => {
    const a = items.find(x=>x.id===id);
    if(a){ document.getElementById('act-type').value=a.type; document.getElementById('act-duration').value=a.duration; document.getElementById('act-date').value=a.date; document.getElementById('act-notes').value=a.notes||''; document.getElementById('act-time').value=a.time||''; }
  });
  openModal('activity');
}
window.openActivityModal = openActivityModal;

document.getElementById('btn-add-activity').addEventListener('click', ()=>openActivityModal());
document.getElementById('form-activity').addEventListener('submit', async e=>{
  e.preventDefault();
  const id = document.getElementById('act-id').value;
  const data = { type:document.getElementById('act-type').value, duration:parseInt(document.getElementById('act-duration').value), notes:document.getElementById('act-notes').value, date:document.getElementById('act-date').value, time:document.getElementById('act-time').value||null };
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

// ─ To-Do List ──────────────────────────────────────────────────
async function loadTodos() {
  try {
    const items = await api.get('/api/todos/pending');
    const list  = document.getElementById('todos-list');
    const empty = document.getElementById('todos-empty');
    if(!items.length){ list.innerHTML=''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    list.innerHTML = items.map(t=>`
      <div class="item-row">
        <span class="item-icon">✅</span>
        <div class="item-body">
          <div class="item-title">${esc(t.title)}</div>
          <div class="item-meta">
            ${t.deadline ? 'Due: ' + fmtD(t.deadline) + (t.deadline.includes('T') ? ' ' + fmtT(t.deadline.split('T')[1]) : '') + ' · ' : ''}
            ${t.estimated_duration ? t.estimated_duration + ' mins · ' : ''}
            ${t.description ? esc(t.description) : ''}
            ${t.extra_notes ? '<br/><small style="color:var(--amber)">Note: ' + esc(t.extra_notes) + '</small>' : ''}
          </div>
        </div>
        <div class="item-actions">
          <button class="btn-icon" style="color:var(--green)" onclick="completeTodo(${t.id})" title="Complete">✔</button>
          <button class="btn-icon" onclick="openTodoModal(${t.id})" title="Edit">✏️</button>
          <button class="btn-icon danger" onclick="delTodo(${t.id})" title="Delete">🗑️</button>
        </div>
      </div>`).join('');
  } catch(e) { toast('Failed to load to-dos','error'); }
}

function openTodoModal(id=null, pre={}) {
  document.getElementById('modal-todo-title').textContent = id ? 'Edit Task' : 'Add Task';
  document.getElementById('todo-id').value       = id||'';
  document.getElementById('todo-title').value    = pre.title||'';
  document.getElementById('todo-desc').value     = pre.description||'';
  document.getElementById('todo-duration').value = pre.estimated_duration||'';
  document.getElementById('todo-deadline').value = pre.deadline||'';
  document.getElementById('todo-extra').value    = pre.extra_notes||'';
  
  if(id) {
    api.get('/api/todos').then(items=>{ 
      const t=items.find(x=>x.id===id); 
      if(t){ 
        document.getElementById('todo-title').value=t.title; 
        document.getElementById('todo-desc').value=t.description||''; 
        document.getElementById('todo-duration').value=t.estimated_duration||''; 
        document.getElementById('todo-deadline').value=t.deadline||'';
        document.getElementById('todo-extra').value=t.extra_notes||'';
      } 
    });
  }
  openModal('todo');
}
window.openTodoModal = openTodoModal;
document.getElementById('btn-add-todo').addEventListener('click',()=>openTodoModal());

document.getElementById('form-todo').addEventListener('submit', async e=>{
  e.preventDefault();
  const id=document.getElementById('todo-id').value;
  const data={
    title: document.getElementById('todo-title').value,
    description: document.getElementById('todo-desc').value,
    estimated_duration: document.getElementById('todo-duration').value,
    deadline: document.getElementById('todo-deadline').value || null,
    extra_notes: document.getElementById('todo-extra').value
  };
  try{ 
    id ? await api.put(`/api/todos/${id}`,data) : await api.post('/api/todos',data); 
    closeModal('todo'); loadTodos(); toast(id?'Task Updated ✓':'Task Added ✓'); 
  }
  catch(e){ toast('Save failed','error'); }
});

async function delTodo(id){ if(!confirm('Delete task?'))return; try{ await api.del(`/api/todos/${id}`); loadTodos(); toast('Deleted ✓'); }catch(e){ toast('Failed','error'); } }
window.delTodo = delTodo;

async function completeTodo(id){ try{ await api.put(`/api/todos/${id}/complete`); loadTodos(); toast('Completed! 🎉'); }catch(e){ toast('Failed','error'); } }
window.completeTodo = completeTodo;


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
    grid.innerHTML = items.map(m => `
      <div class="medal-card glass ${m.last_logged===td?'medal-logged':''}">
        <button class="medal-edit-btn" onclick="editMedal(${m.id})">✏️</button>
        <span class="medal-emoji">${m.icon}</span>
        <div class="medal-name">${esc(m.name)}</div>
        <div class="medal-desc">${esc(m.description || '')}</div>
        <div class="medal-streak">${m.streak}</div>
        <div class="medal-streak-lbl">day streak 🔥</div>
        <button class="medal-log-btn" onclick="logMedal(${m.id})">${m.last_logged===td?'✓ Logged Today':'+ Log Today'}</button>
        <button class="medal-del-btn" onclick="delMedal(${m.id})">🗑️</button>
      </div>`).join('');
  }catch(e){ toast('Failed to load medals','error'); }
}

document.getElementById('btn-add-medal').addEventListener('click', () => {
  document.getElementById('modal-medal-title').textContent = 'New Habit Medal';
  delete document.getElementById('form-medal').dataset.editId;
  document.getElementById('form-medal').reset();
  document.getElementById('medal-icon').value = '🏅';
  document.querySelector('#form-medal button[type="submit"]').textContent = 'Create';
  openModal('medal');
});

document.getElementById('form-medal').addEventListener('submit', async e => {
  e.preventDefault();
  const id   = document.getElementById('form-medal').dataset.editId;
  const data = {
    name       : document.getElementById('medal-name').value,
    icon       : document.getElementById('medal-icon').value || '🏅',
    description: document.getElementById('medal-desc').value || '',
  };
  try {
    if (id) {
      await api.put(`/api/medals/${id}`, data);
      toast('Medal updated ✓');
    } else {
      await api.post('/api/medals', data);
      toast('Medal created ✓');
    }
    closeModal('medal');
    document.getElementById('form-medal').reset();
    document.getElementById('medal-icon').value = '🏅';
    delete document.getElementById('form-medal').dataset.editId;
    loadMedals();
  } catch(e) { toast('Save failed', 'error'); }
});

async function editMedal(id) {
  try {
    const m = await api.get(`/api/medals/${id}`);
    document.getElementById('modal-medal-title').textContent = 'Edit Habit Medal';
    document.getElementById('form-medal').dataset.editId = m.id;
    document.getElementById('medal-name').value = m.name;
    document.getElementById('medal-icon').value = m.icon;
    document.getElementById('medal-desc').value = m.description || '';
    document.querySelector('#form-medal button[type="submit"]').textContent = 'Save Changes';
    openModal('medal');
  } catch(e) { toast('Failed to load medal details', 'error'); }
}
window.editMedal = editMedal;

async function logMedal(id){ try{ await api.post(`/api/medals/${id}/log`); loadMedals(); toast('Streak updated! 🔥'); }catch(e){ toast('Failed','error'); } }
window.logMedal = logMedal;
async function delMedal(id){ if(!confirm('Delete medal?'))return; try{ await api.del(`/api/medals/${id}`); loadMedals(); toast('Deleted ✓'); }catch(e){ toast('Failed','error'); } }
window.delMedal = delMedal;

// ─ Milestones ────────────────────────────────────────────

// Category icon map
const catIcon = c => ({Exercise:'🏋️',Running:'🏃',Studying:'📚',Reading:'📖',Meditation:'🧘',Work:'💼',Yoga:'🤸',Cycling:'🚴',Other:'⚡'})[c]||'🎯';

// Gradient palette for progress bars — cycles through 6 vibrant HSL pairs
const msGrad = i => [
  'hsl(258,90%,65%),hsl(210,90%,58%)',   // violet → blue
  'hsl(152,70%,48%),hsl(196,90%,52%)',   // green → cyan
  'hsl(330,85%,62%),hsl(18,95%,60%)',    // pink  → orange
  'hsl(38,95%,60%),hsl(330,85%,62%)',    // amber → pink
  'hsl(196,90%,52%),hsl(152,70%,48%)',   // cyan  → green
  'hsl(18,95%,60%),hsl(258,90%,65%)',    // orange→ violet
][i % 6];

/**
 * Derive current_value from local activity log.
 * - metric='hours'  → sum activity.duration (min) / 60 for matching category
 * - metric='days'   → count distinct dates with at least one matching activity
 * - other metrics   → stored current_value (manually updated or kept from DB)
 */
function computeProgress(milestone, activities) {
  const { category, target_metric, current_value } = milestone;
  const matching = activities.filter(a => a.type === category);

  if (target_metric === 'hours') {
    return matching.reduce((s, a) => s + (a.duration || 0), 0) / 60;
  }
  if (target_metric === 'days') {
    const uniqueDates = new Set(matching.map(a => a.date));
    return uniqueDates.size;
  }
  // For words/lessons/calories we use the stored value (manually updated via edit)
  return parseFloat(current_value) || 0;
}

async function loadMilestones() {
  try {
    const [items, activities] = await Promise.all([
      api.get('/api/milestones'),
      api.get('/api/activities'),
    ]);
    const grid  = document.getElementById('milestones-grid');
    const empty = document.getElementById('milestones-empty');
    if (!items.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    grid.innerHTML = items.map((m, i) => {
      const current   = computeProgress(m, activities);
      const target    = parseFloat(m.target_value) || 1;
      const pct       = Math.min(100, (current / target) * 100);
      const done      = pct >= 100;
      const grad      = msGrad(i);
      const unit      = m.unit || m.target_metric;
      const curFmt    = current % 1 === 0 ? current.toFixed(0) : current.toFixed(1);
      const tgtFmt    = target  % 1 === 0 ? target.toFixed(0)  : target.toFixed(1);

      return `
      <div class="ms-card glass ${done ? 'ms-done' : ''}">
        <div class="ms-top">
          <div class="ms-icon-wrap" style="background:linear-gradient(135deg,${grad})">${catIcon(m.category)}</div>
          <div class="ms-meta">
            <div class="ms-cat">${esc(m.category)} &middot; ${esc(m.target_metric)}</div>
            <div class="ms-title">${esc(m.title)}</div>
            ${m.description ? `<div class="ms-desc">${esc(m.description)}</div>` : ''}
          </div>
        </div>
        <div class="ms-progress-wrap">
          <div class="ms-bar-bg">
            <div class="ms-bar-fill" style="width:${pct.toFixed(1)}%;background:linear-gradient(90deg,${grad})"></div>
          </div>
          <div class="ms-stats">
            <span class="ms-cur">${curFmt} ${esc(unit)}</span>
            <span class="ms-pct ${done ? 'ms-pct-done' : ''}">${done ? '✓ Complete!' : pct.toFixed(1)+'%'}</span>
            <span class="ms-tgt">${tgtFmt} ${esc(unit)}</span>
          </div>
        </div>
        <div class="ms-actions">
          <button class="btn-icon" onclick="editMilestone(${m.id})">✏️ Edit</button>
          <button class="btn-icon danger" onclick="delMilestone(${m.id})">🗑️</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) { toast('Failed to load milestones','error'); }
}

async function editMilestone(id) {
  try {
    const m = await api.get(`/api/milestones/${id}`);
    document.getElementById('modal-ms-title').textContent    = 'Edit Milestone';
    document.getElementById('form-milestone').dataset.editId = m.id;
    document.getElementById('ms-title').value      = m.title;
    document.getElementById('ms-desc').value       = m.description || '';
    document.getElementById('ms-category').value   = m.category;
    document.getElementById('ms-metric').value     = m.target_metric;
    document.getElementById('ms-target').value     = m.target_value;
    document.getElementById('ms-unit').value       = m.unit || '';
    document.getElementById('ms-submit-btn').textContent = 'Save Changes';
    openModal('milestone');
  } catch(e) { toast('Failed to load milestone','error'); }
}
window.editMilestone = editMilestone;

async function delMilestone(id) {
  if (!confirm('Delete this milestone?')) return;
  try { await api.del(`/api/milestones/${id}`); loadMilestones(); toast('Deleted ✓'); }
  catch(e) { toast('Delete failed','error'); }
}
window.delMilestone = delMilestone;

document.getElementById('btn-add-milestone').addEventListener('click', () => {
  document.getElementById('modal-ms-title').textContent = 'New Milestone';
  delete document.getElementById('form-milestone').dataset.editId;
  document.getElementById('form-milestone').reset();
  document.getElementById('ms-submit-btn').textContent = 'Create Milestone';
  openModal('milestone');
});

document.getElementById('form-milestone').addEventListener('submit', async e => {
  e.preventDefault();
  const id   = document.getElementById('form-milestone').dataset.editId;
  const data = {
    title         : document.getElementById('ms-title').value,
    description   : document.getElementById('ms-desc').value || '',
    category      : document.getElementById('ms-category').value,
    target_metric : document.getElementById('ms-metric').value,
    target_value  : parseFloat(document.getElementById('ms-target').value) || 0,
    current_value : 0,   // always recalculated from activities on render
    unit          : document.getElementById('ms-unit').value || '',
  };
  try {
    id ? await api.put(`/api/milestones/${id}`, data)
       : await api.post('/api/milestones', data);
    toast(id ? 'Milestone updated ✓' : 'Milestone created ✓');
    closeModal('milestone');
    document.getElementById('form-milestone').reset();
    delete document.getElementById('form-milestone').dataset.editId;
    loadMilestones();
  } catch(e) { toast('Save failed','error'); }
});

// ── Calendar ──────────────────────────────────────────────────
let calView = 'month', calDate = new Date();

async function renderCalendar() {
  const title = document.getElementById('cal-title');
  const body  = document.getElementById('calendar-body');
  let scheds = [], acts = [];
  try{ [scheds, acts] = await Promise.all([api.get('/api/schedules'), api.get('/api/activities')]); }catch(_){}

  if (calView==='month') {
    title.textContent = calDate.toLocaleDateString('en-US',{month:'long',year:'numeric'});
    body.innerHTML = monthGrid(calDate, scheds, acts);
  } else if (calView==='week') {
    const ws = weekStart(calDate), we = new Date(ws); we.setDate(we.getDate()+6);
    title.textContent = `${ws.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${we.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
    body.innerHTML = weekGrid(ws, scheds, acts);
  } else {
    title.textContent = calDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    body.innerHTML = dayGrid(calDate, scheds, acts);
  }
}

function monthGrid(date, scheds, acts) {
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
    const actDots=acts.filter(a=>a.date===ds);
    const allTitles = [...dots.map(s=>s.title), ...actDots.map(a=>`${a.type} (${a.duration}m)`)];
    h+=`<div class="cal-day${ds===td?' today':''}"><div class="cal-dn">${d}</div>${allTitles.length?`<div class="cal-dot" title="${esc(allTitles.join(', '))}"></div>`:''}</div>`;
  }
  return h+'</div>';
}

function dayGrid(date, scheds, acts) {
  const ds=date.toISOString().slice(0,10);
  const dayScheds=scheds.filter(s=>s.date===ds);
  const allDayActs=acts.filter(a=>a.date===ds && !a.time);
  const timedActs =acts.filter(a=>a.date===ds && a.time);
  let h='<div class="cal-time-grid">';
  if (allDayActs.length) {
    h+=`<div class="cal-hr-lbl">Acts</div>`;
    h+=`<div class="cal-hr-slot">${allDayActs.map(a=>`<span class="cal-pill" style="background:var(--green);color:white" title="${a.duration} min">${actIcon(a.type)} ${esc(a.type)}</span>`).join('')}</div>`;
  }
  for(let hr=6;hr<=22;hr++){
    h+=`<div class="cal-hr-lbl">${fmtT(hr+':00')}</div>`;
    const evts=dayScheds.filter(s=>s.time&&parseInt(s.time.split(':')[0])===hr);
    const tacts=timedActs.filter(a=>a.time&&parseInt(a.time.split(':')[0])===hr);
    h+=`<div class="cal-hr-slot">`;
    h+=evts.map(e=>`<span class="cal-pill">${esc(e.title)}</span>`).join('');
    h+=tacts.map(a=>`<span class="cal-pill" style="background:var(--green);color:white" title="${a.duration} min">${actIcon(a.type)} ${esc(a.type)}</span>`).join('');
    h+=`</div>`;
  }
  return h+'</div>';
}

function weekGrid(startDate, scheds, acts) {
  const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  let h = '<div class="cal-week-grid">';

  // Row 0: Day Headers
  h += '<div class="cal-week-hdr-spacer"></div>';
  dates.forEach((d, i) => {
    const isToday = d.toISOString().slice(0, 10) === today();
    h += `<div class="cal-day-hdr${isToday ? ' week-today' : ''}">${daysShort[i]} ${d.getDate()}</div>`;
  });

  // Activities Row
  h += `<div class="cal-hr-lbl">Acts</div>`;
  dates.forEach(d => {
    const ds = d.toISOString().slice(0, 10);
    const dayActs = acts.filter(a => a.date === ds && !a.time);
    h += `<div class="cal-hr-slot">${dayActs.map(a => `<span class="cal-pill" style="background:var(--green);color:white" title="${a.duration} min">${actIcon(a.type)}</span>`).join('')}</div>`;
  });

  // Hours: 6 to 22
  for (let hr = 6; hr <= 22; hr++) {
    h += `<div class="cal-hr-lbl">${fmtT(hr + ':00')}</div>`;

    // 7 slots for the 7 days of this hour
    dates.forEach(d => {
      const ds = d.toISOString().slice(0, 10);
      const dayScheds = scheds.filter(s => s.date === ds);
      const evts = dayScheds.filter(s => s.time && parseInt(s.time.split(':')[0]) === hr);
      
      const dayActs = acts.filter(a => a.date === ds && a.time && parseInt(a.time.split(':')[0]) === hr);

      h += `<div class="cal-hr-slot">`;
      h += evts.map(e => `<span class="cal-pill" title="${esc(e.title)}">${esc(e.title)}</span>`).join('');
      h += dayActs.map(a => `<span class="cal-pill" style="background:var(--green);color:white" title="${a.duration} min">${actIcon(a.type)}</span>`).join('');
      h += `</div>`;
    });
  }

  h += '</div>';
  return h;
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
  const m={LOG_ACTIVITY:'activities',CREATE_TODO:'todos',ADD_SCHEDULE:'schedules',LOG_JOURNAL:'journal',LOG_MEDAL:'medals',CREATE_MILESTONE:'milestones'};
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

// ─ News Briefings ────────────────────────────────────────────

async function loadNews() {
  const timeline = document.getElementById('news-timeline');
  const empty    = document.getElementById('news-empty');
  try {
    const items = await api.get('/api/news');
    if (!items.length) {
      timeline.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    timeline.innerHTML = items.map(n => {
      // Split the generated bullets (usually start with •)
      const bullets = n.content.split('\n').filter(line => line.trim().length > 0);
      return `
      <div class="news-card glass">
        <div class="news-date-badge">${fmtD(n.date)}</div>
        <ul class="news-bullets">
          ${bullets.map(b => `<li>${esc(b.replace(/^•\s*/, ''))}</li>`).join('')}
        </ul>
      </div>`;
    }).join('');
  } catch (err) {
    toast('Failed to load news briefings', 'error');
  }
}

async function regenerateNews() {
  const btn = document.getElementById('btn-regenerate-news');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '🔄 Generating...';
  try {
    await api.post('/api/news/regenerate');
    toast('Briefing regenerated ✓');
    loadNews();
  } catch (err) {
    toast('Regeneration failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

document.getElementById('btn-regenerate-news').addEventListener('click', regenerateNews);

