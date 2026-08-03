/* ===========================================================
   発信マネージャー — YouTube / X / note / Instagram 発信管理
   林インターンメソッドで個人開発を伸ばす
   データは端末内(localStorage)のみ。サーバー送信なし。
   =========================================================== */

const PLATFORMS = [
  { key: 'youtube',   label: 'YouTube',   emoji: '🎬', cls: 'p-youtube', short: 'YT' },
  { key: 'x',         label: 'X',         emoji: '𝕏',  cls: 'p-x',       short: 'X'  },
  { key: 'note',      label: 'note',      emoji: '📝', cls: 'p-note',    short: 'note' },
  { key: 'instagram', label: 'Instagram', emoji: '📸', cls: 'p-instagram', short: 'IG' },
];

const STATUSES = [
  { key: 'idea',      label: '💡 アイデア' },
  { key: 'draft',     label: '📝 下書き'   },
  { key: 'scheduled', label: '🗓 予約'     },
  { key: 'done',      label: '✅ 公開済み' },
];
const NEXT_STATUS = { idea: 'draft', draft: 'scheduled', scheduled: 'done', done: 'done' };

/* 林インターンメソッド 5つの型 */
const METHOD = [
  { title: '毎日1発信（Ship Daily）',
    body: '優秀なインターンは毎日ちゃんと報告する。完璧じゃなくていい、「今日やったこと・学んだこと」を1つ必ず外に出す。継続そのものが信用になる。' },
  { title: '1ネタ4展開（Repurpose ×4）',
    body: '1つのネタを YouTube＝長編、X＝要点とフック、note＝深掘りと物語、Instagram＝ビジュアルと保存、に形を変えて配る。作る労力を4倍活かす。' },
  { title: '数字で振り返る（Review Weekly）',
    body: '週1でフォロワーとインプレを記録。数字は感想を裏切らない。伸びた投稿の「型」をメモする習慣が、次の一手を教えてくれる。' },
  { title: '勝ち型を量産（Double Down）',
    body: 'バズは運、再現は技術。伸びた型が見つかったら迷わず繰り返す。飽きるのは自分だけ、フォロワーは初めて見る。' },
  { title: '返信で仲間を作る（Engage）',
    body: '毎日1人に絡み、コメントには必ず返す。発信は独り言じゃなく会話。個人開発は「作る力 × 届ける仲間」で伸びる。' },
];

const DAILY_TASKS = [
  '今日の学び / 作ったことを1つ発信した',
  '誰か1人に絡んだ（コメント・返信）',
  '明日のネタを1つメモした',
];
const WEEKLY_TASKS = [
  '各SNSのフォロワー数を記録した',
  '今週いちばん伸びた投稿の「型」をメモした',
  '来週に量産する勝ち型を1つ決めた',
  '溜まったアイデアを下書きに落とした',
];

/* ---------- storage ---------- */
const DB = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};
const K = { posts: 'hm.posts', metrics: 'hm.metrics', check: 'hm.check' };

let posts   = DB.get(K.posts, []);
let metrics = DB.get(K.metrics, []);
let checks  = DB.get(K.check, {}); // { 'YYYY-MM-DD': {daily:[bool], weekly:[bool]} }

const savePosts   = () => DB.set(K.posts, posts);
const saveMetrics = () => DB.set(K.metrics, metrics);
const saveChecks  = () => DB.set(K.check, checks);

/* ---------- helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const todayStr = () => new Date().toISOString().slice(0, 10);
const platMeta = (k) => PLATFORMS.find(p => p.key === k);
function fmtNum(n) { return Number(n).toLocaleString('ja-JP'); }
function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
}
function todayCheck() {
  const t = todayStr();
  if (!checks[t]) checks[t] = { daily: DAILY_TASKS.map(() => false), weekly: WEEKLY_TASKS.map(() => false) };
  // migrate length changes
  if (checks[t].daily.length !== DAILY_TASKS.length) checks[t].daily = DAILY_TASKS.map((_, i) => checks[t].daily[i] || false);
  if (checks[t].weekly.length !== WEEKLY_TASKS.length) checks[t].weekly = WEEKLY_TASKS.map((_, i) => checks[t].weekly[i] || false);
  return checks[t];
}

/* ============================================================
   TABS
   ============================================================ */
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.add('hidden'));
  $('#tab-' + name).classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'home')    renderHome();
  if (name === 'posts')   renderBoard();
  if (name === 'metrics') renderCharts();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ============================================================
   HOME
   ============================================================ */
