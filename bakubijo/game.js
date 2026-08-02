/* =========================================================
   目指せ！爆美女！  — 30日間 自分みがき育成ゲーム
   ※ 登場キャラはすべて架空のオリジナルです
   ========================================================= */
'use strict';

const MAX_DAY = 30;
const AP_PER_DAY = 3;
const SAVE_KEY = 'bakubijo_save_v1';
const $ = (id) => document.getElementById(id);
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- ステータス定義 ---------- */
const STATS = [
  { key: 'bihada',  name: '美肌',       color: '#ff8fb1' },
  { key: 'style',   name: 'スタイル',   color: '#8fd3ff' },
  { key: 'fashion', name: 'ファッション', color: '#c79cff' },
  { key: 'chisei',  name: '知性',       color: '#8fe0c0' },
  { key: 'mental',  name: 'メンタル',   color: '#ffd27f' },
];

/* =========================================================
   アバター（SVGで描くオリジナルの女の子）
   ========================================================= */
function shade(hex, amt = -26) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function eyeSVG(cx, cy, color) {
  return `
    <ellipse cx="${cx}" cy="${cy}" rx="10" ry="13" fill="#fff"/>
    <circle cx="${cx}" cy="${cy + 1}" r="9" fill="${color}"/>
    <circle cx="${cx}" cy="${cy + 2}" r="5" fill="#2a1f28"/>
    <circle cx="${cx - 3}" cy="${cy - 4}" r="3" fill="#fff"/>
    <path d="M ${cx - 12} ${cy - 10} Q ${cx} ${cy - 18} ${cx + 12} ${cy - 10}"
          stroke="#3a2a34" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
}

function sideHair(kind, shd) {
  switch (kind) {
    case 'twin':
      return `<circle cx="38" cy="152" r="27" fill="${shd}"/><circle cx="162" cy="152" r="27" fill="${shd}"/>
              <rect x="52" y="112" width="18" height="48" rx="9" fill="${shd}"/><rect x="130" y="112" width="18" height="48" rx="9" fill="${shd}"/>`;
    case 'long':
      return `<rect x="30" y="102" width="28" height="86" rx="14" fill="${shd}"/><rect x="142" y="102" width="28" height="86" rx="14" fill="${shd}"/>`;
    case 'wave':
      return `<circle cx="40" cy="138" r="21" fill="${shd}"/><circle cx="52" cy="166" r="17" fill="${shd}"/>
              <circle cx="160" cy="138" r="21" fill="${shd}"/><circle cx="148" cy="166" r="17" fill="${shd}"/>`;
    default: /* med */
      return `<ellipse cx="48" cy="126" rx="15" ry="36" fill="${shd}"/><ellipse cx="152" cy="126" rx="15" ry="36" fill="${shd}"/>`;
  }
}

const ACC = {
  none: '',
  star: `<path d="M150 40 l5 11 12 1 -9 8 3 12 -11 -6 -11 6 3 -12 -9 -8 12 -1 z" fill="#ffd54a" stroke="#ff9d00" stroke-width="1.5"/>`,
  heart: `<path d="M54 58 c-7 -9 -20 -3 -15 8 c3 7 15 13 15 13 c0 0 12 -6 15 -13 c5 -11 -8 -17 -15 -8 z" fill="#ff6fa3"/>`,
  bow: `<path d="M86 46 l14 10 14 -10 v20 l-14 -8 -14 8 z" fill="#ff6fa3"/><circle cx="100" cy="56" r="5" fill="#ff3d84"/>`,
  crown: `<path d="M74 44 l8 14 18 -18 18 18 8 -14 v20 h-52 z" fill="#ffd54a" stroke="#ff9d00" stroke-width="1.5"/>
          <circle cx="82" cy="44" r="3" fill="#ff5aa0"/><circle cx="100" cy="40" r="3" fill="#ff5aa0"/><circle cx="118" cy="44" r="3" fill="#ff5aa0"/>`,
};

function avatarSVG(o) {
  const skin = o.skin || '#ffe1d2';
  const hair = o.hair || '#6f5140';
  const shd = o.hairShade || shade(hair);
  const eye = o.eye || '#4a3a44';
  const blush = o.blush || '#ffb1c8';
  const acc = ACC[o.acc || 'none'] || '';
  const bg = o.bg ? `<circle cx="100" cy="100" r="99" fill="${o.bg}"/>` : '';
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    ${bg}
    ${sideHair(o.side || 'med', shd)}
    <ellipse cx="100" cy="120" rx="66" ry="72" fill="${shd}"/>
    <ellipse cx="100" cy="106" rx="52" ry="56" fill="${skin}"/>
    <ellipse cx="70" cy="118" rx="8" ry="7" fill="${blush}" opacity=".7"/>
    <ellipse cx="130" cy="118" rx="8" ry="7" fill="${blush}" opacity=".7"/>
    ${eyeSVG(78, 112, eye)}
    ${eyeSVG(122, 112, eye)}
    <path d="M94 126 Q100 132 106 126" stroke="#c86a86" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M44 98 C44 54 72 40 100 40 C128 40 156 54 156 98
             C150 78 138 72 122 72 C118 88 108 86 100 72
             C92 86 82 88 78 72 C62 72 50 78 44 98 Z" fill="${hair}"/>
    ${acc}
  </svg>`;
}

