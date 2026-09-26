// 農家（農業パック予定）: 作業設定でONにした作物を収穫する
//   畑の作物（小麦・ビートルート・ニンジン・ジャガイモ）：収穫して、道具袋の種を1つ使ってその場で植え直す（種が無ければ空けておく）
//     空いた畑には倉庫の種をまく。3方以上を畑に囲まれた土（踏み荒らされた所）は耕し直す
//   カボチャ・スイカ：茎につながった実だけ収穫する（茎は残す）。並びは作らず、茎の隣の空き地には何もまかない
//   サトウキビ・竹・サボテン：一番下の1本を残して、その上を刈る
import { system } from "@minecraft/server";
import { RETRY_TICKS } from "../core/config.js";
import { getStock } from "../core/storage.js";
import { registerJob } from "../core/registry.js";
import { addCarry, center, dist2, key, lookAt, safeBlock } from "../core/blocks.js";
import { takeBlock, takeBlocksWhere, tasks } from "../core/tasks.js";

/**
 * @typedef {import("../core/registry.js").Pos} Pos
 * @typedef {import("@minecraft/server").Dimension} Dimension
 * @typedef {import("@minecraft/server").Block} Block
 * @typedef {import("../core/registry.js").WorkContext} WorkContext
 *
 * @typedef {{ kind: "field", name: string, block: string, item: string, min: number, max: number, seed: string }} FieldCrop
 * @typedef {{ kind: "fruit", name: string, block: string, item: string, stem: string, seed: string }} FruitCrop
 * @typedef {{ kind: "tall", name: string, block: string, item: string, minHeight: number }} TallCrop
 * @typedef {FieldCrop | FruitCrop | TallCrop} Crop
 */

/** 扱える作物（作業設定 crop_<id> でONにした物だけ受け持つ） */
/** @type {Record<string, Crop>} */
const CROPS = {
  wheat: { kind: "field", name: "小麦", block: "minecraft:wheat", item: "minecraft:wheat", min: 1, max: 1, seed: "minecraft:wheat_seeds" },
  beetroot: { kind: "field", name: "ビートルート", block: "minecraft:beetroot", item: "minecraft:beetroot", min: 1, max: 1, seed: "minecraft:beetroot_seeds" },
  carrot: { kind: "field", name: "ニンジン", block: "minecraft:carrots", item: "minecraft:carrot", min: 2, max: 4, seed: "minecraft:carrot" },
  potato: { kind: "field", name: "ジャガイモ", block: "minecraft:potatoes", item: "minecraft:potato", min: 2, max: 4, seed: "minecraft:potato" },
  pumpkin: { kind: "fruit", name: "カボチャ", block: "minecraft:pumpkin", item: "minecraft:pumpkin", stem: "minecraft:pumpkin_stem", seed: "minecraft:pumpkin_seeds" },
  // スイカは薄切りだとかさばるので、ブロックのまま持ち帰る
  melon: { kind: "fruit", name: "スイカ", block: "minecraft:melon_block", item: "minecraft:melon_block", stem: "minecraft:melon_stem", seed: "minecraft:melon_seeds" },
  sugarcane: { kind: "tall", name: "サトウキビ", block: "minecraft:reeds", item: "minecraft:sugar_cane", minHeight: 2 },
  bamboo: { kind: "tall", name: "竹", block: "minecraft:bamboo", item: "minecraft:bamboo", minHeight: 4 },
  cactus: { kind: "tall", name: "サボテン", block: "minecraft:cactus", item: "minecraft:cactus", minHeight: 2 },
};
const CROP_IDS = Object.keys(CROPS);

/** ブロック → 作物の id */
/** @type {Record<string, string>} */
const BY_BLOCK = {};
/** 茎のブロック → 作物の id */
/** @type {Record<string, string>} */
const BY_STEM = {};
for (const id of CROP_IDS) {
  const c = CROPS[id];
  BY_BLOCK[c.block] = id;
  if (c.kind === "fruit") BY_STEM[c.stem] = id;
}

/** 種 → 作物の id（畑の作物と、カボチャ・スイカの茎） */
/** @type {Record<string, string>} */
const BY_SEED = {};
for (const id of CROP_IDS) {
  const c = CROPS[id];
  if (c.kind !== "tall") BY_SEED[c.seed] = id;
}

