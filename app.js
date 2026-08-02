/* ときめき片づけ — こんまり式 断捨離アプリ
 * 服 → 本 → 書類 → 小物 → 思い出 の正しい順番で、ときめきチェック。
 * すべてブラウザ内で完結（サーバー不要）。データは localStorage に保存。
 */
(() => {
  'use strict';

  const STORE_KEY = 'konmari.tokimeki.v1';

  // ---- カテゴリー定義（こんまり式の順番） ----
  const CATEGORIES = [
    {
      key: 'clothes', emoji: '👕', title: '服',
      desc: '最初はいちばん決めやすい「服」から。家じゅうの服を、一か所に集めよう。',
      hints: ['トップス（シャツ・ニットなど）', 'ボトムス（パンツ・スカート）', 'かける服（コート・ジャケット）', '靴下・ストッキング', '下着', 'バッグ', '小物（マフラー・ベルト・帽子）', '靴'],
    },
    {
      key: 'books', emoji: '📚', title: '本',
      desc: '本棚の本を、読みかけも未読も、全部いちど床に出そう。「いつか読む」の いつか はほぼ来ない。',
      hints: ['一般（ふつうの本）', '実用書（参考書・レシピ本）', '観賞用（写真集など）', '雑誌'],
    },
    {
      key: 'papers', emoji: '📄', title: '書類',
      desc: '書類は「全部捨てる」が基本。残すのは “いま使う / しばらく必要 / ずっと必要” の3種だけ。',
      hints: ['いま使っている書類', 'しばらく取っておくもの（保証書・契約書）', 'ずっと必要なもの（保険証券など）', 'ダイレクトメール・とっくに済んだ明細 → 手放す候補'],
    },
    {
      key: 'komono', emoji: '🧴', title: '小物',
      desc: '「なんとなく持っているもの」の宝庫。種類ごとに、少しずつ確実に。',
      hints: ['CD・DVD', 'スキンケア・コスメ', 'アクセサリー', '貴重品（通帳・カード類）', '電子機器・ケーブル', '生活用品（文房具・薬・裁縫）', 'キッチン用品・食品', 'その他（趣味のものなど）'],
    },
    {
      key: 'sentimental', emoji: '💌', title: '思い出',
      desc: '最後の関門。写真・手紙・思い出の品。ここまで来たあなたなら、ときめきで選べるはず。',
      hints: ['写真', '手紙・カード', '日記・アルバム', '記念品・プレゼント'],
    },
  ];

  // ============ 状態 ============
  let state = load();

  // ============ DOM ============
  const $ = (id) => document.getElementById(id);

  // ============ 保存・読み込み ============
  function freshState() {
    return {
      currentIndex: 0,
      cats: CATEGORIES.map((c) => ({ key: c.key, gathered: false, done: false, items: [] })),
      startedAt: Date.now(),
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return freshState();
      const s = JSON.parse(raw);
      // カテゴリー構成が変わっていたら作り直す（前方互換の最低限）
      if (!s.cats || s.cats.length !== CATEGORIES.length) return freshState();
      return s;
    } catch { return freshState(); }
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  // ============ ヘルパー ============
  const meta = (i) => CATEGORIES[i];
  const cat = (i) => state.cats[i];
  function keepCount(c) { return c.items.filter((x) => x.keep).length; }
  function letCount(c) { return c.items.filter((x) => !x.keep).length; }
  function isUnlocked(i) {
    // 0番目は常に解放。以降は前が done なら解放。
    if (i === 0) return true;
    return state.cats[i - 1].done;
  }

  // ============ ホーム描画 ============
  function renderHome() {
    // 全体進捗（完了カテゴリー数ベース）
    const doneN = state.cats.filter((c) => c.done).length;
    const pct = Math.round((doneN / CATEGORIES.length) * 100);
    $('overall-percent').textContent = pct + '%';
    $('overall-bar').style.width = pct + '%';

    const allDone = doneN === CATEGORIES.length;
    if (allDone) {
      $('overall-sub').textContent = '🎊 全カテゴリー完了！ ときめくものだけに囲まれた暮らしへ。';
    } else {
      const cur = meta(state.currentIndex);
      $('overall-sub').textContent = `いまは「${cur.title}」の番。一つずつ、ときめきで選ぼう。`;
    }

    // 旅リスト
    const ol = $('journey');
    ol.innerHTML = '';
    CATEGORIES.forEach((c, i) => {
      const st = state.cats[i];
      const unlocked = isUnlocked(i);
      const li = document.createElement('li');
      li.className = 'journey-item'
        + (st.done ? ' is-done' : '')
        + (!unlocked ? ' is-locked' : '')
        + (i === state.currentIndex && !st.done && unlocked ? ' is-current' : '');

      const status = st.done
        ? `残${keepCount(st)}・手放${letCount(st)}`
        : (unlocked ? 'いまここ' : 'ロック中');
      const badge = st.done ? '✓' : (unlocked ? '' : '🔒');

      li.innerHTML = `
        <div class="j-num">${i + 1}</div>
        <div class="j-emoji">${c.emoji}</div>
        <div class="j-body">
          <div class="j-title"></div>
          <div class="j-status"></div>
        </div>
        <div class="j-badge">${badge}</div>`;
      li.querySelector('.j-title').textContent = c.title;
      li.querySelector('.j-status').textContent = status;

      if (unlocked) {
        li.addEventListener('click', () => openCategory(i));
      } else {
        li.addEventListener('click', () => {
          const prev = meta(i - 1);
          flash(`さきに「${prev.title}」を終わらせよう。順番が大切だよ。`);
        });
      }
      ol.appendChild(li);
    });
  }

  // 軽いトースト
  let flashTimer = null;
  function flash(msg) {
    let el = $('flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'flash';
      el.className = 'flash';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ============ カテゴリー画面 ============
  let openIndex = 0;

  function openCategory(i) {
    openIndex = i;
    state.currentIndex = Math.max(state.currentIndex, i); // 一応追従
    const c = meta(i);
    const st = cat(i);

    $('cat-emoji').textContent = c.emoji;
    $('cat-title').textContent = c.title;
    $('cat-desc').textContent = c.desc;

    const hints = $('gather-hints');
    hints.innerHTML = '';
    c.hints.forEach((h) => {
      const li = document.createElement('li');
      li.textContent = h;
      hints.appendChild(li);
    });

    $('gathered').checked = st.gathered;
    $('check-step').classList.toggle('hidden', !st.gathered);
    $('gather-step').classList.toggle('is-collapsed', st.gathered);

    $('item-name').value = '';
    renderItems();

    show('category');
    window.scrollTo(0, 0);
  }

  function renderItems() {
    const st = cat(openIndex);
    const keeps = st.items.filter((x) => x.keep);
    const lets = st.items.filter((x) => !x.keep);

    $('keep-count').textContent = keeps.length;
    $('let-count').textContent = lets.length;

    fillList('keep-list', 'keep-empty', keeps);
    fillList('let-list', 'let-empty', lets);
  }

  function fillList(listId, emptyId, arr) {
    const ul = $(listId);
    ul.innerHTML = '';
    $(emptyId).style.display = arr.length ? 'none' : 'block';
    arr.forEach((it) => {
      const li = document.createElement('li');
      li.className = 'item-row';
      li.innerHTML = `<span class="item-name"></span><button class="item-del" aria-label="取り消す">×</button>`;
      li.querySelector('.item-name').textContent = it.name;
      li.querySelector('.item-del').addEventListener('click', () => {
        const st = cat(openIndex);
        st.items = st.items.filter((x) => x.id !== it.id);
        save();
        renderItems();
      });
      ul.appendChild(li);
    });
  }

  function addItem(keep) {
    const input = $('item-name');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const st = cat(openIndex);
    st.items.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), name, keep });
    save();
    input.value = '';
    input.focus();
    renderItems();
    if (!keep) flash(`「${name}」、ありがとう。いってらっしゃい 👋`);
  }

  // ============ イベント ============
  $('back-home').addEventListener('click', () => { renderHome(); show('home'); });

  $('gathered').addEventListener('change', (e) => {
    const st = cat(openIndex);
    st.gathered = e.target.checked;
    save();
    $('check-step').classList.toggle('hidden', !st.gathered);
    $('gather-step').classList.toggle('is-collapsed', st.gathered);
    if (st.gathered) {
      $('check-step').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('item-name').focus();
    }
  });

  $('item-form').addEventListener('submit', (e) => { e.preventDefault(); addItem(true); });
  $('btn-keep').addEventListener('click', () => addItem(true));
  $('btn-let').addEventListener('click', () => addItem(false));

  $('finish-cat').addEventListener('click', () => {
    const st = cat(openIndex);
    if (!st.gathered) { flash('まず「全部あつめた」にチェックしてね。'); return; }
    st.done = true;
    // 次のカテゴリーへ currentIndex を進める
    if (openIndex + 1 < CATEGORIES.length) {
      state.currentIndex = openIndex + 1;
    }
    save();
    celebrate(openIndex);
  });

  // ============ お祝い ============
  function celebrate(i) {
    const st = cat(i);
    const c = meta(i);
    const allDone = state.cats.every((x) => x.done);

    $('celebrate-emoji').textContent = allDone ? '🎊' : c.emoji;
    if (allDone) {
      $('celebrate-title').textContent = 'すべて完了！おめでとう 🎉';
      $('celebrate-text').textContent = `ときめくものだけに囲まれた暮らしのはじまり。合計 ${totalKeep()} コを残し、${totalLet()} コを手放しました。`;
      $('celebrate-next').textContent = 'ホームに戻る';
    } else {
      const next = meta(i + 1);
      $('celebrate-title').textContent = `「${c.title}」おつかれさま！`;
      $('celebrate-text').textContent = `残した ${keepCount(st)} コ・手放した ${letCount(st)} コ。つぎは「${next.title}」${next.emoji} に進もう。`;
      $('celebrate-next').textContent = `「${next.title}」へ進む ›`;
    }

    makeConfetti();
    $('celebrate').classList.remove('hidden');

    $('celebrate-next').onclick = () => {
      $('celebrate').classList.add('hidden');
      if (allDone || i + 1 >= CATEGORIES.length) {
        renderHome();
        show('home');
      } else {
        openCategory(i + 1);
      }
    };
  }

  function totalKeep() { return state.cats.reduce((n, c) => n + keepCount(c), 0); }
  function totalLet() { return state.cats.reduce((n, c) => n + letCount(c), 0); }

  function makeConfetti() {
    const box = $('confetti');
    box.innerHTML = '';
    const colors = ['#e8a0bf', '#a3c9a8', '#f6d186', '#89c2d9', '#f0a8a8'];
    for (let n = 0; n < 40; n++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[n % colors.length];
      p.style.animationDelay = (Math.random() * 0.6) + 's';
      p.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      box.appendChild(p);
    }
  }

  // ============ 画面切替 ============
  function show(id) {
    ['home', 'category'].forEach((s) => {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  // ============ リセット ============
  $('reset-all').addEventListener('click', () => {
    if (!confirm('片づけの記録を消して、最初からやり直しますか？')) return;
    state = freshState();
    save();
    renderHome();
    show('home');
  });

  // ============ 初期化 ============
  // Service Worker（オフライン対応）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  renderHome();
  show('home');
})();