/* ---------- キャラクター ---------- */
function charFace(key, playerAcc) {
  switch (key) {
    case 'you':
      return avatarSVG({ hair: '#7a5642', eye: '#5a3f36', side: 'med', bg: '#fff2f8', acc: playerAcc || 'none' });
    case 'mina':  // トップアイドル
      return avatarSVG({ hair: '#ff9fce', hairShade: '#f57bb4', eye: '#d64f96', blush: '#ff9dbf', side: 'twin', bg: '#fff0f7', acc: 'star' });
    case 'coco':  // 美容インフルエンサー
      return avatarSVG({ hair: '#e0a75f', hairShade: '#c98a3e', eye: '#a6743c', blush: '#ffb0a0', side: 'wave', bg: '#fff6ec', acc: 'heart' });
    case 'reina': // クールなライバル読者モデル
      return avatarSVG({ hair: '#3d3448', hairShade: '#2b2434', eye: '#8a63c8', blush: '#e79bb0', side: 'long', bg: '#efeaff', acc: 'none' });
    default:
      return avatarSVG({});
  }
}
const CHAR_NAME = { you: 'あなた', mina: 'MINA', coco: 'ここ', reina: 'レイナ', narr: '' };

/* ---------- 目標（なりたい爆美女タイプ） ---------- */
const GOALS = {
  sexy: {
    emoji: '💋', name: '大人セクシー系', focus: ['bihada', 'style', 'mental'],
    desc: 'ミステリアスな色っぽさで、思わず目が離せなくなる大人の女性。',
    end: '匂い立つような色気に、会場中がため息をもらした。',
  },
  natural: {
    emoji: '🌿', name: 'ナチュラル自然体系', focus: ['style', 'chisei', 'mental'],
    desc: '飾らないのに惹かれる。ボーイッシュさと女性らしさが同居する自然体。',
    end: 'ボーイッシュさと女性らしさが溶け合った、あなただけの自然体が眩しかった。',
  },
  gorgeous: {
    emoji: '👑', name: '華やかアイドル系', focus: ['fashion', 'bihada', 'mental'],
    desc: 'キラキラ王道。ステージの真ん中がいちばん似合う華やかさ。',
    end: 'スポットライトを味方につけた王道の華やかさに、大歓声が上がった。',
  },
  cool: {
    emoji: '🖤', name: '知的クール系', focus: ['chisei', 'fashion', 'mental'],
    desc: '凛としてかっこいい。知性とセンスでクールに魅せる。',
    end: '凛とした知的な佇まいに、誰もが息をのんで見入っていた。',
  },
};

/* =========================================================
   ゲーム状態
   ========================================================= */