/** 作物をONにしているか @param {(id: string) => boolean} opt @param {string} id */
const cropOn = (opt, id) => opt(`crop_${id}`);

/** 倉庫から持ち出す量の上限（種の合計） */
const BAG_MAX = 32;
/** ニンジン・ジャガイモは食料でもあるので、持ち出しは控えめに */
const FOOD_SEED_MAX = 8;
/** 種まき・耕し直しの仕事は同時にこれだけ（収穫の仕事の邪魔をしない） */
const MAX_PLANT_TASKS = 2;
/** 種まき・耕し直しの仕事の期限（誰も受け持たないまま残らないように） */
const PLANT_TTL = 20 * 60;
/** 拾う物（踏み荒らしなどで落ちた作物や種） */
const PICKUP = new Set(
  CROP_IDS.flatMap((id) => {
    const c = CROPS[id];
    return c.kind === "tall" ? [c.item] : [c.item, c.seed];
  }).concat(["minecraft:melon_slice"]),
);
/** 緑の手（Lv8）のとき、作物がどこまで育った状態から始まるか */
const GREEN_GROWTH = 3;

/** 茎の向き（facing_direction）→ 実のある方向 */
/** @type {Record<number, [number, number]>} */
const FACING = { 2: [0, -1], 3: [0, 1], 4: [-1, 0], 5: [1, 0] };
const SIDES = /** @type {[number, number][]} */ ([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

// ---------------------------------------------------------------
// 見分け方
// ---------------------------------------------------------------

/** @param {Block} b */
function isMatureField(b) {
  const id = BY_BLOCK[b.typeId];
  if (!id || CROPS[id].kind !== "field") return false;
  const g = b.permutation.getState("growth");
  return typeof g === "number" && g >= 7;
}

/**
 * 茎につながった実か（飾りで置いたカボチャ・スイカは取らない）
 * @param {Dimension} dim
 * @param {Block} b
 */
function isAttachedFruit(dim, b) {
  const id = BY_BLOCK[b.typeId];
  if (!id) return false;
  const crop = CROPS[id];
  if (crop.kind !== "fruit") return false;
  for (const [dx, dz] of SIDES) {
    const s = safeBlock(dim, { x: b.x - dx, y: b.y, z: b.z - dz });
    if (!s || s.typeId !== crop.stem) continue;
    const f = FACING[Number(s.permutation.getState("facing_direction"))];
    if (f && f[0] === dx && f[1] === dz) return true;
  }
  return false;
}

/**
 * 背の高い作物（サトウキビ・竹・サボテン）の1本。根元と、刈る所（根元より上）を返す
 * @param {Dimension} dim
 * @param {Pos} p その作物のどこか
 * @returns {{ id: string, base: Pos, cut: Pos[] } | undefined}
 */
function tallAt(dim, p) {
  const b = safeBlock(dim, p);
  const id = b && BY_BLOCK[b.typeId];
  if (!b || !id) return undefined;
  const crop = CROPS[id];
  if (crop.kind !== "tall") return undefined;
  let y0 = p.y;
  while (safeBlock(dim, { x: p.x, y: y0 - 1, z: p.z })?.typeId === crop.block) y0--;
  let y1 = p.y;
  while (safeBlock(dim, { x: p.x, y: y1 + 1, z: p.z })?.typeId === crop.block) y1++;
  const cut = [];
  for (let y = y0 + 1; y <= y1; y++) cut.push({ x: p.x, y, z: p.z });
  return { id, base: { x: p.x, y: y0, z: p.z }, cut };
}

/**
 * 種をまける畑か（耕した土で、上が空いている）
 * @param {Dimension} dim
 * @param {Pos} p 植える場所（畑の1つ上）
 */
function isEmptyFarmland(dim, p) {
  const b = safeBlock(dim, p);
  const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
  return !!b && !!below && b.isAir && below.typeId === "minecraft:farmland";
}

/**
 * 隣に茎がある（カボチャ・スイカの実がなる場所なので、何もまかない）
 * @param {Dimension} dim
 * @param {Pos} p
 */
function nextToStem(dim, p) {
  return SIDES.some(([dx, dz]) => {
    const t = safeBlock(dim, { x: p.x + dx, y: p.y, z: p.z + dz })?.typeId;
    return !!t && t in BY_STEM;
  });
}

/** @param {Record<string, number>} bag */
function seedCount(bag) {
  let n = 0;
  for (const k of Object.keys(BY_SEED)) n += bag[k] ?? 0;
  return n;
}

function pendingPlantTasks() {
  let n = 0;
  for (const t of tasks.values()) if (t.jobId === "farmer" && (t.data.kind === "plant" || t.data.kind === "till")) n++;
  return n;
}

/**
 * 0〜3個の種（本来の小麦・ビートルートと同じくらいの出方）
 */
function seedDrops() {
  let n = 0;
  for (let i = 0; i < 3; i++) if (Math.random() < 4 / 7) n++;
  return n;
}

/**
 * その場所にまくべき作物（茎があった場所ならその茎。それ以外は周りの畑の作物で一番多い物。周りに無ければ "any"）
 * @param {Dimension} dim
 * @param {Pos} p
 */
function wantedCrop(dim, p) {
  const stemId = stems.get(key(p));
  if (stemId) return stemId;
  /** @type {Record<string, number>} */
  const votes = {};
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const b = safeBlock(dim, { x: p.x + dx, y: p.y, z: p.z + dz });
    const id = b && BY_BLOCK[b.typeId];
    if (id && CROPS[id].kind === "field") votes[id] = (votes[id] ?? 0) + 1;
  }
  const ranked = Object.keys(votes).sort((a, b) => votes[b] - votes[a]);
  return ranked[0] ?? "any";
}

/** 村人の道具袋に入っている種 → 最後に見た tick（仕事を作るとき、種を持っている農家がいるかの目安） */
/** @type {Map<string, number>} */
const heldSeeds = new Map();

/**
 * その作物の種が手に入るか（倉庫にある・誰かの道具袋にある）
 * @param {string} seed
 */
function seedAvailable(seed) {
  if ((getStock()[seed] ?? 0) > 0) return true;
  const t = heldSeeds.get(seed);
  return t !== undefined && system.currentTick - t <= RETRY_TICKS;
}

/**
 * その作物の種（"any" はONにしている畑の作物のどれか）
 * @param {string} crop
 * @param {(id: string) => boolean} opt
 * @returns {string[]}
 */
function seedsFor(crop, opt) {
  if (crop === "any") {
    return CROP_IDS.filter((id) => CROPS[id].kind === "field" && cropOn(opt, id)).map((id) => /** @type {FieldCrop} */ (CROPS[id]).seed);
  }
  const c = CROPS[crop];
  return c && c.kind !== "tall" && cropOn(opt, crop) ? [c.seed] : [];
}

// ---------------------------------------------------------------
// 覚えておくこと
// ---------------------------------------------------------------

/** 合う種を持っていなくてまけなかった畑 → この tick までは種まきの仕事にしない（同じ畑を行き来し続けないように） */
/** @type {Map<string, number>} */
const skipUntil = new Map();
/** まけなかった畑が欲しがっている種（倉庫から持ち出す） */
/** @type {Set<string>} */
const wanted = new Set();
/** 見かけた茎の場所 → 作物の id（茎が壊れて空き畑になったら、同じ茎をまき直す） */
/** @type {Map<string, string>} */
const stems = new Map();

/** @param {Pos} p */
function skipped(p) {
  const t = skipUntil.get(key(p));
  if (t === undefined) return false;
  if (t > system.currentTick) return true;
  skipUntil.delete(key(p));
  return false;
}

// ---------------------------------------------------------------
// 収穫
// ---------------------------------------------------------------

/**
 * その場所の作物を1つ収穫する（畑の作物はその場で植え直す）
 * @param {WorkContext} ctx
 * @param {Pos} p
 * @param {string} id 作物の id
 */
function harvestAt(ctx, p, id) {
  const { e, carry, watched } = ctx;
  const dim = e.dimension;
  const b = safeBlock(dim, p);
  if (!b || BY_BLOCK[b.typeId] !== id) return false;
  const crop = CROPS[id];
  if (crop.kind === "field") {
    if (!isMatureField(b)) return false;
    let n = crop.min + Math.floor(Math.random() * (crop.max - crop.min + 1));
    if (ctx.skill("bumper") && Math.random() < 0.33) n += 1;
    const bag = ctx.bag;
    // 取れた種は、植え直し・種まきに使うので道具袋へ（いっぱいなら倉庫へ運ぶ）
    // ニンジン・ジャガイモは取れた物そのものが種なので、植え直す1つ分だけ袋を通す
    const seeds = crop.seed === crop.item ? 1 : seedDrops();
    if (crop.seed === crop.item) n -= 1;
    const toBag = Math.max(0, Math.min(seeds, BAG_MAX - seedCount(bag)));
    if (toBag > 0) bag[crop.seed] = (bag[crop.seed] ?? 0) + toBag;
    addCarry(carry, crop.seed, seeds - toBag);
    addCarry(carry, crop.item, n);
    // 植え直すときは種を1つ使う。足りなければ持ち物の種、それも無ければ空けておく
    if ((bag[crop.seed] ?? 0) > 0) bag[crop.seed] -= 1;
    else if ((carry[crop.seed] ?? 0) > 0) carry[crop.seed] -= 1;
    else {
      b.setType("minecraft:air");
      if (watched) dim.playSound("dig.grass", center(p));
      return true;
    }
    b.setPermutation(b.permutation.withState("growth", ctx.skill("green") ? GREEN_GROWTH : 0));
  } else if (crop.kind === "fruit") {
    if (!isAttachedFruit(dim, b)) return false;
    b.setType("minecraft:air");
    addCarry(carry, crop.item, 1);
  } else {
    // 根元（下が同じ作物でない所）は残す
    if (safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z })?.typeId !== crop.block) return false;
    b.setType("minecraft:air");
    addCarry(carry, crop.item, 1);
  }
  if (watched) {
    dim.playSound(crop.kind === "field" ? "dig.grass" : "dig.wood", center(p));
    lookAt(e, center(p));
  }
  return true;
}

