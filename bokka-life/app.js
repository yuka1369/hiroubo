/* 掴め！牧歌ライフ！ ------------------------------------------------------
   旦那様と畑をたがやし、しゅうかく物で研究をすすめ、二人の暮らしを育てる
   ほのぼの経営シミュレーション。データはこの端末（localStorage）だけに保存。
--------------------------------------------------------------------------- */

const SAVE_KEY = "bokka-life-save-v1";

/* ---- 作物データ -------------------------------------------------------- */
// grow: 育つ秒数 / coin: 収穫でもらえるコイン / produce: しゅうかく物 / seed: 植えるコスト(コイン)
// unlock: 必要な研究ID（null は最初から使える）
const CROPS = {
  carrot:     { emoji: "🥕", name: "にんじん",   grow: 8,  coin: 6,  produce: 1, seed: 0,  unlock: null },
  potato:     { emoji: "🥔", name: "じゃがいも", grow: 11, coin: 10, produce: 1, seed: 3,  unlock: null },
  tomato:     { emoji: "🍅", name: "トマト",     grow: 15, coin: 16, produce: 2, seed: 6,  unlock: "tomato" },
  strawberry: { emoji: "🍓", name: "いちご",     grow: 19, coin: 24, produce: 2, seed: 10, unlock: "strawberry" },
  pumpkin:    { emoji: "🎃", name: "かぼちゃ",   grow: 27, coin: 44, produce: 3, seed: 16, unlock: "pumpkin" },
};

/* ---- 研究ツリー -------------------------------------------------------- */
// cost: 研究P / need: 前提の研究ID配列
const RESEARCH = [
  { id: "fertilizer", emoji: "🌱", name: "ふかふか肥料",     desc: "作物の成長が20%はやくなる",                 cost: 2,  need: [] },
  { id: "tomato",     emoji: "🍅", name: "トマトの栽培",     desc: "新しい作物「トマト」を植えられる",           cost: 3,  need: [] },
  { id: "plots",      emoji: "🚜", name: "畑をひろげる",     desc: "畑が6マス増える",                           cost: 4,  need: [] },
  { id: "chicken",    emoji: "🐔", name: "にわとり小屋",     desc: "たまごが自動でとどく（🧺+1／15秒）",         cost: 5,  need: [] },
  { id: "strawberry", emoji: "🍓", name: "いちごの栽培",     desc: "新しい作物「いちご」を植えられる",           cost: 6,  need: ["tomato"] },
  { id: "study",      emoji: "📚", name: "旦那様の書斎",     desc: "お茶のたびに🔬+1、❤️の効果もアップ",         cost: 8,  need: ["chicken"] },
  { id: "cow",        emoji: "🐄", name: "うし小屋",         desc: "ミルクが自動でとどく（🧺+2／25秒）",         cost: 9,  need: ["chicken"] },
  { id: "pumpkin",    emoji: "🎃", name: "かぼちゃの栽培",   desc: "新しい作物「かぼちゃ」を植えられる",         cost: 11, need: ["strawberry"] },
  { id: "windmill",   emoji: "🌾", name: "風車小屋",         desc: "収穫のコインが1.5倍になる",                 cost: 13, need: ["cow", "study"] },
  { id: "dream",      emoji: "🏡", name: "ふたりの牧歌ライフ", desc: "すべての研究の集大成。牧歌ライフ、完成！", cost: 18, need: ["pumpkin", "windmill"] },
];
const TOTAL_RESEARCH = RESEARCH.length;

/* ---- 旦那様のセリフ ---------------------------------------------------- */
const DARLING_LINES = [
  "きみと畑にいる時間が、いちばん好きだよ。",
  "今日の研究、大発見のよかんがするね。",
  "お茶がはいったよ。すこし休もう？",
  "収穫、いっしょに数えようか。",
  "星がきれいだ。明日もいい一日にしよう。",
  "きみのおかげで、この暮らしがまぶしいよ。",
  "むりはしないでね。ぼくがとなりにいるから。",
  "この作物、きみが育てたと思うと味がちがうな。",
  "ふたりなら、どんな研究もこわくない。",
  "いってらっしゃい。畑はぼくが見ておくよ。",
];
const EVENT_LINES = [
  "☀️ よく晴れて、作物がのびのび育っています。",
  "🌧️ しとしと雨。畑がうるおいました。",
  "🦋 ちょうちょが畑にあそびに来ました。",
  "🍞 旦那様が焼きたてパンを差し入れてくれました。",
];