function defaultState() {
  return {
    name: 'ミライ',
    goal: 'sexy',
    day: 1,
    ap: AP_PER_DAY,
    money: 3000,
    followers: 120,
    stats: { bihada: 18, style: 18, fashion: 16, chisei: 18, mental: 24 },
    log: [],
    done: {},   // 発生済みイベントフラグ
  };
}
let S = defaultState();

function charm() {
  const v = STATS.reduce((s, st) => s + S.stats[st.key], 0) / STATS.length;
  return Math.round(v);
}
function goalScore() {
  const g = GOALS[S.goal] || GOALS.sexy;
  return Math.round(g.focus.reduce((s, k) => s + S.stats[k], 0) / g.focus.length);
}
function rankInfo(c = charm()) {
  if (c >= 90) return { t: '👑 爆美女（伝説級）', acc: 'crown' };
  if (c >= 78) return { t: '💎 正真正銘の美女', acc: 'star' };
  if (c >= 64) return { t: '🌸 かわいい系美女', acc: 'bow' };
  if (c >= 48) return { t: '🌱 みがけば光る原石', acc: 'heart' };
  if (c >= 30) return { t: '🐣 これからのあなた', acc: 'none' };
  return { t: '🌰 スタート地点', acc: 'none' };
}

function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function load() { try { S = JSON.parse(localStorage.getItem(SAVE_KEY)) || defaultState(); } catch (e) { S = defaultState(); } }
function wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

/* ---------- ログ ---------- */
function logMsg(text, tone = '') {
  S.log.unshift({ text, tone });
  if (S.log.length > 30) S.log.pop();
}

/* ---------- 効果を反映 ---------- */
function grant(effect, msg, tone) {
  if (effect.stats) for (const k in effect.stats) S.stats[k] = clamp(S.stats[k] + effect.stats[k], 0, 100);
  if (effect.money) S.money = Math.max(0, S.money + effect.money);
  if (effect.followers) S.followers = Math.max(0, S.followers + effect.followers);
  if (msg) logMsg(msg, tone || 'good');
}

/* =========================================================
   行動（アクション）
   ========================================================= */
const ACTIONS = [
  { id: 'skincare', name: 'スキンケア', emoji: '🧴', tag: '美肌↑', ap: 1, cost: 0,
    run: () => ({ stats: { bihada: rnd(4, 7), mental: 1 }, msg: 'ていねいにスキンケア。お肌つるつる✨' }) },
  { id: 'gym', name: '運動・ジム', emoji: '🏃‍♀️', tag: 'スタイル↑', ap: 1, cost: 0,
    run: () => ({ stats: { style: rnd(4, 7), mental: 1 }, msg: '汗を流してスッキリ！引き締まってきた💪' }) },
  { id: 'fashion', name: 'ファッション研究', emoji: '👗', tag: 'ファッション↑', ap: 1, cost: 300,
    run: () => ({ stats: { fashion: rnd(4, 7) }, money: -300, msg: '雑誌とショップでトレンドを研究👗' }) },
  { id: 'study', name: '勉強・読書', emoji: '📚', tag: '知性↑', ap: 1, cost: 0,
    run: () => ({ stats: { chisei: rnd(4, 7) }, msg: '本を読んで内面みがき📚 教養は裏切らない' }) },
  { id: 'care', name: 'セルフケア', emoji: '🧘‍♀️', tag: 'メンタル↑', ap: 1, cost: 0,
    run: () => ({ stats: { mental: rnd(5, 8) }, msg: '深呼吸して心を整えた。わたし、えらい🧘‍♀️' }) },
  { id: 'este', name: 'エステ', emoji: '💆‍♀️', tag: '美肌↑↑', ap: 2, cost: 1500,
    run: () => ({ stats: { bihada: rnd(9, 14), mental: 2 }, money: -1500, msg: '奮発してエステへ！別人級のうるおい💎' }) },
  { id: 'baito', name: 'バイト', emoji: '💰', tag: 'コイン↑', ap: 2, cost: 0,
    run: () => { const m = rnd(1800, 2600); return { money: m, stats: { mental: -rnd(1, 3) }, msg: `バイトで ${m}コイン ゲット！ちょっと疲れた…`, tone: '' }; } },
  { id: 'sns', name: 'SNS投稿', emoji: '📸', tag: 'フォロワー↑', ap: 1, cost: 0,
    run: () => {
      const c = charm();
      const gain = Math.round(c * rnd(3, 7)) + rnd(20, 90);
      const good = Math.random() < clamp(c / 100 + 0.35, 0, 0.95);
      if (good) return { followers: gain, stats: { mental: 2, fashion: 1 }, msg: `映える投稿がバズった📸 +${gain}フォロワー！` };
      return { followers: Math.round(gain * 0.4), stats: { mental: -2 }, msg: 'うーん、反応いまいち…でも気にしない！', tone: 'bad' };
    } },
];