/**
 * 一斉収穫で、その列（x, z）で刈れる所
 * @param {Dimension} dim
 * @param {number} x
 * @param {number} y 目安の高さ
 * @param {number} z
 * @param {string} id
 * @returns {Pos[]}
 */
function readyAt(dim, x, y, z, id) {
  const crop = CROPS[id];
  for (const dy of [0, 1, -1]) {
    const p = { x, y: y + dy, z };
    const b = safeBlock(dim, p);
    if (!b || BY_BLOCK[b.typeId] !== id) continue;
    if (crop.kind === "field") return isMatureField(b) ? [p] : [];
    if (crop.kind === "fruit") return isAttachedFruit(dim, b) ? [p] : [];
    const t = tallAt(dim, p);
    return t && t.cut.length + 1 >= crop.minHeight ? t.cut.reverse() : [];
  }
  return [];
}

/**
 * 特技「一斉収穫」: 次に刈る所を含む3×3（9マス）のうち、刈れる所が一番多い範囲をまとめて刈る
 * （ほかの仕事に入っている所や、段違いの所も含めて、刈れれば全部刈る）
 * @param {WorkContext} ctx
 */
function sweep(ctx) {
  const { e, task, watched } = ctx;
  const id = /** @type {string} */ (task.data.crop);
  const next = task.blocks[task.blocks.length - 1];
  if (!next) return 0;
  const dim = e.dimension;
  // 背の高い作物は根元の高さで見る
  const baseY = task.stand.y;
  const y = CROPS[id].kind === "tall" ? baseY : next.y;
  // 端を中心にすると外を空振りするので、中心をずらして一番多く刈れる所を選ぶ
  let best = { x: next.x, z: next.z, count: -1 };
  for (let cx = next.x - 1; cx <= next.x + 1; cx++) {
    for (let cz = next.z - 1; cz <= next.z + 1; cz++) {
      let count = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (readyAt(dim, cx + dx, y, cz + dz, id).length > 0) count++;
      if (count > best.count) best = { x: cx, z: cz, count };
    }
  }
  takeBlocksWhere(task, (p) => Math.abs(p.x - best.x) <= 1 && Math.abs(p.z - best.z) <= 1);
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (const p of readyAt(dim, best.x + dx, y, best.z + dz, id)) if (harvestAt(ctx, p, id)) n++;
    }
  }
  if (watched && n > 0) {
    dim.playSound("dig.grass", e.location, { volume: 1.5, pitch: 0.8 });
    ctx.wait(20);
  }
  return n;
}