function computeStreak() {
  // 連続発信日: 公開済み投稿 or デイリー完了 のある日を過去にさかのぼって数える
  const doneDays = new Set(posts.filter(p => p.status === 'done' && p.date).map(p => p.date));
  Object.entries(checks).forEach(([day, c]) => { if (c.daily && c.daily.some(Boolean)) doneDays.add(day); });
  let streak = 0;
  const d = new Date();
  // 今日がまだnoなら昨日から数え始める（今日やってなくても連続は途切れさせない）
  if (!doneDays.has(todayStr())) d.setDate(d.getDate() - 1);
  while (doneDays.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function renderHome() {
  const now = new Date();
  $('#homeDate').textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 (${'日月火水木金土'[now.getDay()]})`;
  $('#streakNum').textContent = computeStreak();

  // daily checklist
  const c = todayCheck();
  const dl = $('#dailyChecklist');
  dl.innerHTML = '';
  DAILY_TASKS.forEach((task, i) => {
    const li = document.createElement('li');
    li.className = 'check-item' + (c.daily[i] ? ' done' : '');
    li.innerHTML = `<span class="box">${c.daily[i] ? '✓' : ''}</span><span class="txt">${task}</span>`;
    li.addEventListener('click', () => {
      c.daily[i] = !c.daily[i];
      saveChecks();
      renderHome();
    });
    dl.appendChild(li);
  });
  const allDone = c.daily.every(Boolean);
  $('#homeHello').textContent = allDone ? '今日はコンプリート！えらい🎉' : '今日も1発信、いこう。';

  renderStats();
  renderUpcoming();
}

function latestMetric(key) {
  const rows = metrics.filter(m => m.platform === key).sort((a, b) => a.date.localeCompare(b.date));
  return rows.length ? rows[rows.length - 1] : null;
}
function prevMetric(key) {
  const rows = metrics.filter(m => m.platform === key).sort((a, b) => a.date.localeCompare(b.date));
  return rows.length > 1 ? rows[rows.length - 2] : null;
}

function renderStats() {
  const grid = $('#statGrid');
  grid.innerHTML = '';
  PLATFORMS.forEach(p => {
    const last = latestMetric(p.key);
    const prev = prevMetric(p.key);
    let delta = '';
    if (last && prev) {
      const d = last.value - prev.value;
      delta = `<div class="s-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲+' : d < 0 ? '▼' : '±'}${fmtNum(Math.abs(d))}</div>`;
    } else {
      delta = `<div class="s-delta">前回比 —</div>`;
    }
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML =
      `<div class="s-plat ${p.cls}">${p.emoji} ${p.label}</div>` +
      `<div class="s-num">${last ? fmtNum(last.value) : '—'}</div>` + delta;
    grid.appendChild(el);
  });
}

function renderUpcoming() {
  const list = $('#upcomingList');
  list.innerHTML = '';
  const t = todayStr();
  const up = posts
    .filter(p => p.status === 'scheduled' && p.date && p.date >= t)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  up.forEach(p => {
    const li = document.createElement('li');
    li.className = 'reminder-item';
    li.innerHTML =
      `<div class="info"><div class="r-title">${escapeHtml(p.title)}</div>` +
      `<div class="r-meta">${badgesHtml(p.platforms)}</div></div>` +
      `<div class="r-day">${fmtDate(p.date)}</div>`;
    list.appendChild(li);
  });
}

/* ============================================================
   POSTS
   ============================================================ */
// build platform picker
const picker = $('#platformPicker');
PLATFORMS.forEach(p => {
  const l = document.createElement('label');
  l.className = 'plat-toggle ' + p.cls;
  l.innerHTML = `<input type="checkbox" value="${p.key}"><span>${p.emoji} ${p.label}</span>`;
  picker.appendChild(l);
});