/* =========================================================
   画面制御
   ========================================================= */
function show(screen) {
  ['title', 'intro', 'goal', 'game'].forEach((s) => { $(s).hidden = s !== screen; });
}

function render() {
  const c = charm();
  const rk = rankInfo(c);
  $('hudDay').textContent = S.day;
  $('hudMoney').textContent = S.money.toLocaleString();
  $('hudFollowers').textContent = S.followers.toLocaleString();
  $('playerName').textContent = S.name;
  const g = GOALS[S.goal] || GOALS.sexy;
  $('goalChip').textContent = `🎯 目指せ！${g.emoji}${g.name}`;
  $('rankTitle').textContent = rk.t;
  $('playerAvatar').innerHTML = charFace('you', rk.acc);
  $('charmFill').style.width = c + '%';
  $('charmVal').textContent = c;

  // ステータス
  $('stats').innerHTML = STATS.map((st) => {
    const v = S.stats[st.key];
    return `<div class="stat" data-k="${st.key}">
      <div class="stat-top"><span class="stat-name">${st.name}</span><span class="stat-num">${v}</span></div>
      <div class="stat-bar"><i style="width:${v}%;background:${st.color}"></i></div>
    </div>`;
  }).join('');

  // 行動力ドット
  $('apDots').innerHTML = Array.from({ length: AP_PER_DAY }, (_, i) =>
    `<span class="ap-dot ${i < S.ap ? 'on' : ''}"></span>`).join('');

  // 行動カード
  $('actions').innerHTML = ACTIONS.map((a) => {
    const disabled = a.ap > S.ap || (a.cost > S.money);
    return `<div class="action ${disabled ? 'disabled' : ''}" data-id="${a.id}">
      <span class="action-cost">${'●'.repeat(a.ap)}${a.cost ? ' 💰' + a.cost : ''}</span>
      <div class="action-emoji">${a.emoji}</div>
      <div class="action-name">${a.name}</div>
      <div class="action-tag">${a.tag}</div>
    </div>`;
  }).join('');

  // ログ
  $('log').innerHTML = S.log.length
    ? S.log.map((l) => `<div class="log-item ${l.tone}">${l.text}</div>`).join('')
    : '<div class="log-item">今日は何をする？</div>';
}

function bump(key) {
  const el = document.querySelector(`.stat[data-k="${key}"]`);
  if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
}

/* =========================================================
   行動の確認 → 実行
   ========================================================= */
let pendingAction = null;
function askAction(a) {
  pendingAction = a;
  $('confirmEmoji').textContent = a.emoji;
  $('confirmName').textContent = a.name;
  $('confirmDesc').textContent = a.tag + ' の効果があるよ';
  $('confirmCost').textContent = `行動力 ${a.ap}${a.cost ? `　・　💰${a.cost}コイン` : ''}`;
  $('confirm').hidden = false;
}
function doAction() {
  $('confirm').hidden = true;
  const a = pendingAction; pendingAction = null;
  if (!a) return;
  S.ap -= a.ap;
  const eff = a.run();
  grant(eff, eff.msg, eff.tone);
  save();
  render();
  if (eff.stats) Object.keys(eff.stats).forEach(bump);
}