// ---------------------------------------------------------------
// 種まき
// ---------------------------------------------------------------

/**
 * 空いている畑に種を1つまく
 * @param {WorkContext} ctx
 */
function plantOne(ctx) {
  const { e, task, watched, bag } = ctx;
  const p = takeBlock(task);
  if (!p) return false;
  const dim = e.dimension;
  const b = safeBlock(dim, p);
  if (!b || !ctx.opt("plant") || !isEmptyFarmland(dim, p)) return false;
  const seed = chooseSeed(dim, p, bag, ctx.opt);
  if (!seed) {
    // 合う種が無い。しばらく後回しにして、次に倉庫へ行ったときに持ち出す
    skipUntil.set(key(p), system.currentTick + RETRY_TICKS);
    return false;
  }
  const crop = CROPS[BY_SEED[seed]];
  b.setType(crop.kind === "fruit" ? crop.stem : crop.block);
  if (ctx.skill("green")) {
    const placed = safeBlock(dim, p);
    placed?.setPermutation(placed.permutation.withState("growth", GREEN_GROWTH));
  }
  bag[seed] -= 1;
  if (watched) {
    dim.playSound("use.grass", center(p));
    lookAt(e, center(p));
  }
  return true;
}

/**
 * まく種を決める
 *   茎があった場所 → 同じ茎
 *   それ以外 → 周りの畑の作物に合わせる（畑の列をぐちゃぐちゃにしない）
 * @param {Dimension} dim
 * @param {Pos} p
 * @param {Record<string, number>} bag
 * @param {(id: string) => boolean} opt
 */
