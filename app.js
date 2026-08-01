/* CallMe — 時間前に電話がかかってくるアラーム
 * すべてブラウザ内で完結（サーバー不要）。データは localStorage に保存。
 */
(() => {
  'use strict';

  const STORE_KEY = 'callme.reminders.v1';
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  // ---- 状態 ----
  let reminders = load();
  let ringing = null;        // 現在着信中のリマインダー
  let audioCtx = null;
  let ringTimer = null;      // 着信音のループ用
  let vibrateTimer = null;
  let wakeLock = null;
  let autoStopTimer = null;

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  const form = $('add-form');

  // ============ 保存・読み込み ============
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(reminders));
  }

  // ============ 次の着信時刻を計算 ============
  // 予定時刻 - リード分 = 「電話が鳴る瞬間」
  function computeNext(r, from) {
    const [hh, mm] = r.time.split(':').map(Number);
    const lead = (r.lead || 0) * 60000;
    const base = new Date(from);

    const makeCall = (dayOffset) => {
      const d = new Date(base);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hh, mm, 0, 0);
      return d.getTime() - lead; // 着信の瞬間
    };

    if (r.days && r.days.length) {
      for (let i = 0; i <= 8; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() + i);
        if (!r.days.includes(d.getDay())) continue;
        const t = makeCall(i);
        if (t > from + 500) return t;
      }
      return null;
    }

    // 単発：今日その時刻を過ぎていたら翌日
    let t = makeCall(0);
    if (t <= from + 500) t = makeCall(1);
    return t;
  }

  function refreshTriggers() {
    const now = Date.now();
    let changed = false;
    for (const r of reminders) {
      if (r.next == null) {
        r.next = computeNext(r, now);
        changed = true;
      }
    }
    if (changed) save();
  }

  // ============ 描画 ============
  function render() {
    listEl.innerHTML = '';
    const sorted = [...reminders].sort((a, b) => (a.next || 0) - (b.next || 0));
    for (const r of sorted) {
      const li = document.createElement('li');
      li.className = 'reminder-item';

      const repeatText = r.days && r.days.length
        ? '毎週 ' + r.days.slice().sort().map((d) => WEEK[d]).join('・')
        : '1回だけ';
      const leadText = r.lead > 0 ? `${r.lead}分前に着信` : 'ちょうどに着信';

      li.innerHTML = `
        <div class="info">
          <div class="r-title"></div>
          <div class="r-meta"></div>
        </div>
        <div class="r-time"></div>
        <button class="del" aria-label="削除">🗑</button>`;
      li.querySelector('.r-title').textContent = r.title;
      li.querySelector('.r-meta').textContent = `${repeatText} ・ ${leadText}`;
      li.querySelector('.r-time').textContent = r.time;
      li.querySelector('.del').addEventListener('click', () => removeReminder(r.id));
      listEl.appendChild(li);
    }
  }

  function removeReminder(id) {
    reminders = reminders.filter((r) => r.id !== id);
    save();
    render();
  }

  // ============ 追加 ============
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    unlockAudio(); // 追加時のタップで音の許可を取っておく
    const title = $('title').value.trim() || '予定';
    const time = $('time').value;
    if (!time) return;
    const lead = parseInt($('lead').value, 10) || 0;
    const days = [...document.querySelectorAll('.days input:checked')].map((c) => Number(c.value));

    const r = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), title, time, lead, days, next: null };
    r.next = computeNext(r, Date.now());
    reminders.push(r);
    save();
    render();

    form.reset();
    $('lead').value = String(lead); // リード時間は使い回すことが多いので残す
  });

  // ============ 監視ループ ============
  function tick() {
    if (ringing) return; // 着信中は追加で鳴らさない
    const now = Date.now();
    for (const r of reminders) {
      if (r.next != null && now >= r.next) {
        startCall(r);
        break;
      }
    }
  }

  // ============ 着信 ============
  function startCall(r) {
    ringing = r;
    $('call-title').textContent = r.title;
    const when = r.lead > 0 ? `あと ${r.lead}分で「${r.time}」だよ` : `「${r.time}」の時間だよ`;
    $('call-sub').textContent = when;
    $('call-screen').classList.remove('hidden');

    startRingtone();
    startVibration();
    notify(r);
    requestWakeLock();

    // 60秒放置したら自動で「あとで」
    autoStopTimer = setTimeout(() => declineCall(), 60000);
  }

  function endCall() {
    stopRingtone();
    stopVibration();
    releaseWakeLock();
    clearTimeout(autoStopTimer);
    $('call-screen').classList.add('hidden');
  }

  function answerCall() {
    if (!ringing) return;
    const r = ringing;
    endCall();
    $('answered-title').textContent = `⏰ ${r.title}`;
    $('answered-sub').textContent = r.lead > 0
      ? `あと ${r.lead}分！ 準備を始めよう。`
      : `いまがその時間！`;
    $('answered').classList.remove('hidden');
    finishReminder(r, false);
  }

  // 拒否＝5分後にもう一度（スヌーズ）
  function declineCall() {
    if (!ringing) return;
    const r = ringing;
    endCall();
    ringing = null;
    r.next = Date.now() + 5 * 60000; // 5分後に再着信
    save();
    render();
  }

  function finishReminder(r, keepSnooze) {
    ringing = null;
    if (r.days && r.days.length) {
      r.next = computeNext(r, Date.now() + 1000); // 繰り返しは次回へ
    } else {
      reminders = reminders.filter((x) => x.id !== r.id); // 単発は消す
    }
    save();
    render();
  }

  $('answer').addEventListener('click', answerCall);
  $('decline').addEventListener('click', declineCall);
  $('answered-ok').addEventListener('click', () => $('answered').classList.add('hidden'));

  // ============ 着信音（Web Audioで合成／音源ファイル不要） ============
  function unlockAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playRingBurst() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    // 「プルルル×2」の電話ベル風パターン
    const beep = (start, freqA, freqB) => {
      const g = audioCtx.createGain();
      g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.6, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      [freqA, freqB].forEach((f) => {
        const o = audioCtx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(g);
        o.start(start);
        o.stop(start + 0.36);
      });
    };
    beep(now + 0.0, 440, 480);
    beep(now + 0.4, 440, 480);
  }

  function startRingtone() {
    unlockAudio();
    playRingBurst();
    ringTimer = setInterval(playRingBurst, 2000); // 2秒ごとに鳴らし続ける
  }
  function stopRingtone() {
    clearInterval(ringTimer);
    ringTimer = null;
  }

  // ============ バイブ ============
  function startVibration() {
    if (!('vibrate' in navigator)) return;
    const buzz = () => navigator.vibrate([600, 300, 600, 1000]);
    buzz();
    vibrateTimer = setInterval(buzz, 2500);
  }
  function stopVibration() {
    clearInterval(vibrateTimer);
    vibrateTimer = null;
    if ('vibrate' in navigator) navigator.vibrate(0);
  }

  // ============ 通知 ============
  function notify(r) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('📞 CallMe', {
        body: r.lead > 0 ? `「${r.title}」まで あと${r.lead}分！` : `「${r.title}」の時間だよ！`,
        tag: 'callme',
        renotify: true,
      });
    } catch { /* SW経由でないと出せない環境もある */ }
  }

  $('enable-notify').addEventListener('click', async () => {
    unlockAudio();
    if (!('Notification' in window)) {
      alert('この端末は通知に対応していません。アプリを開いている間は音とバイブで知らせます。');
      return;
    }
    const p = await Notification.requestPermission();
    $('enable-notify').textContent = p === 'granted' ? '🔔 通知は許可済み' : '🔔 通知を許可する';
  });

  // ============ 画面ロック防止 ============
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 失敗しても無視 */ }
  }
  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch {}
  }

  // ============ テスト・ヘルプ ============
  $('test-call').addEventListener('click', () => {
    unlockAudio();
    startCall({ title: 'テスト着信', time: nowHHMM(), lead: 0, days: [], id: 'test' });
  });
  function nowHHMM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  $('show-help').addEventListener('click', (e) => { e.preventDefault(); $('help').classList.remove('hidden'); });
  $('help-close').addEventListener('click', () => $('help').classList.add('hidden'));

  // ============ 初期化 ============
  // どのタップでも音を解禁できるように
  document.body.addEventListener('pointerdown', unlockAudio, { once: true });

  if ('Notification' in window && Notification.permission === 'granted') {
    $('enable-notify').textContent = '🔔 通知は許可済み';
  }
  // 既定の予定時刻を「今より少し先」に
  (() => {
    const d = new Date(Date.now() + 30 * 60000);
    $('time').value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  })();

  // Service Worker（オフライン対応）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  refreshTriggers();
  render();
  setInterval(tick, 1000);
})();