/* =========================================================
   1日の終わり / 次の日
   ========================================================= */
function endDay() {
  // フォロワーの自然増加（魅力が高いほど伸びる）
  const passive = Math.round(charm() * rnd(1, 3)) + rnd(5, 25);
  S.followers += passive;
  logMsg(`💤 おやすみ…（フォロワー +${passive}）`, '');

  if (S.day >= MAX_DAY) { save(); runEnding(); return; }
  S.day += 1;
  S.ap = AP_PER_DAY;
  save();
  beginDay();
}

function beginDay() {
  render();
  const ev = scheduledEvent(S.day);
  if (ev) { runDialogue(ev, () => { render(); save(); }); return; }
  // ストーリーが無い日は、たまにミニイベント
  if (Math.random() < 0.5) {
    const mini = pickRandomEvent();
    if (mini) { runDialogue(mini, () => { render(); save(); }); }
  }
}

/* =========================================================
   会話（ダイアログ）エンジン
   steps: [{who, text, choices?}]
   choices: [{label, apply()->省略可の結果テキスト}]
   ========================================================= */
function runDialogue(steps, onDone) {
  const ov = $('dialogue');
  const box = $('dlgBox');
  let i = 0;

  function showStep() {
    if (i >= steps.length) { ov.hidden = true; if (onDone) onDone(); return; }
    const s = steps[i];
    const who = s.who || 'narr';
    if (who === 'narr') {
      $('dlgAvatar').innerHTML = '';
      $('dlgName').textContent = '';
    } else {
      $('dlgAvatar').innerHTML = charFace(who);
      $('dlgName').textContent = CHAR_NAME[who] === 'あなた' ? S.name : CHAR_NAME[who];
    }
    $('dlgText').textContent = s.text.replace(/\{name\}/g, S.name);

    const cbox = $('dlgChoices');
    if (s.choices) {
      $('dlgTap').style.visibility = 'hidden';
      cbox.innerHTML = '';
      s.choices.forEach((ch) => {
        const b = document.createElement('button');
        b.className = 'dlg-choice';
        b.textContent = ch.label;
        b.onclick = (e) => {
          e.stopPropagation();
          const res = ch.apply ? ch.apply() : null;
          cbox.innerHTML = '';
          box.style.pointerEvents = 'auto';
          i += 1;
          if (res) steps.splice(i, 0, { who: s.who, text: res });
          showStep();
        };
        cbox.appendChild(b);
      });
    } else {
      cbox.innerHTML = '';
      $('dlgTap').style.visibility = 'visible';
      box.style.pointerEvents = 'auto';
    }
  }

  box.onclick = () => {
    const s = steps[i];
    if (s && s.choices) return;
    i += 1;
    showStep();
  };

  ov.hidden = false;
  showStep();
}

/* =========================================================
   ストーリーイベント（日付固定）
   ========================================================= */
