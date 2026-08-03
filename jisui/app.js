/* じすいっち — メインロジック（サーバー不要・localStorage保存） */
(() => {
  'use strict';

  // ============ 保存キー ============
  const K = {
    creators: 'jisui.creators.v1',
    recipes:  'jisui.recipes.v1',
    plan:     'jisui.plan.v1',
    checks:   'jisui.checks.v1',
  };

  const DAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];
  const SLOTS = [
    { id: 'breakfast', label: '朝', emoji: '🌅' },
    { id: 'lunch',     label: '昼', emoji: '☀️' },
    { id: 'dinner',    label: '夜', emoji: '🌙' },
  ];

  const $ = (id) => document.getElementById(id);
  const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');

  // ============ 状態 ============
  let userCreators = loadJSON(K.creators, []);
  let userRecipes  = loadJSON(K.recipes, []);
  let plan         = loadJSON(K.plan, null);   // { weekStart, meals: {dayIdx: {slot: recipeId}} }
  let checks       = loadJSON(K.checks, {});   // 買い出しチェック
  let creatorFormCats = new Set();

  function loadJSON(k, fallback) {
    try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  }
  const saveCreators = () => localStorage.setItem(K.creators, JSON.stringify(userCreators));
  const saveRecipes  = () => localStorage.setItem(K.recipes, JSON.stringify(userRecipes));
  const savePlan     = () => localStorage.setItem(K.plan, JSON.stringify(plan));
  const saveChecks   = () => localStorage.setItem(K.checks, JSON.stringify(checks));

  const allCreators = () => [...SEED_CREATORS, ...userCreators];
  const allRecipes  = () => [...SEED_RECIPES, ...userRecipes];
  const catById      = (id) => CATEGORIES.find((c) => c.id === id);
  const recipeById   = (id) => allRecipes().find((r) => r.id === id);
  const creatorById  = (id) => allCreators().find((c) => c.id === id);
  const recipeCost   = (r) => r ? r.ings.reduce((s, i) => s + (i.price || 0), 0) : 0;

  // ============ タブ切り替え ============
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  function showTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    ['plan', 'recipes', 'creators', 'shopping'].forEach((t) => {
      $('tab-' + t).classList.toggle('hidden', t !== name);
    });
    if (name === 'shopping') renderShopping();
    window.scrollTo(0, 0);
  }

  // ============ 献立の推薦 ============
  function mondayOf(dateStr) {
    const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const day = (d.getDay() + 6) % 7; // 月=0
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function fmtDate(d) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // プールから条件に合うレシピを1つ選ぶ（多様性のため used を避ける）
  function pick(pool, slot, { weekend, used }) {
    let cand = pool.filter((r) => r.meals.includes(slot));
    if (weekend) {
      // 土日：30分以内の冷凍ストック・作り置き優先
      const stock = cand.filter((r) => r.freeze && r.time <= 30);
      if (stock.length) cand = stock;
      else cand = cand.filter((r) => r.time <= 30).length ? cand.filter((r) => r.time <= 30) : cand;
    }
    if (!cand.length) cand = pool.filter((r) => r.meals.includes(slot));
    if (!cand.length) cand = pool.slice();
    if (!cand.length) return null;

    const score = (r) => {
      let s = 0;
      if (weekend) { if (r.freeze) s += 40; s += Math.max(0, 30 - r.time); }
      else { if (r.nutri) s += 30; s += Math.max(0, 30 - r.time); } // 平日：簡単＆栄養
      if (used.has(r.id)) s -= 100;                 // 同じ週での重複を強く回避
      s += Math.random() * 10;                       // 少しゆらぎ
      return s;
    };
    cand.sort((a, b) => score(b) - score(a));
    return cand[0];
  }

  function buildPlan() {
    const weekStart = mondayOf($('week-start').value);
    const useCreatorsOnly = $('use-creators-only').checked;

    let pool = allRecipes();
    if (useCreatorsOnly) {
      const ids = new Set(allCreators().map((c) => c.id));
      const filtered = pool.filter((r) => r.creatorId && ids.has(r.creatorId));
      if (filtered.length >= 6) pool = filtered; // 少なすぎるときは全体で補う
    }

    const meals = {};
    const used = new Set();
    for (let d = 0; d < 7; d++) {
      const weekend = d >= 5; // 土(5)日(6)
      meals[d] = {};
      for (const slot of SLOTS) {
        const r = pick(pool, slot.id, { weekend, used });
        if (r) { meals[d][slot.id] = r.id; used.add(r.id); }
      }
    }

    plan = { weekStart: weekStart.toISOString().slice(0, 10), meals };

    // 予算で決定：オーバーしていたら高い食事を節約系に差し替え
    const budget = parseInt($('budget').value, 10);
    let note = '';
    if (budget && budget > 0) {
      const trimmed = fitToBudget(budget, pool);
      note = trimmed
        ? `予算 ${yen(budget)} 以内におさめました（合計 ${yen(planTotal())}）`
        : `できるだけ節約系に寄せましたが、合計 ${yen(planTotal())} と予算 ${yen(budget)} を少し超えました`;
    }
    $('plan-budget-note').textContent = note;

    savePlan();
    checks = {}; saveChecks();
    renderPlan();
  }

  // 予算内に収まるよう、高コストの食事から順に安い代替へ差し替え
  function fitToBudget(budget, pool) {
    for (let guard = 0; guard < 40 && planTotal() > budget; guard++) {
      // いま一番高い食事を探す
      let worst = null;
      forEachMeal((d, slot, rid) => {
        const c = recipeCost(recipeById(rid));
        if (!worst || c > worst.cost) worst = { d, slot, rid, cost: c };
      });
      if (!worst) break;
      // その枠に入る、より安い代替（節約系優先）
      const alts = pool
        .filter((r) => r.meals.includes(worst.slot) && r.id !== worst.rid)
        .filter((r) => recipeCost(r) < worst.cost)
        .sort((a, b) => (a.cat === 'thrifty' ? -1 : 0) - (b.cat === 'thrifty' ? -1 : 0) || recipeCost(a) - recipeCost(b));
      if (!alts.length) break;
      plan.meals[worst.d][worst.slot] = alts[0].id;
    }
    savePlan();
    return planTotal() <= budget;
  }

  function forEachMeal(fn) {
    if (!plan) return;
    for (const d of Object.keys(plan.meals)) {
      for (const slot of Object.keys(plan.meals[d])) {
        fn(Number(d), slot, plan.meals[d][slot]);
      }
    }
  }
  function planTotal() {
    let t = 0;
    forEachMeal((d, slot, rid) => { t += recipeCost(recipeById(rid)); });
    return t;
  }

  // ============ 献立の描画 ============
  function renderPlan() {
    const wrap = $('plan-list');
    wrap.innerHTML = '';
    if (!plan) {
      $('decide-card').classList.add('hidden');
      return;
    }
    const start = new Date(plan.weekStart + 'T00:00:00');

    for (let d = 0; d < 7; d++) {
      const date = new Date(start); date.setDate(start.getDate() + d);
      const weekend = d >= 5;
      const dayEl = document.createElement('div');
      dayEl.className = 'day-card' + (weekend ? ' weekend' : '');
      dayEl.innerHTML = `<div class="day-head"><span class="day-name">${DAY_LABELS[d]}</span>
        <span class="day-date">${fmtDate(date)}</span>
        ${weekend ? '<span class="day-tag">🧊 作り置きの日</span>' : ''}</div>`;

      for (const slot of SLOTS) {
        const rid = plan.meals[d] && plan.meals[d][slot.id];
        const rc = rid ? recipeById(rid) : null;
        const cell = document.createElement('div');
        cell.className = 'meal-cell';
        if (rc) {
          const cat = catById(rc.cat);
          cell.innerHTML = `
            <div class="meal-slot">${slot.emoji} ${slot.label}</div>
            <div class="meal-body">
              <div class="meal-name"></div>
              <div class="meal-meta">
                <span class="tag">${cat ? cat.emoji + cat.name : ''}</span>
                <span class="tag">⏱${rc.time}分</span>
                ${rc.nutri ? '<span class="tag nutri">🥗栄養◎</span>' : ''}
                ${rc.freeze ? '<span class="tag freeze">🧊作り置き</span>' : ''}
                <span class="tag cost">${yen(recipeCost(rc))}</span>
              </div>
            </div>
            <button class="swap-btn" title="差し替え">🔄</button>`;
          cell.querySelector('.meal-name').textContent = rc.name;
          cell.querySelector('.swap-btn').addEventListener('click', () => openSwap(d, slot.id));
        } else {
          cell.innerHTML = `<div class="meal-slot">${slot.emoji} ${slot.label}</div><div class="meal-body empty-cell">—</div>`;
        }
        dayEl.appendChild(cell);
      }
      wrap.appendChild(dayEl);
    }

    $('plan-total').textContent = yen(planTotal());
    $('decide-card').classList.remove('hidden');
  }

  // ============ レシピ差し替えモーダル ============
  function openSwap(d, slot) {
    const cur = plan.meals[d][slot];
    const useCreatorsOnly = $('use-creators-only').checked;
    let pool = allRecipes().filter((r) => r.meals.includes(slot));
    if (useCreatorsOnly) {
      const ids = new Set(allCreators().map((c) => c.id));
      const f = pool.filter((r) => r.creatorId && ids.has(r.creatorId));
      if (f.length) pool = f;
    }
    pool.sort((a, b) => recipeCost(a) - recipeCost(b));

    const box = $('swap-options');
    box.innerHTML = '';
    $('swap-title').textContent = `${DAY_LABELS[d]}の${SLOTS.find((s) => s.id === slot).label} を差し替え`;
    pool.forEach((r) => {
      const cat = catById(r.cat);
      const opt = document.createElement('button');
      opt.className = 'swap-opt' + (r.id === cur ? ' current' : '');
      opt.innerHTML = `<span class="so-name"></span>
        <span class="so-meta">${cat ? cat.emoji : ''} ⏱${r.time}分 ・ ${yen(recipeCost(r))}${r.nutri ? ' ・🥗' : ''}${r.freeze ? ' ・🧊' : ''}</span>`;
      opt.querySelector('.so-name').textContent = r.name;
      opt.addEventListener('click', () => {
        plan.meals[d][slot] = r.id;
        savePlan();
        renderPlan();
        closeSwap();
      });
      box.appendChild(opt);
    });
    $('swap-modal').classList.remove('hidden');
  }
  function closeSwap() { $('swap-modal').classList.add('hidden'); }
  $('swap-close').addEventListener('click', closeSwap);
  $('swap-modal').addEventListener('click', (e) => { if (e.target.id === 'swap-modal') closeSwap(); });

  // ============ 買い出しリスト ============
  function renderShopping() {
    const empty = $('shopping-empty');
    const body = $('shopping-body');
    if (!plan) { empty.classList.remove('hidden'); body.classList.add('hidden'); return; }
    empty.classList.add('hidden'); body.classList.remove('hidden');

    // 材料を 名前+単位 で集計
    const agg = new Map();
    forEachMeal((d, slot, rid) => {
      const r = recipeById(rid);
      if (!r) return;
      for (const ing of r.ings) {
        const key = ing.name + '|' + ing.unit;
        const cur = agg.get(key) || { name: ing.name, unit: ing.unit, qty: 0, price: 0 };
        cur.qty += ing.qty; cur.price += ing.price || 0;
        agg.set(key, cur);
      }
    });

    const items = [...agg.values()].sort((a, b) => b.price - a.price);
    const listEl = $('shopping-list');
    listEl.innerHTML = '';
    let total = 0;
    items.forEach((it, idx) => {
      total += it.price;
      const key = it.name + '|' + it.unit;
      const li = document.createElement('li');
      li.className = 'shop-item' + (checks[key] ? ' done' : '');
      const qty = Number.isInteger(it.qty) ? it.qty : Math.round(it.qty * 10) / 10;
      li.innerHTML = `
        <label class="shop-check">
          <input type="checkbox" ${checks[key] ? 'checked' : ''} />
          <span class="shop-name"></span>
        </label>
        <span class="shop-qty">${qty}${it.unit}</span>
        <span class="shop-price">${yen(it.price)}</span>`;
      li.querySelector('.shop-name').textContent = it.name;
      li.querySelector('input').addEventListener('change', (e) => {
        checks[key] = e.target.checked; saveChecks();
        li.classList.toggle('done', e.target.checked);
      });
      listEl.appendChild(li);
    });
    $('shopping-total').textContent = yen(total);
  }

  $('copy-list').addEventListener('click', async () => {
    if (!plan) return;
    const agg = new Map();
    forEachMeal((d, slot, rid) => {
      const r = recipeById(rid); if (!r) return;
      for (const ing of r.ings) {
        const key = ing.name + '|' + ing.unit;
        const cur = agg.get(key) || { name: ing.name, unit: ing.unit, qty: 0, price: 0 };
        cur.qty += ing.qty; cur.price += ing.price || 0; agg.set(key, cur);
      }
    });
    let total = 0;
    const lines = [...agg.values()].sort((a, b) => b.price - a.price).map((it) => {
      total += it.price;
      const qty = Number.isInteger(it.qty) ? it.qty : Math.round(it.qty * 10) / 10;
      return `□ ${it.name} ${qty}${it.unit}（${yen(it.price)}）`;
    });
    const text = `🛒 買い出しリスト\n${lines.join('\n')}\n----\n合計 ${yen(total)}`;
    try { await navigator.clipboard.writeText(text); alert('リストをコピーしました！'); }
    catch { prompt('コピーしてね', text); }
  });
  $('uncheck-all').addEventListener('click', () => { checks = {}; saveChecks(); renderShopping(); });

  // ============ レシピ一覧 ============
  let recipeFilter = 'all';
  function renderCatFilter() {
    const box = $('cat-filter');
    box.innerHTML = '';
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.className = 'chip' + (recipeFilter === id ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => { recipeFilter = id; renderCatFilter(); renderRecipes(); });
      box.appendChild(b);
    };
    mk('all', 'すべて');
    CATEGORIES.forEach((c) => mk(c.id, `${c.emoji}${c.name}`));
  }
  function renderRecipes() {
    const grid = $('recipe-list');
    grid.innerHTML = '';
    let list = allRecipes();
    if (recipeFilter !== 'all') list = list.filter((r) => r.cat === recipeFilter);
    list.forEach((r) => {
      const cat = catById(r.cat);
      const creator = r.creatorId ? creatorById(r.creatorId) : null;
      const card = document.createElement('div');
      card.className = 'recipe-card';
      card.innerHTML = `
        <div class="rc-cat">${cat ? cat.emoji + cat.name : ''}</div>
        <div class="rc-name"></div>
        <div class="rc-meta">⏱${r.time}分 ・ ${r.servings}人分 ・ ${yen(recipeCost(r))}${r.kcal ? ' ・ ' + r.kcal + 'kcal' : ''}</div>
        <div class="rc-tags">
          ${r.nutri ? '<span class="tag nutri">🥗栄養◎</span>' : ''}
          ${r.freeze ? '<span class="tag freeze">🧊作り置き</span>' : ''}
          ${creator ? '<span class="tag">⭐' + creator.name + '</span>' : ''}
        </div>
        <details class="rc-ings"><summary>材料をみる</summary><ul></ul></details>
        ${r.id.startsWith('u-') ? '<button class="rc-del">削除</button>' : ''}`;
      card.querySelector('.rc-name').textContent = r.name;
      const ul = card.querySelector('.rc-ings ul');
      r.ings.forEach((i) => {
        const li = document.createElement('li');
        const qty = Number.isInteger(i.qty) ? i.qty : Math.round(i.qty * 10) / 10;
        li.textContent = `${i.name} ${qty}${i.unit}（${yen(i.price)}）`;
        ul.appendChild(li);
      });
      const del = card.querySelector('.rc-del');
      if (del) del.addEventListener('click', () => {
        userRecipes = userRecipes.filter((x) => x.id !== r.id);
        saveRecipes(); renderRecipes();
      });
      grid.appendChild(card);
    });
  }

  // ---- レシピ追加フォーム ----
  function fillRecipeSelects() {
    const cat = $('r-cat'); cat.innerHTML = '';
    CATEGORIES.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = `${c.emoji}${c.name}`; cat.appendChild(o); });
    const cr = $('r-creator'); cr.innerHTML = '<option value="">（なし）</option>';
    allCreators().forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; cr.appendChild(o); });
  }
  $('recipe-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const meals = [...document.querySelectorAll('.r-meal:checked')].map((c) => c.value);
    if (!meals.length) { alert('向いてる食事を1つ以上えらんでね'); return; }
    const ings = $('r-ingredients').value.split('\n').map((line) => {
      const p = line.split(',').map((s) => s.trim());
      if (!p[0]) return null;
      return { name: p[0], qty: parseFloat(p[1]) || 1, unit: p[2] || '個', price: parseFloat(p[3]) || 0 };
    }).filter(Boolean);

    const rec = {
      id: 'u-' + Date.now().toString(36),
      name: $('r-name').value.trim(),
      cat: $('r-cat').value,
      creatorId: $('r-creator').value || null,
      time: parseInt($('r-time').value, 10) || 15,
      servings: parseInt($('r-servings').value, 10) || 2,
      kcal: parseInt($('r-kcal').value, 10) || 0,
      freeze: $('r-freeze').checked,
      nutri: $('r-nutri').checked,
      meals, ings, note: '',
    };
    userRecipes.push(rec);
    saveRecipes();
    e.target.reset();
    document.querySelector('.r-meal[value="dinner"]').checked = true;
    renderRecipes();
    alert('レシピを追加しました！');
  });

  // ============ 推し（クリエイター）============
  function renderCreatorCatPicker() {
    const box = $('creator-cats');
    box.innerHTML = '';
    CATEGORIES.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (creatorFormCats.has(c.id) ? ' on' : '');
      b.textContent = `${c.emoji}${c.name}`;
      b.addEventListener('click', () => {
        if (creatorFormCats.has(c.id)) creatorFormCats.delete(c.id); else creatorFormCats.add(c.id);
        renderCreatorCatPicker();
      });
      box.appendChild(b);
    });
  }
  $('creator-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!creatorFormCats.size) { alert('担当カテゴリを1つ以上えらんでね'); return; }
    userCreators.push({
      id: 'u-c-' + Date.now().toString(36),
      name: $('c-name').value.trim(),
      platform: $('c-platform').value,
      handle: $('c-handle').value.trim(),
      categories: [...creatorFormCats],
    });
    saveCreators();
    creatorFormCats = new Set();
    e.target.reset();
    renderCreatorCatPicker();
    renderCreators();
    fillRecipeSelects();
    alert('推しを登録しました！');
  });
  function platIcon(p) { return ({ youtube: '▶️', instagram: '📷', tiktok: '🎵' })[p] || '🔗'; }
  function renderCreators() {
    const wrap = $('creator-list');
    wrap.innerHTML = '';
    allCreators().forEach((c) => {
      const isSeed = c.id.startsWith('c-seed');
      const el = document.createElement('div');
      el.className = 'creator-card';
      const cats = c.categories.map((id) => { const x = catById(id); return x ? x.emoji + x.name : id; }).join(' ');
      el.innerHTML = `
        <div class="cc-top">
          <span class="cc-plat">${platIcon(c.platform)}</span>
          <span class="cc-name"></span>
          ${isSeed ? '<span class="cc-seed">サンプル</span>' : '<button class="cc-del">削除</button>'}
        </div>
        <div class="cc-handle"></div>
        <div class="cc-cats">${cats}</div>`;
      el.querySelector('.cc-name').textContent = c.name;
      el.querySelector('.cc-handle').textContent = c.handle || '';
      const del = el.querySelector('.cc-del');
      if (del) del.addEventListener('click', () => {
        userCreators = userCreators.filter((x) => x.id !== c.id);
        saveCreators(); renderCreators(); fillRecipeSelects();
      });
      wrap.appendChild(el);
    });
  }

  // ============ ボタン ============
  $('recommend').addEventListener('click', buildPlan);
  $('clear-plan').addEventListener('click', () => {
    plan = null; savePlan(); checks = {}; saveChecks();
    $('plan-budget-note').textContent = '';
    renderPlan();
  });
  $('goto-shopping').addEventListener('click', () => showTab('shopping'));

  // ============ 初期化 ============
  (function initWeekStart() {
    const m = mondayOf();
    $('week-start').value = m.toISOString().slice(0, 10);
  })();
  renderCatFilter();
  renderRecipes();
  renderCreatorCatPicker();
  renderCreators();
  fillRecipeSelects();
  renderPlan();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
})();