/* ---- 状態 -------------------------------------------------------------- */
let state = null;

function defaultState() {
  const now = Date.now();
  return {
    coin: 30,
    produce: 0,
    rp: 0,
    love: 0,
    day: 1,
    plots: Array.from({ length: 6 }, () => ({ crop: null, at: 0 })),
    selected: "carrot",
    done: {},              // 完了した研究ID
    chickenAt: 0,          // 次のたまごまでの基準時刻
    cowAt: 0,
    teaReadyAt: 0,         // 次にお茶できる時刻
    dayAt: now,            // 次に日付が進む基準
    createdAt: now,
    log: [],
    won: false,
  };
}

/* ---- セーブ／ロード ---------------------------------------------------- */
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const base = defaultState();
    return Object.assign(base, s); // 後方互換のためデフォルトにマージ
  } catch (e) { return defaultState(); }
}

/* ---- ヘルパ ------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const has = (id) => !!state.done[id];
const cropUnlocked = (key) => { const c = CROPS[key]; return !c.unlock || has(c.unlock); };
const loveBuff = () => 1 + Math.min(state.love, 50) * (has("study") ? 0.014 : 0.008); // ❤️で最大+40〜70%
const growTime = (key) => CROPS[key].grow * (has("fertilizer") ? 0.8 : 1);
const doneCount = () => Object.keys(state.done).length;

const SEASONS = [
  { name: "はる", ic: "🌱" }, { name: "なつ", ic: "🌻" },
  { name: "あき", ic: "🍂" }, { name: "ふゆ", ic: "❄️" },
];
const seasonOf = (day) => SEASONS[Math.floor((day - 1) / 7) % 4];

function addLog(msg) {
  state.log.unshift({ t: `${state.day}日目`, m: msg });
  if (state.log.length > 30) state.log.pop();
}

/* ---- 畑の操作 ---------------------------------------------------------- */
function plantOrHarvest(i) {
  const p = state.plots[i];
  if (!p) return;
  if (!p.crop) {
    // 植える
    const key = state.selected;
    if (!cropUnlocked(key)) return;
    const cost = CROPS[key].seed;
    if (state.coin < cost) { toast("🪙 コインがたりません"); return; }
    state.coin -= cost;
    p.crop = key; p.at = Date.now();
  } else {
    // 育っていれば収穫
    const elapsed = (Date.now() - p.at) / 1000;
    if (elapsed < growTime(p.crop)) { toast("🌱 まだ育っています…"); return; }
    const c = CROPS[p.crop];
    let coin = Math.round(c.coin * loveBuff() * (has("windmill") ? 1.5 : 1));
    state.coin += coin;
    state.produce += c.produce;
    burst(c.emoji);
    p.crop = null; p.at = 0;
  }
  save(); render();
}

/* ---- 研究 -------------------------------------------------------------- */
function doStudy() {
  if (state.produce < 5) { toast("🧺 しゅうかく物がたりません"); return; }
  state.produce -= 5;
  state.rp += 1;
  save(); render();
}

function research(id) {
  const r = RESEARCH.find((x) => x.id === id);
  if (!r || has(id)) return;
  if (!r.need.every((n) => has(n))) return;
  if (state.rp < r.cost) { toast("🔬 研究Pがたりません"); return; }
  state.rp -= r.cost;
  state.done[id] = true;

  // 効果の反映
  if (id === "plots") for (let k = 0; k < 6; k++) state.plots.push({ crop: null, at: 0 });
  if (id === "chicken") state.chickenAt = Date.now() + 15000;
  if (id === "cow") state.cowAt = Date.now() + 25000;

  addLog(`${r.emoji} 研究「${r.name}」が完成しました。`);
  toast(`${r.emoji} ${r.name} 完成！`);

  if (id === "dream" && !state.won) { state.won = true; showWin(); }
  save(); render();
}

