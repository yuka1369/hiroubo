/* じすいっち — レシピ・カテゴリの初期データ
 * 値段は「そのレシピで使う量ぶん」の目安（円・税込ざっくり）。
 * mealTypes: breakfast / lunch / dinner のどれに向くか
 * freeze: 冷凍・作り置きOK / nutri: 栄養バランス◎ / easy時間は time(分)
 */
const CATEGORIES = [
  { id: 'quick',   name: '1分限界料理',        emoji: '⚡', desc: 'とにかく速い。疲れてても作れる' },
  { id: 'stock',   name: '作り置き・冷凍ストック', emoji: '🧊', desc: '土日にまとめて。平日がラクになる' },
  { id: 'nutri',   name: '栄養料理',            emoji: '🥗', desc: 'バランス重視。整えたい日に' },
  { id: 'manga',   name: '漫画料理',            emoji: '📖', desc: 'あの作品のあのメシを再現' },
  { id: 'joy',     name: '食の楽しみ料理',       emoji: '🎉', desc: '手間をかけて楽しむごちそう' },
  { id: 'thrifty', name: '節約料理',            emoji: '💰', desc: '財布にやさしい。給料日前に' },
];

const SEED_CREATORS = [
  { id: 'c-seed-1', name: 'バズレシピ系YouTuber', platform: 'youtube', handle: '', categories: ['quick', 'thrifty'] },
  { id: 'c-seed-2', name: '作り置きインスタグラマー', platform: 'instagram', handle: '', categories: ['stock', 'nutri'] },
  { id: 'c-seed-3', name: 'グルメ漫画メシ再現', platform: 'youtube', handle: '', categories: ['manga', 'joy'] },
];

// r() ヘルパで簡潔に。ings: [名前, 量, 単位, 円]
function r(o) {
  return {
    id: o.id, name: o.name, cat: o.cat, creatorId: o.creatorId || null,
    time: o.time, servings: o.servings || 2, kcal: o.kcal || 0,
    freeze: !!o.freeze, nutri: !!o.nutri, meals: o.meals,
    ings: (o.ings || []).map(([name, qty, unit, price]) => ({ name, qty, unit, price })),
    note: o.note || '',
  };
}