const postForm = $('#postForm');
$('#postDate').value = todayStr();

postForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#postId').value;
  const platforms = $$('#platformPicker input:checked').map(i => i.value);
  const data = {
    title: $('#postTitle').value.trim(),
    platforms,
    status: $('#postStatus').value,
    date: $('#postDate').value,
    memo: $('#postMemo').value.trim(),
  };
  if (!data.title) return;

  if (id) {
    const p = posts.find(x => x.id === id);
    if (p) Object.assign(p, data);
  } else {
    posts.push({ id: uid(), createdAt: Date.now(), ...data });
  }
  savePosts();
  resetPostForm();
  renderBoard();
});

$('#postCancel').addEventListener('click', resetPostForm);

function resetPostForm() {
  postForm.reset();
  $('#postId').value = '';
  $('#postDate').value = todayStr();
  $$('#platformPicker input').forEach(i => i.checked = false);
  $('#postFormTitle').textContent = '✍️ 発信ネタを追加';
  $('#postSubmit').textContent = '追加する';
  $('#postCancel').classList.add('hidden');
}

function editPost(id) {
  const p = posts.find(x => x.id === id);
  if (!p) return;
  $('#postId').value = p.id;
  $('#postTitle').value = p.title;
  $('#postStatus').value = p.status;
  $('#postDate').value = p.date || todayStr();
  $('#postMemo').value = p.memo || '';
  $$('#platformPicker input').forEach(i => i.checked = p.platforms.includes(i.value));
  $('#postFormTitle').textContent = '✏️ 編集';
  $('#postSubmit').textContent = '保存する';
  $('#postCancel').classList.remove('hidden');
  switchTab('posts');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function advancePost(id) {
  const p = posts.find(x => x.id === id);
  if (!p) return;
  p.status = NEXT_STATUS[p.status];
  if (p.status === 'done' && !p.date) p.date = todayStr();
  if (p.status === 'done' && p.date > todayStr()) p.date = todayStr();
  savePosts();
  renderBoard();
}

function deletePost(id) {
  posts = posts.filter(x => x.id !== id);
  savePosts();
  renderBoard();
}

function badgesHtml(keys) {
  return (keys || []).map(k => {
    const m = platMeta(k);
    return m ? `<span class="badge ${m.cls}">${m.emoji} ${m.short}</span>` : '';
  }).join(' ');
}

function renderBoard() {
  const board = $('#board');
  board.innerHTML = '';
  STATUSES.forEach(st => {
    const items = posts
      .filter(p => p.status === st.key)
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || b.createdAt - a.createdAt);
    const col = document.createElement('div');
    col.className = 'column';
    col.innerHTML = `<div class="col-head">${st.label}<span class="count">${items.length}</span></div>`;
    if (!items.length) {
      col.insertAdjacentHTML('beforeend', `<div class="col-empty">まだありません</div>`);
    }
    items.forEach(p => {
      const advLabel = st.key === 'done' ? '↩︎ 戻す' :
        st.key === 'idea' ? '→ 下書きへ' : st.key === 'draft' ? '→ 予約へ' : '→ 公開！';
      const el = document.createElement('div');
      el.className = 'post-item';
      el.innerHTML =
        `<div class="p-title">${escapeHtml(p.title)}</div>` +
        (p.platforms.length ? `<div class="badges">${badgesHtml(p.platforms)}</div>` : '') +
        (p.memo ? `<div class="p-memo">💡 ${escapeHtml(p.memo)}</div>` : '') +
        (p.date ? `<div class="p-date">🗓 ${fmtDate(p.date)}</div>` : '') +
        `<div class="post-actions">
           <button class="adv" data-adv="${p.id}">${st.key === 'done' ? '' : advLabel}</button>
           <button data-edit="${p.id}">編集</button>
           <button class="del" data-del="${p.id}">🗑</button>
         </div>`;
      col.appendChild(el);
    });
    board.appendChild(col);
  });

  // 公開済みの advance ボタンは「戻す」に
  $$('[data-adv]', board).forEach(b => {
    const p = posts.find(x => x.id === b.dataset.adv);
    if (p && p.status === 'done') {
      b.textContent = '↩︎ 予約に戻す';
      b.classList.remove('adv');
      b.addEventListener('click', () => { p.status = 'scheduled'; savePosts(); renderBoard(); });
    } else {
      b.addEventListener('click', () => advancePost(b.dataset.adv));
    }
  });
  $$('[data-edit]', board).forEach(b => b.addEventListener('click', () => editPost(b.dataset.edit)));
  $$('[data-del]', board).forEach(b => b.addEventListener('click', () => {
    if (confirm('この発信ネタを削除しますか？')) deletePost(b.dataset.del);
  }));
}