function scheduledEvent(day) {
  if (day === 1 && !S.done.d1) { S.done.d1 = true; return [
    { who: 'narr', text: '「かわいくなりたい」——ずっと思ってた。でも、何から始めればいいのか分からなくて。' },
    { who: 'narr', text: 'そんな眠れない夜、SNSでキラキラ輝くその人を見つけた。' },
    { who: 'mina', text: 'はじめまして！トップアイドルのMINAだよ⭐ 見つけてくれてありがとう♪' },
    { who: 'mina', text: 'ねえ、キミにも“なりたい自分”ってある？ …あるなら、今日がその一歩目だよ。' },
    { who: 'you', text: '…うん。わたし、30日で——爆美女になる！' },
    { who: 'narr', text: 'こうして、{name}の30日間の自分みがきが始まった。がんばれ、{name}！' },
  ]; }

  if (day === 5 && !S.done.d5) { S.done.d5 = true; return [
    { who: 'coco', text: 'やっほー！美容インフルエンサーの“ここ”だよ〜🌷 最近すごく頑張ってるらしいね？' },
    { who: 'coco', text: 'いいこと教えてあげる。“続けること”が一番のコスメなの。今日から一緒にがんばろ？',
      choices: [
        { label: '💗 よろしくお願いします！', apply: () => { grant({ stats: { bihada: 6, mental: 3 } }, 'ここ先生に美容の基本を教わった！'); return 'その調子！{name}なら絶対キレイになれるよ〜✨'; } },
        { label: '🌱 一人でもがんばれる…かな', apply: () => { grant({ stats: { mental: 5 } }, '自分を信じてみることにした。'); return 'えらい！その芯の強さ、すっごく素敵だと思う。'; } },
      ] },
  ]; }

  if (day === 10 && !S.done.d10) { S.done.d10 = true; return [
    { who: 'reina', text: 'ふーん。あなたが最近フォロワー伸ばしてる子？ わたしは読者モデルのレイナ。' },
    { who: 'reina', text: '先に言っておくけど。わたし、負けるのは大っ嫌いなの。……せいぜい、追いついてきなさい。',
      choices: [
        { label: '🔥 絶対に追いついてみせる！', apply: () => { grant({ stats: { style: 5, fashion: 3, mental: 4 } }, '負けん気に火がついた！'); return '……いい目してるじゃない。ちょっとだけ、認めてあげる。'; } },
        { label: '👀 すごい人だな…', apply: () => { grant({ stats: { fashion: 6 } }, 'レイナの着こなしを研究した。'); return '見て学ぶのも悪くない。でも、いつまでも見てる側じゃダメよ？'; } },
      ] },
  ]; }

  if (day === 15 && !S.done.d15) { S.done.d15 = true;
    if (charm() >= 50) return [
      { who: 'mina', text: '中間チェックだよ〜！ わ、キミ、この短期間ですっごく垢抜けたね！?' },
      { who: 'mina', text: 'この調子ならステージ本番、きっと輝けるよ。ごほうびのシェア、いっちゃう♪',
        choices: [{ label: '✨ ありがとう、がんばる！', apply: () => { grant({ followers: 900, stats: { mental: 4 } }, 'MINAが紹介してくれてフォロワー急増📈'); return 'ふふ、キミの成長、わたしが一番のファンだからね！'; } }] },
    ];
    return [
      { who: 'mina', text: '中間チェックだよ〜！ …うんうん、いい感じに変わってきてる。' },
      { who: 'mina', text: '焦らなくて大丈夫。“なりたい”って気持ちがある限り、まだまだ伸びるから！',
        choices: [{ label: '💪 まだまだこれから！', apply: () => { grant({ stats: { mental: 6, style: 2 } }, 'MINAの言葉で前向きになれた。'); return 'その意気！残り半分、一緒に駆け抜けよ♪'; } }] },
    ];
  }

  if (day === 20 && !S.done.d20) { S.done.d20 = true; return [
    { who: 'narr', text: '鏡を見て、ふと不安になる夜。「わたし、本当に変われてるのかな…？」' },
    { who: 'coco', text: '落ち込むのも、頑張ってる証拠だよ。完璧じゃなくたっていいの。',
      choices: [
        { label: '😌 少し休む', apply: () => { grant({ stats: { mental: 8 } }, 'しっかり休んで、心が軽くなった。'); return 'うんうん、休むのも自分みがきのうち。えらい！'; } },
        { label: '🔥 弱音は吐かず進む', apply: () => { grant({ stats: { style: 4, chisei: 4, mental: 2 } }, '歯を食いしばって前に進んだ。'); return 'そのガッツ、眩しいくらい。無理はしすぎないでね？'; } },
      ] },
  ]; }

  if (day === 25 && !S.done.d25) { S.done.d25 = true;
    const strong = charm() >= 60;
    return [
      { who: 'reina', text: strong ? '……ちょっと見ない間に、ずいぶん変わったね。悔しいけど、認めるわ。'
                                   : '本番が近いわね。……あなた、まだ伸びるでしょ。逃げないでよ。' },
      { who: 'reina', text: '本番のステージ、全力で来なさい。あなたと競えるの、ちょっとだけ楽しみにしてるんだから。',
        choices: [{ label: '🤝 望むところ！', apply: () => { grant({ stats: { mental: 5, fashion: 4 } }, 'レイナとの約束が力になった。'); return 'ふっ……言ったわね。当日、泣かせてあげる。'; } }] },
    ];
  }

  return null;
}