/* ---- 旦那様とお茶 ------------------------------------------------------ */
function tea() {
  const now = Date.now();
  if (now < state.teaReadyAt) return;
  state.teaReadyAt = now + 15000; // 15秒クールダウン
  state.love += 1;
  if (has("study")) state.rp += 1;
  const line = DARLING_LINES[Math.floor(Math.random() * DARLING_LINES.length)];
  $("darling-bubble").textContent = line;
  $("darling-face").classList.add("happy");
  setTimeout(() => $("darling-face").classList.remove("happy"), 900);
  burst("❤️");
  save(); render();
}

/* ---- 時間の進行（毎フレームのtick） ------------------------------------ */
function tick() {
  const now = Date.now();

  // 家畜の自動収穫（放置ぶんもまとめて。ただし最大20回ぶんまで）
  if (has("chicken")) {
    let n = 0;
    while (now - state.chickenAt >= 15000 && n < 20) { state.produce += 1; state.chickenAt += 15000; n++; }
    if (now - state.chickenAt >= 15000) state.chickenAt = now; // 溜まりすぎたら追いつく
  }
  if (has("cow")) {
    let n = 0;
    while (now - state.cowAt >= 25000 && n < 20) { state.produce += 2; state.cowAt += 25000; n++; }
    if (now - state.cowAt >= 25000) state.cowAt = now;
  }

  // 日付（45秒で1日、季節が7日ごとに変わる：ほぼ演出）
  while (now - state.dayAt >= 45000) {
    state.dayAt += 45000; state.day += 1;
    if (state.day % 7 === 0) addLog(`${seasonOf(state.day).ic} ${seasonOf(state.day).name}になりました。`);
    if (Math.random() < 0.5) {
      const ev = EVENT_LINES[Math.floor(Math.random() * EVENT_LINES.length)];
      addLog(ev);
    }
  }

  render();
}

/* ---- 描画 -------------------------------------------------------------- */
function render() {
  // ステータス
  $("s-produce").textContent = state.produce;
  $("s-coin").textContent = state.coin;
  $("s-rp").textContent = state.rp;
  $("s-love").textContent = state.love;
  $("s-day").textContent = state.day;
  const sn = seasonOf(state.day);
  $("s-season").textContent = sn.name;
  $("s-season-ic").textContent = sn.ic;

  // 達成度
  const pct = Math.round((doneCount() / TOTAL_RESEARCH) * 100);
  $("p-pct").textContent = pct + "%";
  $("p-fill").style.width = pct + "%";

  renderCropPicker();
  renderField();
  renderBarn();
  renderResearch();
  renderStudyBtn();
  renderTeaBtn();
  renderLog();
}

function renderCropPicker() {
  const wrap = $("crop-picker");
  wrap.innerHTML = "";
  Object.entries(CROPS).forEach(([key, c]) => {
    if (!cropUnlocked(key)) return;
    const b = document.createElement("button");
    b.className = "chip" + (state.selected === key ? " on" : "");
    b.innerHTML = `<span class="ce">${c.emoji}</span>${c.name}<small>${c.seed ? "🪙" + c.seed : "むりょう"}</small>`;
    b.onclick = () => { state.selected = key; save(); render(); };
    wrap.appendChild(b);
  });
}

function renderField() {
  const f = $("field");
  f.innerHTML = "";
  const now = Date.now();
  state.plots.forEach((p, i) => {
    const cell = document.createElement("button");
    cell.className = "plot";
    if (!p.crop) {
      cell.classList.add("empty");
      cell.innerHTML = `<span class="soil">🟫</span>`;
      cell.setAttribute("aria-label", "空いた畑");
    } else {
      const c = CROPS[p.crop];
      const g = growTime(p.crop);
      const el = (now - p.at) / 1000;
      const ratio = Math.min(el / g, 1);
      if (ratio >= 1) {
        cell.classList.add("ripe");
        cell.innerHTML = `<span class="crop">${c.emoji}</span><i class="ready">収穫！</i>`;
      } else {
        cell.classList.add("growing");
        const stage = ratio < 0.4 ? "🌱" : ratio < 0.8 ? "🌿" : c.emoji;
        cell.innerHTML = `<span class="crop dim">${stage}</span><i class="pbar"><b style="width:${Math.round(ratio * 100)}%"></b></i>`;
      }
    }
    cell.onclick = () => plantOrHarvest(i);
    f.appendChild(cell);
  });
}