/* ============================================================
   METRICS
   ============================================================ */
const metricSelect = $('#metricPlatform');
PLATFORMS.forEach(p => {
  const o = document.createElement('option');
  o.value = p.key; o.textContent = `${p.emoji} ${p.label}`;
  metricSelect.appendChild(o);
});
$('#metricDate').value = todayStr();

$('#metricForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = parseInt(String($('#metricValue').value).replace(/[^0-9]/g, ''), 10);
  if (isNaN(value)) return;
  const date = $('#metricDate').value || todayStr();
  const platform = $('#metricPlatform').value;
  // 同じ日・同じプラットフォームは上書き
  const existing = metrics.find(m => m.platform === platform && m.date === date);
  if (existing) existing.value = value;
  else metrics.push({ id: uid(), platform, date, value });
  saveMetrics();
  $('#metricValue').value = '';
  renderCharts();
});

function renderCharts() {
  const wrap = $('#charts');
  wrap.innerHTML = '';
  let any = false;
  PLATFORMS.forEach(p => {
    const rows = metrics.filter(m => m.platform === p.key).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return;
    any = true;
    const latest = rows[rows.length - 1].value;
    const block = document.createElement('div');
    block.className = 'chart-block';
    block.innerHTML =
      `<div class="chart-head"><span class="c-name ${p.cls}">${p.emoji} ${p.label}</span>` +
      `<span class="c-latest">${fmtNum(latest)}</span></div>` +
      sparkline(rows.map(r => r.value), p);
    wrap.appendChild(block);
  });
  if (!any) wrap.innerHTML = `<p class="chart-empty">まだ記録がありません。上のフォームから記録すると、ここに成長グラフが出ます。</p>`;
}

function sparkline(values, p) {
  const w = 300, h = 70, pad = 6;
  if (values.length === 1) values = [values[0], values[0]];
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${(w - pad)},${h - pad}`;
  const varName = p.key === 'x' ? 'x' : p.key === 'youtube' ? 'yt' : p.key === 'instagram' ? 'ig' : 'note';
  const color = getComputedStyle(document.documentElement).getPropertyValue('--' + varName).trim() || '#5b7cfa';
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon points="${area}" fill="${color}" opacity="0.12"></polygon>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
    ${pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${color}"></circle>`).join('')}
  </svg>`;
}

/* ============================================================
   METHOD
   ============================================================ */
function renderMethod() {
  const list = $('#methodList');
  list.innerHTML = '';
  METHOD.forEach(m => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="m-title">${m.title}</div><div class="m-body">${m.body}</div>`;
    list.appendChild(li);
  });

  const c = todayCheck();
  const wl = $('#weeklyChecklist');
  wl.innerHTML = '';
  WEEKLY_TASKS.forEach((task, i) => {
    const li = document.createElement('li');
    li.className = 'check-item' + (c.weekly[i] ? ' done' : '');
    li.innerHTML = `<span class="box">${c.weekly[i] ? '✓' : ''}</span><span class="txt">${task}</span>`;
    li.addEventListener('click', () => { c.weekly[i] = !c.weekly[i]; saveChecks(); renderMethod(); });
    wl.appendChild(li);
  });
}

/* ---------- utils ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- init ---------- */
renderHome();
renderBoard();
renderMethod();

/* PWA */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}