/* ---------- ミニランダムイベント ---------- */
const MINI = [
  () => [{ who: 'narr', text: '歩いていたら「モデルに興味ない？」とスカウトされた！',
    choices: [{ label: 'やった！', apply: () => { grant({ stats: { mental: 3 }, followers: 60 }, '街でスカウトされた！自信がついた✨'); } }] }],
  () => [{ who: 'narr', text: 'SNSに優しいコメントが届いた✉️「あなたを見て、私もがんばれる」',
    choices: [{ label: 'うれしい…！', apply: () => { grant({ stats: { mental: 5 }, followers: 40 }, 'ファンの言葉に胸が熱くなった。'); } }] }],
  () => [{ who: 'narr', text: 'お気に入りショップがセール中！ 買っちゃう？',
    choices: [
      { label: '👗 買う（-800）', apply: () => { if (S.money >= 800) { grant({ stats: { fashion: 7 }, money: -800 }, 'セールでおしゃれ度アップ👗'); } else { logMsg('コインが足りず、断念…', 'bad'); } } },
      { label: 'がまん', apply: () => { grant({ stats: { mental: 2 } }, 'ぐっと我慢。えらい！'); } },
    ] }],
  () => [{ who: 'narr', text: '寝不足でお肌が荒れちゃった…😢' , choices: [{ label: 'ケアしなきゃ', apply: () => { grant({ stats: { bihada: -4 } }, '肌荒れでちょっとダメージ…', 'bad'); } }] }],
  () => [{ who: 'narr', text: 'ジムで励まし合える友達ができた！', choices: [{ label: 'なかま！', apply: () => { grant({ stats: { style: 3, mental: 3 } }, 'ジム友ができてモチベUP💪'); } }] }],
  () => [{ who: 'narr', text: '雨で予定が崩れた…けど、おかげで読書がはかどった📚', choices: [{ label: 'ラッキー', apply: () => { grant({ stats: { chisei: 4 } }, '雨の日は知性みがき📚'); } }] }],
  () => [{ who: 'narr', text: '話題のカフェで気分転換🍰 心がほぐれた。', choices: [{ label: 'しあわせ', apply: () => { grant({ stats: { mental: 4 } }, 'カフェでリフレッシュ🍰'); } }] }],
];
function pickRandomEvent() { return MINI[rnd(0, MINI.length - 1)](); }

/* =========================================================
   エンディング
   ========================================================= */
function runEnding() {
  const finale = [
    { who: 'narr', text: 'ついに迎えた、30日目の夜。大きなステージのオーディション。' },
    { who: 'mina', text: 'さあ、ライトの前へ。キミが積み重ねた30日を、世界に見せてあげて！' },
  ];
  runDialogue(finale, showEnding);
}