const SEED_RECIPES = [
  // ---- 1分限界料理 ----
  r({ id: 's-q1', name: '納豆卵かけごはん', cat: 'quick', creatorId: 'c-seed-1', time: 3, kcal: 420, nutri: true, meals: ['breakfast','lunch'],
    ings: [['ごはん',1,'膳',40],['納豆',1,'パック',30],['卵',1,'個',25],['ねぎ',0.2,'本',12]] }),
  r({ id: 's-q2', name: 'ツナマヨトースト', cat: 'quick', creatorId: 'c-seed-1', time: 5, kcal: 380, meals: ['breakfast','lunch'],
    ings: [['食パン',1,'枚',30],['ツナ缶',0.5,'缶',60],['マヨネーズ',15,'g',10],['チーズ',1,'枚',40]] }),
  r({ id: 's-q3', name: 'バナナヨーグルト', cat: 'quick', time: 2, kcal: 220, nutri: true, meals: ['breakfast'],
    ings: [['ヨーグルト',150,'g',60],['バナナ',1,'本',30],['はちみつ',10,'g',15]] }),
  r({ id: 's-q4', name: '冷奴とインスタント味噌汁', cat: 'quick', time: 4, kcal: 180, nutri: true, meals: ['lunch','dinner'],
    ings: [['豆腐',0.5,'丁',40],['かつお節',3,'g',20],['ねぎ',0.2,'本',12],['インスタント味噌汁',1,'食',35]] }),
  r({ id: 's-q5', name: 'レンジ蒸し鶏サラダ', cat: 'quick', creatorId: 'c-seed-1', time: 8, kcal: 300, nutri: true, meals: ['lunch','dinner'],
    ings: [['鶏むね肉',150,'g',120],['カット野菜',1,'袋',100],['ごまドレッシング',20,'g',20]] }),

  // ---- 作り置き・冷凍ストック（土日・30分以内中心）----
  r({ id: 's-s1', name: '鶏むねの下味冷凍（塩こうじ）', cat: 'stock', creatorId: 'c-seed-2', time: 15, kcal: 260, freeze: true, nutri: true, meals: ['lunch','dinner'], servings: 4,
    ings: [['鶏むね肉',500,'g',380],['塩こうじ',40,'g',60],['にんにく',1,'片',20]] }),
  r({ id: 's-s2', name: 'ミートソース大量仕込み', cat: 'stock', creatorId: 'c-seed-2', time: 30, kcal: 480, freeze: true, meals: ['lunch','dinner'], servings: 4,
    ings: [['合いびき肉',300,'g',360],['玉ねぎ',1,'個',50],['トマト缶',1,'缶',110],['にんじん',0.5,'本',30],['パスタ',400,'g',160]] }),
  r({ id: 's-s3', name: 'きんぴらごぼう', cat: 'stock', creatorId: 'c-seed-2', time: 20, kcal: 150, freeze: true, nutri: true, meals: ['lunch','dinner'], servings: 4,
    ings: [['ごぼう',1,'本',90],['にんじん',0.5,'本',30],['ごま油',10,'g',15],['醤油',20,'g',10]] }),
  r({ id: 's-s4', name: 'ひじきと大豆の煮物', cat: 'stock', creatorId: 'c-seed-2', time: 25, kcal: 130, freeze: true, nutri: true, meals: ['breakfast','dinner'], servings: 4,
    ings: [['乾燥ひじき',20,'g',80],['大豆水煮',1,'袋',90],['にんじん',0.5,'本',30],['油揚げ',1,'枚',30]] }),
  r({ id: 's-s5', name: '冷凍ハンバーグ種', cat: 'stock', time: 25, kcal: 420, freeze: true, meals: ['lunch','dinner'], servings: 4,
    ings: [['合いびき肉',400,'g',480],['玉ねぎ',1,'個',50],['卵',1,'個',25],['パン粉',30,'g',20]] }),
  r({ id: 's-s6', name: '作り置きカレー', cat: 'stock', time: 30, kcal: 650, freeze: true, meals: ['lunch','dinner'], servings: 5,
    ings: [['豚こま',300,'g',300],['玉ねぎ',2,'個',100],['じゃがいも',3,'個',120],['にんじん',1,'本',60],['カレールー',0.5,'箱',110]] }),
  r({ id: 's-s7', name: '鶏そぼろの作り置き', cat: 'stock', creatorId: 'c-seed-2', time: 18, kcal: 280, freeze: true, nutri: true, meals: ['breakfast','lunch','dinner'], servings: 4,
    ings: [['鶏ひき肉',300,'g',300],['生姜',10,'g',20],['醤油',30,'g',15],['砂糖',15,'g',5]] }),
  r({ id: 's-s8', name: '作り置き味玉＆蒸し野菜', cat: 'stock', time: 20, kcal: 210, freeze: false, nutri: true, meals: ['breakfast','lunch'], servings: 4,
    ings: [['卵',6,'個',150],['めんつゆ',40,'g',30],['ブロッコリー',0.5,'株',90],['にんじん',0.5,'本',30]] }),

  // ---- 栄養料理 ----
  r({ id: 's-n1', name: '鮭の塩焼き定食', cat: 'nutri', time: 15, kcal: 480, nutri: true, meals: ['breakfast','dinner'],
    ings: [['生鮭',2,'切',280],['ごはん',2,'膳',80],['ほうれん草',0.5,'束',80],['味噌',20,'g',10]] }),
  r({ id: 's-n2', name: '豚の生姜焼き', cat: 'nutri', creatorId: 'c-seed-1', time: 15, kcal: 520, nutri: true, meals: ['lunch','dinner'],
    ings: [['豚ロース',200,'g',260],['玉ねぎ',0.5,'個',25],['生姜',10,'g',20],['キャベツ',0.2,'玉',40]] }),
  r({ id: 's-n3', name: 'サバの味噌煮', cat: 'nutri', time: 20, kcal: 450, nutri: true, meals: ['lunch','dinner'],
    ings: [['サバ',2,'切',240],['味噌',30,'g',15],['生姜',10,'g',20],['砂糖',15,'g',5]] }),
  r({ id: 's-n4', name: '鶏むねと温野菜の蒸し', cat: 'nutri', creatorId: 'c-seed-2', time: 18, kcal: 340, nutri: true, meals: ['lunch','dinner'],
    ings: [['鶏むね肉',200,'g',160],['ブロッコリー',0.5,'株',90],['にんじん',0.5,'本',30],['ポン酢',20,'g',15]] }),
  r({ id: 's-n5', name: '納豆と野菜たっぷり味噌汁の朝食', cat: 'nutri', time: 12, kcal: 360, nutri: true, meals: ['breakfast'],
    ings: [['ごはん',1,'膳',40],['納豆',1,'パック',30],['豆腐',0.3,'丁',24],['わかめ',3,'g',20],['味噌',15,'g',8]] }),
  r({ id: 's-n6', name: 'ほうれん草とツナの卵炒め', cat: 'nutri', time: 10, kcal: 300, nutri: true, meals: ['breakfast','lunch'],
    ings: [['ほうれん草',0.5,'束',80],['卵',2,'個',50],['ツナ缶',0.5,'缶',60]] }),

  // ---- 漫画料理 ----
  r({ id: 's-m1', name: '孤独のグルメ風 焼肉丼', cat: 'manga', creatorId: 'c-seed-3', time: 15, kcal: 720, meals: ['lunch','dinner'],
    ings: [['牛カルビ',200,'g',480],['ごはん',2,'膳',80],['焼肉のたれ',30,'g',20],['ねぎ',0.5,'本',30]] }),
  r({ id: 's-m2', name: 'クッキングパパ風 パラパラ炒飯', cat: 'manga', creatorId: 'c-seed-3', time: 12, kcal: 560, meals: ['lunch','dinner'],
    ings: [['ごはん',2,'膳',80],['卵',2,'個',50],['チャーシュー',80,'g',150],['ねぎ',0.5,'本',30]] }),
  r({ id: 's-m3', name: '深夜食堂風 赤いウインナー卵', cat: 'manga', creatorId: 'c-seed-3', time: 8, kcal: 260, meals: ['breakfast','dinner'],
    ings: [['ウインナー',4,'本',120],['卵',2,'個',50],['ケチャップ',15,'g',10]] }),
  r({ id: 's-m4', name: 'ラピュタ風 目玉焼きトースト', cat: 'manga', creatorId: 'c-seed-3', time: 7, kcal: 400, meals: ['breakfast'],
    ings: [['食パン',1,'枚',30],['卵',1,'個',25],['バター',10,'g',20]] }),

  // ---- 食の楽しみ料理 ----
  r({ id: 's-j1', name: '手作りピザ', cat: 'joy', creatorId: 'c-seed-3', time: 40, kcal: 700, meals: ['lunch','dinner'], servings: 3,
    ings: [['ピザ生地',1,'枚',200],['ピザソース',80,'g',100],['モッツァレラ',100,'g',250],['サラミ',40,'g',150],['ピーマン',1,'個',30]] }),
  r({ id: 's-j2', name: 'チーズタッカルビ', cat: 'joy', time: 30, kcal: 680, meals: ['dinner'], servings: 3,
    ings: [['鶏もも肉',300,'g',330],['キャベツ',0.3,'玉',60],['コチュジャン',30,'g',40],['とろけるチーズ',120,'g',200]] }),
  r({ id: 's-j3', name: 'パエリア', cat: 'joy', time: 40, kcal: 620, meals: ['lunch','dinner'], servings: 3,
    ings: [['米',2,'合',120],['シーフードミックス',200,'g',300],['パプリカ',1,'個',80],['玉ねぎ',0.5,'個',25],['サフラン(コンソメ可)',1,'式',50]] }),
  r({ id: 's-j4', name: '手巻き寿司', cat: 'joy', time: 30, kcal: 550, meals: ['dinner'], servings: 3,
    ings: [['米',2,'合',120],['刺身盛り合わせ',1,'パック',600],['焼き海苔',5,'枚',100],['きゅうり',1,'本',50],['卵',2,'個',50]] }),

  // ---- 節約料理 ----
  r({ id: 's-t1', name: 'もやしと豚こまの炒め', cat: 'thrifty', creatorId: 'c-seed-1', time: 10, kcal: 320, meals: ['lunch','dinner'],
    ings: [['もやし',1,'袋',30],['豚こま',100,'g',100],['醤油',15,'g',8],['ごま油',5,'g',8]] }),
  r({ id: 's-t2', name: '豆腐ハンバーグ', cat: 'thrifty', time: 20, kcal: 380, nutri: true, meals: ['lunch','dinner'],
    ings: [['豆腐',1,'丁',80],['鶏ひき肉',150,'g',150],['玉ねぎ',0.5,'個',25],['パン粉',20,'g',15]] }),
  r({ id: 's-t3', name: 'キャベツと卵のふわとろ炒め', cat: 'thrifty', time: 8, kcal: 260, meals: ['breakfast','lunch'],
    ings: [['キャベツ',0.25,'玉',50],['卵',2,'個',50],['ハム',2,'枚',40]] }),
  r({ id: 's-t4', name: '釜玉うどん', cat: 'thrifty', creatorId: 'c-seed-1', time: 6, kcal: 420, meals: ['lunch'],
    ings: [['冷凍うどん',1,'玉',40],['卵',1,'個',25],['めんつゆ',20,'g',15],['ねぎ',0.3,'本',18]] }),
  r({ id: 's-t5', name: '卵チャーハン', cat: 'thrifty', time: 10, kcal: 480, meals: ['lunch','dinner'],
    ings: [['ごはん',2,'膳',80],['卵',2,'個',50],['ねぎ',0.5,'本',30],['醤油',10,'g',6]] }),
  r({ id: 's-t6', name: 'ちくわの磯辺揚げ', cat: 'thrifty', time: 12, kcal: 300, meals: ['dinner'],
    ings: [['ちくわ',4,'本',100],['天ぷら粉',40,'g',30],['青のり',2,'g',15]] }),
];