function chooseSeed(dim, p, bag, opt) {
  const stemId = stems.get(key(p));
  if (stemId) {
    const crop = CROPS[stemId];
    if (crop.kind !== "fruit" || !cropOn(opt, stemId)) return undefined;
    if ((bag[crop.seed] ?? 0) > 0) return crop.seed;
    wanted.add(crop.seed);
    return undefined;
  }
  /** @type {Record<string, number>} */
  const votes = {};
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const b = safeBlock(dim, { x: p.x + dx, y: p.y, z: p.z + dz });
    const id = b && BY_BLOCK[b.typeId];
    const crop = id ? CROPS[id] : undefined;
    if (id && crop && crop.kind === "field" && cropOn(opt, id)) votes[crop.seed] = (votes[crop.seed] ?? 0) + 1;
  }
  const ranked = Object.keys(votes).sort((a, b) => votes[b] - votes[a]);
  if (ranked.length > 0) {
    // 周りにある作物の種のうち、持っている物をまく（境目では多い方から。周りに無い作物は混ぜない）
    const have = ranked.find((s) => (bag[s] ?? 0) > 0);
    if (!have) wanted.add(ranked[0]);
    return have;
  }
  // 周りに作物が無い新しい畑なら、ONにしている畑の作物の種のうち持っている物をまく
  return CROP_IDS.map((id) => CROPS[id])
    .filter((c) => c.kind === "field" && cropOn(opt, BY_BLOCK[c.block]))
    .map((c) => /** @type {FieldCrop} */ (c).seed)
    .find((s) => (bag[s] ?? 0) > 0);
}

/**
 * 踏み荒らされて土に戻った所か（上が空いていて、4方のうち3方以上が畑の土）
 * @param {Dimension} dim
 * @param {Pos} p 土の場所
 */
function isTrampled(dim, p) {
  const b = safeBlock(dim, p);
  const above = safeBlock(dim, { x: p.x, y: p.y + 1, z: p.z });
  if (!b || b.typeId !== "minecraft:dirt" || !above || !above.isAir) return false;
  let n = 0;
  for (const [dx, dz] of SIDES) if (safeBlock(dim, { x: p.x + dx, y: p.y, z: p.z + dz })?.typeId === "minecraft:farmland") n++;
  return n >= 3;
}

/**
 * 土を耕し直す
 * @param {WorkContext} ctx
 */
function tillOne(ctx) {
  const { e, task, watched } = ctx;
  const p = takeBlock(task);
  if (!p) return false;
  const dim = e.dimension;
  if (!isTrampled(dim, p)) return false;
  safeBlock(dim, p)?.setType("minecraft:farmland");
  if (watched) {
    dim.playSound("use.gravel", center(p));
    lookAt(e, center(p));
  }
  return true;
}

// ---------------------------------------------------------------
// 登録
// ---------------------------------------------------------------

