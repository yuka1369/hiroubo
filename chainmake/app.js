/* ChainMake — 〇〇のあとは〇〇。習慣を鎖でつなぐ習慣化アプリ
 * チェーンメイク（習慣の連鎖）メソッド：すでにやっている行動のあとに
 * 次の行動をくっつけて、朝のルーティンを最後まで走りきる。
 * すべてブラウザ内で完結（サーバー不要）。データは localStorage に保存。
 */
(() => {
  'use strict';

  const STORE_KEY = 'chainmake.chains.v1';
  const $ = (id) => document.getElementById(id);

  // ---- 状態 ----
  let chains = load();
  let editingId = null;       // 編集中のチェーンID（新規は null）
  let run = null;             // 実行中: { chain, index }

  // ============ 保存・読み込み ============
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* 壊れていたら初期データへ */ }
    return seed();
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(chains));
  }

  // 初回起動時のお手本チェーン（ユーザーのコンセプト：朝のベッドメイキング）
  function seed() {
    return [{
      id: uid(),
      title: '朝のベッドメイキング',
      anchor: 'ベッドから出たら',
      steps: ['カーテンを開けて光を入れる', '枕と布団を整える', '机の上をリセット', 'シーツをピンと伸ばす'],
      cheer: 'ベッドメイキング！',
      streak: 0,
      lastDone: null,
      doneDates: [],
      created: Date.now(),
    }];
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // ============ 日付ユーティリティ ============
  function todayKey(d = new Date()) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function yesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return todayKey(d);
  }
  function isDoneToday(c) { return c.lastDone === todayKey(); }

  // ============ ホーム描画 ============
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  }

  function flowHtml(c) {
    const parts = [];
    if (c.anchor) parts.push(`<span class="anchor">${escapeHtml(c.anchor)}</span>`);
    c.steps.forEach((s, i) => {
      const isGoal = i === c.steps.length - 1;
      const cls = isGoal ? 'goal' : '';
      parts.push(`<span class="${cls}">${escapeHtml(s)}</span>`);
    });
    return parts.join('<span class="arrow">→</span>');
  }

  function renderList() {
    const list = $('chain-list');
    list.innerHTML = '';
    const sorted = [...chains].sort((a, b) => a.created - b.created);

    for (const c of sorted) {
      const done = isDoneToday(c);
      const li = document.createElement('li');
      li.className = 'chain-item' + (done ? ' done' : '');

      const streakHtml = c.streak > 0
        ? `<div class="streak-pill">🔥 ${c.streak}日連続</div>`
        : '';

      li.innerHTML = `
        <div class="chain-top">
          <div class="chain-info">
            <div class="chain-title"><span class="t"></span></div>
            <div class="chain-meta"></div>
            <div class="chain-flow">${flowHtml(c)}</div>
            ${streakHtml}
          </div>
          <div class="check">${done ? '✓' : ''}</div>
        </div>
        <div class="chain-actions">
          <button class="start">${done ? 'もう一度やる ↻' : '▶ はじめる'}</button>
          <button class="mini edit" aria-label="編集">✎</button>
          <button class="mini del" aria-label="削除">🗑</button>
        </div>`;

      li.querySelector('.chain-title .t').textContent = c.title;
      const cheerText = c.cheer ? `ゴール「${c.cheer}」` : 'ゴールまで';
      li.querySelector('.chain-meta').textContent = `${c.steps.length}ステップ ・ ${cheerText}`;
      li.querySelector('.start').addEventListener('click', () => startRun(c));
      li.querySelector('.edit').addEventListener('click', () => openEditor(c));
      li.querySelector('.del').addEventListener('click', () => removeChain(c));
      list.appendChild(li);
    }
  }

  function removeChain(c) {
    if (!confirm(`「${c.title}」を削除しますか？`)) return;
    chains = chains.filter((x) => x.id !== c.id);
    save();
    renderList();
  }

  // ============ 作成・編集 ============
  function addStepRow(value = '') {
    const ul = $('step-list');
    const li = document.createElement('li');
    li.className = 'step-edit-item';
    li.innerHTML = `
      <span class="num"></span>
      <input type="text" maxlength="40" placeholder="例）布団をたたむ" />
      <button type="button" class="rm" aria-label="削除">✕</button>`;
    li.querySelector('input').value = value;
    li.querySelector('.rm').addEventListener('click', () => {
      li.remove();
      renumberSteps();
    });
    ul.appendChild(li);
    renumberSteps();
    return li;
  }

  function renumberSteps() {
    [...$('step-list').children].forEach((li, i) => {
      li.querySelector('.num').textContent = i + 1;
    });
  }

  function openEditor(chain) {
    editingId = chain ? chain.id : null;
    $('editor-title').textContent = chain ? 'チェーンを編集' : '新しいチェーン';
    $('c-title').value = chain ? chain.title : '';
    $('c-anchor').value = chain ? (chain.anchor || '') : '';
    $('c-cheer').value = chain ? (chain.cheer || '') : '';

    $('step-list').innerHTML = '';
    const steps = chain && chain.steps.length ? chain.steps : ['', ''];
    steps.forEach((s) => addStepRow(s));

    $('editor').classList.remove('hidden');
    $('c-title').focus();
  }

  function closeEditor() {
    $('editor').classList.add('hidden');
    editingId = null;
  }

  $('new-chain').addEventListener('click', () => openEditor(null));
  $('editor-close').addEventListener('click', closeEditor);
  $('add-step').addEventListener('click', () => {
    const li = addStepRow('');
    li.querySelector('input').focus();
  });

  $('chain-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('c-title').value.trim();
    const steps = [...$('step-list').querySelectorAll('input')]
      .map((i) => i.value.trim())
      .filter(Boolean);

    if (!title) { alert('チェーン名を入れてね。'); return; }
    if (steps.length === 0) { alert('行動を1つ以上追加してね。'); return; }

    const data = {
      title,
      anchor: $('c-anchor').value.trim(),
      steps,
      cheer: $('c-cheer').value.trim() || '完了！',
    };

    if (editingId) {
      const c = chains.find((x) => x.id === editingId);
      if (c) Object.assign(c, data);
    } else {
      chains.push({
        id: uid(),
        ...data,
        streak: 0,
        lastDone: null,
        doneDates: [],
        created: Date.now(),
      });
    }
    save();
    renderList();
    closeEditor();
  });

  // ============ 実行（フォーカス）モード ============
  function startRun(chain) {
    run = { chain, index: 0 };
    $('run').classList.remove('hidden');
    showStep();
  }

  function showStep() {
    const { chain, index } = run;
    const total = chain.steps.length;
    const isLast = index === total - 1;

    $('run-step').textContent = chain.steps[index];
    $('run-count').textContent = `${index + 1} / ${total}`;
    $('run-bar').style.width = `${(index / total) * 100}%`;

    if (isLast) {
      $('run-next').innerHTML = `<span class="arrow">→</span> このあと 🎉 <b>${escapeHtml(chain.cheer)}</b>`;
      $('run-done').textContent = 'できた！ 🎉 ゴール';
    } else {
      $('run-next').innerHTML = `つぎは <span class="arrow">→</span> ${escapeHtml(chain.steps[index + 1])}`;
      $('run-done').textContent = 'できた！ 👇 つぎへ';
    }
    buzz(20);
  }

  function nextStep() {
    run.index++;
    if (run.index >= run.chain.steps.length) {
      completeRun();
    } else {
      showStep();
    }
  }

  function completeRun() {
    const c = run.chain;
    recordDone(c);
    $('run-bar').style.width = '100%';
    $('run').classList.add('hidden');

    $('finish-cheer').textContent = c.cheer || '完了！';
    $('finish-sub').textContent = '今日のチェーン、コンプリート！';
    $('finish-streak').textContent = `🔥 ${c.streak}日連続`;
    $('finish').classList.remove('hidden');
    buzz([40, 60, 120]);
    run = null;
  }

  // 今日の完了を記録し、連続日数（ストリーク）を更新
  function recordDone(c) {
    const today = todayKey();
    if (c.lastDone === today) return; // 今日はもう記録済み
    if (c.lastDone === yesterdayKey()) c.streak = (c.streak || 0) + 1;
    else c.streak = 1;                // 昨日やっていなければ仕切り直し
    c.lastDone = today;
    c.doneDates = c.doneDates || [];
    if (!c.doneDates.includes(today)) c.doneDates.push(today);
    save();
    renderList();
  }

  function quitRun() {
    run = null;
    $('run').classList.add('hidden');
  }

  $('run-done').addEventListener('click', nextStep);
  $('run-skip').addEventListener('click', nextStep);
  $('run-quit').addEventListener('click', quitRun);
  $('finish-ok').addEventListener('click', () => $('finish').classList.add('hidden'));

  // ============ バイブ（対応端末のみ） ============
  function buzz(pattern) {
    if ('vibrate' in navigator) { try { navigator.vibrate(pattern); } catch {} }
  }

  // ============ 初期化 ============
  renderList();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
})();