function showEnding() {
  const c = charm();
  const rk = rankInfo(c);
  let msg;
  if (c >= 90) msg = 'スポットライトを浴びた瞬間、会場が息をのんだ。伝説の爆美女、ここに誕生——！あなたの努力は、誰よりも輝いていた。';
  else if (c >= 78) msg = 'ステージの上のあなたは、誰が見ても本物の美女。30日前の自分が、今のあなたを見たらきっと泣いて喜ぶ。';
  else if (c >= 64) msg = 'ふんわり可愛い笑顔に、会場は大きな拍手。あなたらしい魅力が、たしかに花開いた一日だった。';
  else if (c >= 48) msg = 'まだ荒削り。でも、みがけば光る原石の輝きは本物。この30日は、始まりの一歩にすぎない。';
  else msg = '結果はこれから。でも「変わりたい」と願って動いた30日は、決して無駄じゃない。物語は、まだ続く。';

  // 目標タイプに応じた仕上がりコメント
  const g = GOALS[S.goal] || GOALS.sexy;
  const gs = goalScore();
  const goalLine = gs >= 75 ? `理想の「${g.name}」を完璧に手に入れた——${g.end}`
                 : gs >= 55 ? `目指した「${g.name}」の魅力が、たしかに花開いていた。`
                 : `「${g.name}」への道はまだ途中。でも、輪郭は見えてきた。`;

  $('endingAvatar').innerHTML = charFace('you', rk.acc);
  $('endingRank').textContent = rk.t;
  $('endingName').textContent = `${S.name} ・ ${g.emoji}${g.name}（完成度${gs}）`;
  $('endingStats').innerHTML =
    `<span class="ending-stat">魅力 ${c}</span>` +
    `<span class="ending-stat">👥 ${S.followers.toLocaleString()}</span>` +
    STATS.map((st) => `<span class="ending-stat">${st.name} ${S.stats[st.key]}</span>`).join('');
  $('endingMsg').textContent = msg + '\n\n' + goalLine;
  $('ending').hidden = false;
}

/* =========================================================
   起動 / イベント登録
   ========================================================= */
function startNewGame(name, goalId) {
  S = defaultState();
  S.name = name || 'ミライ';
  S.goal = GOALS[goalId] ? goalId : 'sexy';
  // 目標タイプの得意ステータスが少し高い状態でスタート
  GOALS[S.goal].focus.forEach((k) => { S.stats[k] = clamp(S.stats[k] + 5, 0, 100); });
  save();
  show('game');
  beginDay();
}

function renderGoalCards() {
  $('goalList').innerHTML = Object.keys(GOALS).map((id) => {
    const g = GOALS[id];
    const focus = g.focus.map((k) => STATS.find((s) => s.key === k).name).join('・');
    return `<button class="goal-card" data-goal="${id}">
      <span class="goal-emoji">${g.emoji}</span>
      <span class="goal-body">
        <span class="goal-name">${g.name}</span>
        <span class="goal-desc">${g.desc}</span>
        <span class="goal-focus">得意になる → ${focus}</span>
      </span>
    </button>`;
  }).join('');
}

function boot() {
  // タイトルのヒーロー画像
  $('titleHero').innerHTML = charFace('you', 'bow');
  $('introHero').innerHTML = charFace('you', 'heart');
  if (hasSave()) $('continueBtn').hidden = false;

  $('startBtn').onclick = () => { show('intro'); };
  $('continueBtn').onclick = () => { load(); show('game'); render(); };

  let chosenName = 'ミライ';
  $('introGoBtn').onclick = () => {
    chosenName = ($('nameInput').value || '').trim() || 'ミライ';
    renderGoalCards();
    show('goal');
  };

  $('goalList').addEventListener('click', (e) => {
    const el = e.target.closest('.goal-card');
    if (el) startNewGame(chosenName, el.dataset.goal);
  });

  // 行動カード
  $('actions').addEventListener('click', (e) => {
    const el = e.target.closest('.action');
    if (!el || el.classList.contains('disabled')) return;
    const a = ACTIONS.find((x) => x.id === el.dataset.id);
    if (a) askAction(a);
  });

  $('confirmNo').onclick = () => { $('confirm').hidden = true; pendingAction = null; };
  $('confirmYes').onclick = doAction;

  $('sleepBtn').onclick = endDay;

  $('resetBtn').onclick = () => {
    if (confirm('本当に最初からやり直す？（今のデータは消えます）')) { wipe(); location.reload(); }
  };
  $('endingAgain').onclick = () => { $('ending').hidden = true; wipe(); show('intro'); };
}

document.addEventListener('DOMContentLoaded', boot);

/* Service Worker（オフライン対応） */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}