registerJob({
  id: "farmer",
  name: "農家",
  skin: 1,
  pack: "農業パック",
  description:
    "作業設定でONにした作物を収穫します。畑の作物は植え直し、空いている畑には倉庫の種をまきます（新しく耕すことはしません）。カボチャ・スイカは実だけ、サトウキビ・竹・サボテンは根元を残して刈ります。",
  status: { going: "畑に向かっている", working: "農作業中", waiting: "実った作物を待っている" },
  pickup: PICKUP,
  maxTasks: 12,
  options: [
    { id: "plant", label: "空いている畑に倉庫の種をまく", default: true },
    ...CROP_IDS.map((id) => ({ id: `crop_${id}`, label: `作物：${CROPS[id].name}`, default: id === "wheat" })),
  ],
  skills: [
    { id: "bumper", level: 5, name: "豊作", description: "畑の作物で、ときどき収穫量が1つ増える（3回に1回くらい）" },
    { id: "green", level: 8, name: "緑の手", description: "植えた作物・植え直した作物が、少し育った状態から始まる" },
    { id: "sweep", level: 10, name: "一斉収穫", description: "刈る所を含む3×3（9マス）の、刈れる作物をまとめて刈り取る" },
  ],

  accepts(task, opt, bag) {
    for (const k of Object.keys(bag)) if (bag[k] > 0) heldSeeds.set(k, system.currentTick);
    if (task.data.kind === "till") return opt("plant");
    if (task.data.kind === "plant") {
      // まける種を持っている（無ければ倉庫にある）ときだけ。無ければ育つのを待つ（うろうろしない）
      if (!opt("plant")) return false;
      return seedsFor(task.data.crop, opt).some((s) => (bag[s] ?? 0) > 0 || (getStock()[s] ?? 0) > 0);
    }
    return cropOn(opt, task.data.crop);
  },

  scan(dim, top, addTask, isClaimed, opt) {
    // 背の高い作物：サトウキビは当たり判定が無いので、一番上のブロックの1つ上にあることがある
    for (const p of [{ x: top.x, y: top.y, z: top.z }, { x: top.x, y: top.y + 1, z: top.z }]) {
      const t = tallAt(dim, p);
      if (!t) continue;
      const crop = CROPS[t.id];
      if (crop.kind !== "tall" || !cropOn(opt, t.id) || t.cut.length + 1 < crop.minHeight) return;
      if (t.cut.some((c) => isClaimed(c))) return;
      // 末尾から取り出すので、上から刈るように並べる（下から刈ると上が落ちてしまう）
      addTask(t.base, t.cut, { kind: "harvest", crop: t.id });
      return;
    }

    // カボチャ・スイカの実
    const fruitId = BY_BLOCK[top.typeId];
    if (fruitId && CROPS[fruitId].kind === "fruit") {
      const p = { x: top.x, y: top.y, z: top.z };
      if (cropOn(opt, fruitId) && !isClaimed(p) && isAttachedFruit(dim, top)) addTask(p, [p], { kind: "harvest", crop: fruitId });
      return;
    }

    // 踏み荒らされて土に戻った所（3方以上が畑の土に囲まれている）→ 耕し直す
    if (top.typeId === "minecraft:dirt" && opt("plant")) {
      const p = { x: top.x, y: top.y, z: top.z };
      if (!isClaimed(p) && pendingPlantTasks() < MAX_PLANT_TASKS && isTrampled(dim, p)) {
        addTask({ x: p.x, y: p.y + 1, z: p.z }, [p], { kind: "till", ttl: PLANT_TTL });
      }
      return;
    }

    // 畑：一番上が「畑の土」の場合と「作物・茎」の場合の両方に対応する
    // （作物は当たり判定が無いので、その下の畑の土が一番上として返ることがある）
    let cropPos;
    if (top.typeId === "minecraft:farmland") cropPos = { x: top.x, y: top.y + 1, z: top.z };
    else if (top.typeId in BY_BLOCK || top.typeId in BY_STEM) cropPos = { x: top.x, y: top.y, z: top.z };
    else return;
    if (isClaimed(cropPos)) return;
    const here = safeBlock(dim, cropPos);
    if (!here) return;

    // 茎は覚えておく（壊れたらまき直す）
    if (here.typeId in BY_STEM) {
      stems.set(key(cropPos), BY_STEM[here.typeId]);
      return;
    }

    // 実った作物 → 収穫（周り5×5の、同じ作物の実った物をまとめて1つの仕事に）
    if (isMatureField(here)) {
      const id = BY_BLOCK[here.typeId];
      if (!cropOn(opt, id)) return;
      const blocks = [];
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const p = { x: cropPos.x + dx, y: cropPos.y, z: cropPos.z + dz };
          if (isClaimed(p)) continue;
          const b = safeBlock(dim, p);
          if (b && b.typeId === here.typeId && isMatureField(b)) blocks.push(p);
        }
      }
      // 末尾から取り出すので、近い順になるよう並べる
      blocks.sort((a, b) => dist2(b, cropPos) - dist2(a, cropPos));
      addTask(cropPos, blocks, { kind: "harvest", crop: id });
      return;
    }

    // 何も植わっていない畑 → 種まき（茎の隣は実がなる場所なので空けておく。ただし茎があった場所はまき直す）
    if (!opt("plant") || !here.isAir || skipped(cropPos) || pendingPlantTasks() >= MAX_PLANT_TASKS) return;
    // まく作物をONにしている農家がいて、その種が手に入るときだけ仕事にする
    const crop = wantedCrop(dim, cropPos);
    if (!seedsFor(crop, opt).some(seedAvailable)) return;
    /** @param {Pos} p */
    const plantable = (p) =>
      !isClaimed(p) && !skipped(p) && isEmptyFarmland(dim, p) && (stems.has(key(p)) || !nextToStem(dim, p));
    if (!plantable(cropPos)) return;
    const blocks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const p = { x: cropPos.x + dx, y: cropPos.y, z: cropPos.z + dz };
        if (plantable(p)) blocks.push(p);
      }
    }
    blocks.sort((a, b) => dist2(b, cropPos) - dist2(a, cropPos));
    addTask(cropPos, blocks, { kind: "plant", crop, ttl: PLANT_TTL });
  },

  work(ctx) {
    const { task } = ctx;
    if (task.data.kind === "plant") return plantOne(ctx);
    if (task.data.kind === "till") return tillOne(ctx);
    if (ctx.skill("sweep")) return sweep(ctx);
    const p = takeBlock(task);
    return p ? harvestAt(ctx, p, task.data.crop) : false;
  },

  // 倉庫から種を持ち出す（ONにしている作物の分だけ）
  onStorage(e, source, bag, opt) {
    // ONにしていない作物の種は倉庫に戻す
    for (const s of Object.keys(bag)) {
      const id = BY_SEED[s];
      if (id && !cropOn(opt, id) && bag[s] > 0) bag[s] -= source.put(s, bag[s]);
    }
    if (!opt("plant")) return;
    const seeds = CROP_IDS.map((id) => CROPS[id])
      .filter((c) => c.kind !== "tall" && cropOn(opt, BY_BLOCK[c.block]))
      .map((c) => /** @type {FieldCrop | FruitCrop} */ (c).seed);
    // まけなかった畑が欲しがっている種を先に持ち出す
    const order = [...[...wanted].filter((s) => seeds.includes(s)), ...seeds.filter((s) => !wanted.has(s))];
    wanted.clear();
    for (const seed of order) {
      const isFood = seed === "minecraft:carrot" || seed === "minecraft:potato";
      const room = BAG_MAX - seedCount(bag);
      const limit = isFood ? Math.min(room, FOOD_SEED_MAX - (bag[seed] ?? 0)) : room;
      if (limit <= 0) continue;
      const got = source.take(seed, limit);
      if (got > 0) bag[seed] = (bag[seed] ?? 0) + got;
    }
  },

  needsSupply(e, bag, opt) {
    if (!opt("plant")) return false;
    // 種が切れた、または畑が欲しがっている種を持っていない（倉庫にあるときだけ取りに行く）
    const stock = getStock();
    const inStock = (/** @type {string} */ s) => (stock[s] ?? 0) > 0 && cropOn(opt, BY_SEED[s]);
    if (seedCount(bag) === 0 && pendingPlantTasks() > 0 && Object.keys(BY_SEED).some(inStock)) return true;
    return [...wanted].some((s) => (bag[s] ?? 0) === 0 && inStock(s));
  },
});