function renderBarn() {
  const show = has("chicken") || has("cow");
  $("barn-card").hidden = !show;
  if (!show) return;
  const b = $("barn");
  b.innerHTML = "";
  const now = Date.now();
  if (has("chicken")) {
    const left = Math.max(0, Math.ceil((state.chickenAt + 15000 - now) / 1000));
    b.appendChild(barnTile("🐔", "にわとり小屋", `つぎのたまご：${Math.min(left, 15)}秒`));
  }
  if (has("cow")) {
    const left = Math.max(0, Math.ceil((state.cowAt + 25000 - now) / 1000));
    b.appendChild(barnTile("🐄", "うし小屋", `つぎのミルク：${Math.min(left, 25)}秒`));
  }
}
function barnTile(emoji, name, sub) {
  const d = document.createElement("div");
  d.className = "barn-tile";
  d.innerHTML = `<span class="be">${emoji}</span><b>${name}</b><small>${sub}</small>`;
  return d;
}

function renderResearch() {
  const ul = $("research");
  ul.innerHTML = "";
  RESEARCH.forEach((r) => {
    const li = document.createElement("li");
    const done = has(r.id);
    const ok = r.need.every((n) => has(n));
    const affordable = state.rp >= r.cost;
    li.className = "res" + (done ? " done" : ok ? "" : " locked");
    const needTxt = ok || done ? "" :
      `<small class="need">🔒 前提：${r.need.map((n) => RESEARCH.find((x) => x.id === n).name).join("・")}</small>`;
    li.innerHTML = `
      <div class="res-main">
        <span class="re">${r.emoji}</span>
        <div class="res-text"><b>${r.name}</b><small>${r.desc}</small>${needTxt}</div>
      </div>
      <div class="res-side">
        ${done ? `<span class="tag">完了 ✓</span>`
              : `<button class="btn small ${affordable && ok ? "" : "off"}">🔬${r.cost}</button>`}
      </div>`;
    if (!done && ok) {
      const btn = li.querySelector("button");
      btn.onclick = () => research(r.id);
    }
    ul.appendChild(li);
  });
}

function renderStudyBtn() {
  const b = $("study-btn");
  b.disabled = state.produce < 5;
  b.classList.toggle("off", state.produce < 5);
}

function renderTeaBtn() {
  const b = $("tea-btn");
  const left = Math.ceil((state.teaReadyAt - Date.now()) / 1000);
  if (left > 0) {
    b.disabled = true; b.classList.add("off");
    b.textContent = `☕ お茶のじゅんび中…（${left}秒）`;
  } else {
    b.disabled = false; b.classList.remove("off");
    b.textContent = "☕ 旦那様とお茶する";
  }
}

function renderLog() {
  const ul = $("log");
  ul.innerHTML = "";
  if (state.log.length === 0) {
    ul.innerHTML = `<li class="log-empty">できごとがここに書かれていきます。</li>`;
    return;
  }
  state.log.forEach((e) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="log-day">${e.t}</span> ${e.m}`;
    ul.appendChild(li);
  });
}

/* ---- 演出 -------------------------------------------------------------- */
let toastTimer = null;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1400);
}
function burst(emoji) {
  const fx = $("fx");
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("span");
    s.className = "spark"; s.textContent = emoji;
    s.style.left = (40 + Math.random() * 20) + "%";
    s.style.setProperty("--dx", (Math.random() * 120 - 60) + "px");
    s.style.setProperty("--dy", (-80 - Math.random() * 80) + "px");
    fx.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

function showWin() {
  addLog("🏡 ふたりの牧歌ライフが完成しました。");
  const days = state.day;
  $("win-stats").textContent = `${days}日をかけて、${TOTAL_RESEARCH}コの研究をやりきりました。❤️旦那様との仲：${state.love}`;
  $("win").classList.remove("hidden");
}

/* ---- 初期化 ------------------------------------------------------------ */
function init() {
  state = load();

  $("tea-btn").onclick = tea;
  $("study-btn").onclick = doStudy;
  $("win-close").onclick = () => $("win").classList.add("hidden");
  $("reset-btn").onclick = () => {
    if (confirm("さいしょからやり直しますか？（この端末の記録は消えます）")) {
      state = defaultState(); save(); render();
    }
  };

  render();
  setInterval(tick, 500);
  setInterval(save, 5000);
  window.addEventListener("beforeunload", save);

  // Service Worker（オフライン対応）
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}
document.addEventListener("DOMContentLoaded", init);
