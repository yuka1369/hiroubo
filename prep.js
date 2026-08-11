/* まにあう — 到着から逆算して、やることの時刻を自動で出すじたくリスト
 * すべてブラウザ内で完結。データは localStorage に保存。
 */
(() => {
  'use strict';

  const STORE_KEY = 'maniau.plans.v1';
  const MEAL = { breakfast: { t: '朝ごはん', at: '08:00', m: 20 }, lunch: { t: '昼ごはん', at: '12:30', m: 30 } };

  // ===== ジャンル別テンプレート =====
  // pre : 事前（数日前）… d = 何日前まで
  // night : 前日の夜（夕食後）… m = 所要分
  // day : 当日の身支度（逆算対象）… m = 所要分, 時系列の早い順に並べる
  // min:true = 「最低限だけ」でも残すタスク
  const CATEGORIES = {
    date: {
      label: 'デート', emoji: '💕', travel: 40,
      meals: ['breakfast', 'lunch'],
      pre: [
        { t: '美容本チェック・美容の予定を思い出す', d: 7 },
        { t: '眉を整える（お店でやるなら予約）', d: 3 },
        { t: '髪をツヤツヤにセット（美容院）', d: 3 },
        { t: 'ネイルの予約 or 準備', d: 3 },
      ],
      night: [
        { t: '📍 場所と電車の時間を調べる', m: 15, min: true },
        { t: '着ていく服を決めて出しておく', m: 15, min: true },
        { t: 'バッグの中身をつめる', m: 10, min: true },
        { t: '湯船につかる', m: 20 },
        { t: '酵素洗顔', m: 5 },
        { t: 'かおパック（ユースキン）', m: 15 },
        { t: 'ボディを保湿しまくる', m: 10 },
        { t: '毛をそる', m: 15 },
        { t: '筋トレ', m: 15 },
      ],
      day: [
        { t: 'シャワー・洗顔', m: 15 },
        { t: '石原さとみ顔トレ', m: 5 },
        { t: 'スキンケア・ボディ保湿', m: 10 },
        { t: 'ヘアセット（ツヤツヤ）', m: 20 },
        { t: '眉を整える・おひげ！', m: 10, min: true },
        { t: 'ネイル仕上げ', m: 15, min: true },
        { t: 'メイク', m: 30, min: true },
        { t: '口臭対策（歯みがき・舌ブラシ・歯間ブラシ・お口クチュクチュ）', m: 10, min: true },
        { t: '胃薬・タブレットをのむ', m: 3, min: true },
        { t: '服を着る', m: 10, min: true },
        { t: 'バッグを最終チェック', m: 5, min: true },
      ],
    },
    friends: {
      label: '友達との約束', emoji: '🧋', travel: 40,
      meals: ['breakfast', 'lunch'],
      pre: [{ t: '行くお店・カフェを決める', d: 3 }],
      night: [
        { t: '📍 場所と電車の時間を調べる', m: 15, min: true },
        { t: '着ていく服を決める', m: 10, min: true },
        { t: '持ち物・バッグを準備', m: 10, min: true },
      ],
      day: [
        { t: 'シャワー・洗顔', m: 15 },
        { t: 'ヘアセット', m: 15 },
        { t: 'メイク・身支度', m: 25, min: true },
        { t: '歯みがき・口臭対策', m: 5, min: true },
        { t: '服を着る', m: 10, min: true },
        { t: '持ち物チェック', m: 5, min: true },
      ],
    },
    work: {
      label: '会社', emoji: '🏢', travel: 45,
      meals: ['breakfast'],
      pre: [],
      night: [
        { t: '📍 電車の時間を確認する', m: 10, min: true },
        { t: '明日の持ち物・書類を準備', m: 15, min: true },
        { t: '着る服（スーツ等）を出しておく', m: 10, min: true },
      ],
      day: [
        { t: '洗顔・シャワー', m: 15 },
        { t: '身支度（メイク／ひげそり）', m: 20, min: true },
        { t: 'ヘアセット', m: 10 },
        { t: '歯みがき', m: 5, min: true },
        { t: '服を着る', m: 10, min: true },
        { t: '持ち物チェック', m: 5, min: true },
      ],
    },
    job: {
      label: '就活', emoji: '🎓', travel: 60,
      meals: ['breakfast'],
      pre: [
        { t: '企業研究・志望動機を確認', d: 3 },
        { t: '会場の場所を確認', d: 3 },
        { t: '提出書類・持ち物リストを確認', d: 2 },
      ],
      night: [
        { t: '📍 場所と電車の時間を調べる', m: 15, min: true },
        { t: 'スーツ・シャツ・靴を準備', m: 15, min: true },
        { t: '持ち物準備（履歴書・筆記用具・学生証など）', m: 15, min: true },
        { t: '想定質問を最終チェック', m: 20 },
      ],
      day: [
        { t: 'シャワー・洗顔', m: 15 },
        { t: '身支度（メイク／ひげそり／髪）', m: 25, min: true },
        { t: 'スーツを着る', m: 10, min: true },
        { t: '口臭・身だしなみチェック', m: 5, min: true },
        { t: '持ち物最終チェック', m: 5, min: true },
      ],
    },
  };

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const form = $('plan-form');
  let selectedCat = 'date';

  // ===== 保存・読み込み =====
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
  }
  function save(plans) { localStorage.setItem(STORE_KEY, JSON.stringify(plans)); }
  let plans = load();

  // ===== 日付ユーティリティ =====
  function atTime(dateStr, hhmm, dayOffset = 0) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    return new Date(y, mo - 1, d + dayOffset, h, mi, 0, 0);
  }
  function addMin(date, m) { return new Date(date.getTime() + m * 60000); }
  function fmt(date, eventDateStr) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ev = atTime(eventDateStr, '00:00');
    const dd = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((dd - ev) / 86400000);
    const prefix = diff === -1 ? '前日 ' : diff === 1 ? '翌日 ' : diff < -1 ? `${-diff}日前 ` : '';
    return prefix + hh + ':' + mm;
  }

  // ===== スケジュール計算 =====
  function computeSchedule(p) {
    const cat = CATEGORIES[p.category];
    const full = p.mode === 'full';
    const pick = (arr) => arr.filter((t) => full || t.min);

    const meeting = atTime(p.date, p.meeting);
    const arrival = addMin(meeting, -p.early);
    const leaveHome = addMin(arrival, -p.travel);

    // 当日の身支度（家を出る時刻から逆算）
    const dayTasks = pick(cat.day);
    const totalDay = dayTasks.reduce((s, t) => s + t.m, 0);
    let cur = addMin(leaveHome, -totalDay);
    const dayItems = [];
    const wake = new Date(cur);
    for (const t of dayTasks) {
      const start = new Date(cur);
      cur = addMin(cur, t.m);
      dayItems.push({ key: 'day::' + t.t, label: t.t, start, dur: t.m, check: true });
    }

    // 食事（実時刻に固定・家を出る前だけ表示）
    for (const key of cat.meals || []) {
      const meal = MEAL[key];
      const start = atTime(p.date, meal.at);
      if (addMin(start, meal.m) <= leaveHome) {
        dayItems.push({ key: 'meal::' + key, label: meal.t, start, dur: meal.m, check: true });
      }
    }
    dayItems.sort((a, b) => a.start - b.start);

    // 目印（チェック無し）
    const markers = [
      { label: '🏠 家を出る', start: leaveHome, marker: true },
      { label: '🚃 移動（' + p.travel + '分）', start: leaveHome, marker: true, span: true },
      { label: '📍 到着（' + p.early + '分前）', start: arrival, marker: true, goal: true },
      { label: '🎯 集合・開始', start: meeting, marker: true, goal: true },
    ];

    // 前日の夜（夕食後から前へ積む）
    let ncur = atTime(p.date, p.night, -1);
    const nightItems = pick(cat.night).map((t) => {
      const start = new Date(ncur);
      ncur = addMin(ncur, t.m);
      return { key: 'night::' + t.t, label: t.t, start, dur: t.m, check: true };
    });

    // 事前（数日前）
    const preItems = pick(cat.pre).map((t) => ({ key: 'pre::' + t.t, label: t.t, days: t.d, check: true }));

    return { cat, meeting, arrival, leaveHome, wake, dayItems, markers, nightItems, preItems };
  }

  // ===== 描画 =====
  function countChecks(p, s) {
    const all = [...s.preItems, ...s.nightItems, ...s.dayItems];
    const done = all.filter((it) => p.checks[it.key]).length;
    return { done, total: all.length };
  }

  function taskRow(p, it, eventDateStr, timeText) {
    const li = document.createElement('label');
    li.className = 'task' + (p.checks[it.key] ? ' done' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!p.checks[it.key];
    cb.addEventListener('change', () => {
      p.checks[it.key] = cb.checked;
      save(plans);
      render();
    });
    const time = document.createElement('div');
    time.className = 'time' + (timeText && timeText.length > 6 ? ' small' : '');
    time.textContent = timeText || '';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = it.label;
    li.append(cb, time, label);
    if (it.dur) {
      const dur = document.createElement('div');
      dur.className = 'dur';
      dur.textContent = it.dur + '分';
      li.appendChild(dur);
    }
    return li;
  }

  function markerRow(it, eventDateStr) {
    const div = document.createElement('div');
    div.className = 'task marker' + (it.goal ? ' goal' : '');
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = it.span ? '' : fmt(it.start, eventDateStr);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = it.label;
    div.append(time, label);
    return div;
  }

  function render() {
    const wrap = $('plans');
    wrap.innerHTML = '';
    if (!plans.length) {
      wrap.innerHTML = '<p class="empty">まだリストがありません。上のフォームから作ってね。</p>';
      return;
    }

    for (const p of plans) {
      const s = computeSchedule(p);
      const { done, total } = countChecks(p, s);
      const pct = total ? Math.round((done / total) * 100) : 0;

      const card = document.createElement('div');
      card.className = 'plan';

      // ヘッダ
      const head = document.createElement('div');
      head.className = 'plan-head';
      head.innerHTML = `
        <div class="ttl">
          <h3></h3>
          <div class="when"></div>
        </div>
        <button class="del" aria-label="削除">🗑</button>`;
      head.querySelector('h3').textContent = `${s.cat.emoji} ${p.name || s.cat.label}`;
      const dObj = atTime(p.date, '00:00');
      const wk = '日月火水木金土'[dObj.getDay()];
      head.querySelector('.when').textContent =
        `${dObj.getMonth() + 1}/${dObj.getDate()}(${wk}) ・ ${s.cat.label} ・ ${p.mode === 'full' ? 'フルコース' : '最低限'}`;
      head.querySelector('.del').addEventListener('click', () => {
        plans = plans.filter((x) => x.id !== p.id);
        save(plans);
        render();
      });
      card.appendChild(head);

      // キータイム
      const kt = document.createElement('div');
      kt.className = 'keytimes';
      const keys = [
        { l: '起きる', v: fmt(s.wake, p.date) },
        { l: '家を出る', v: fmt(s.leaveHome, p.date) },
        { l: '到着', v: fmt(s.arrival, p.date), hi: true },
        { l: '集合', v: fmt(s.meeting, p.date), hi: true },
      ];
      for (const k of keys) {
        const el = document.createElement('div');
        el.className = 'keytime' + (k.hi ? ' hi' : '');
        el.innerHTML = `${k.l}<b></b>`;
        el.querySelector('b').textContent = k.v;
        kt.appendChild(el);
      }
      card.appendChild(kt);

      // 進捗
      const pr = document.createElement('div');
      pr.className = 'progress';
      pr.innerHTML = `<div class="bar"><i></i></div><div class="txt"></div>`;
      pr.querySelector('i').style.width = pct + '%';
      pr.querySelector('.txt').textContent = `${done} / ${total} 完了（${pct}%）`;
      card.appendChild(pr);

      // 事前
      if (s.preItems.length) {
        const ph = document.createElement('div');
        ph.className = 'phase';
        ph.innerHTML = '<h4>📅 前もって（数日前）</h4>';
        for (const it of s.preItems) ph.appendChild(taskRow(p, it, p.date, `${it.days}日前`));
        card.appendChild(ph);
      }

      // 前日の夜
      if (s.nightItems.length) {
        const ph = document.createElement('div');
        ph.className = 'phase';
        ph.innerHTML = '<h4>🌙 前日の夜（夕食後）</h4>';
        for (const it of s.nightItems) ph.appendChild(taskRow(p, it, p.date, fmt(it.start, p.date)));
        card.appendChild(ph);
      }

      // 当日
      const ph = document.createElement('div');
      ph.className = 'phase';
      ph.innerHTML = '<h4>☀️ 当日</h4>';
      // 起きる目印
      ph.appendChild(markerRow({ label: '🛏 起きる（支度スタート）', start: s.wake, marker: true }, p.date));
      for (const it of s.dayItems) ph.appendChild(taskRow(p, it, p.date, fmt(it.start, p.date)));
      for (const m of s.markers) ph.appendChild(markerRow(m, p.date));
      card.appendChild(ph);

      wrap.appendChild(card);
    }
  }

  // ===== カテゴリ選択 =====
  function selectCat(cat) {
    selectedCat = cat;
    document.querySelectorAll('.cat').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    $('travel').value = CATEGORIES[cat].travel;
  }
  document.querySelectorAll('.cat').forEach((b) => b.addEventListener('click', () => selectCat(b.dataset.cat)));

  // ===== 送信 =====
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('date').value || !$('meeting').value) {
      alert('日付と集合時刻を入れてね。');
      return;
    }
    const p = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      category: selectedCat,
      name: $('name').value.trim(),
      date: $('date').value,
      meeting: $('meeting').value,
      travel: Math.max(0, parseInt($('travel').value, 10) || 0),
      early: Math.max(0, parseInt($('early').value, 10) || 0),
      night: $('night').value || '20:30',
      mode: document.querySelector('input[name="mode"]:checked').value,
      checks: {},
    };
    plans.unshift(p);
    save(plans);
    render();
    $('name').value = '';
    document.getElementById('plans').scrollIntoView({ behavior: 'smooth' });
  });

  // ===== 初期化 =====
  selectCat('date');
  (() => {
    const tmr = new Date(Date.now() + 86400000); // 既定は明日
    $('date').value = `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`;
    $('meeting').value = '13:00';
  })();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});

  render();
})();
