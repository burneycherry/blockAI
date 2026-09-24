// AI村人（人間の姿）の見た目を生成する
//   - モデル: ふつう / ほっそり / マッチョ の3体型（プレイヤーと同じ64x64の着せ替え配置）
//   - テクスチャ: キャラクター（core/characters.js）× 衣装（職業）の組み合わせを全部書き出す
//   - クライアント側のエンティティ定義・描画・アニメーションもここで作る
// 使い方: node tools/gen-humans.mjs        （書き出し）
//         node tools/gen-humans.mjs --check（最新かどうかだけ確認）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CHARACTERS } from "../packs/BP/scripts/core/characters.js";
import { encodePng } from "./png.mjs";

const check = process.argv.includes("--check");
let stale = 0;

/**
 * @param {string} path
 * @param {string | Buffer} data
 */
function write(path, data) {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  let old;
  try {
    old = readFileSync(path);
  } catch (e) {
    old = undefined;
  }
  if (old && old.equals(buf)) return;
  if (check) {
    console.error(`NG: ${path} が古いです。node tools/gen-humans.mjs を実行してください`);
    stale++;
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}
/** @param {string} path @param {any} obj */
const writeJson = (path, obj) => write(path, JSON.stringify(obj, null, 2) + "\n");

// ---------------------------------------------------------------
// 色の道具
// ---------------------------------------------------------------
/** @typedef {number[]} Color */
/** @param {Color} c @param {number} k */
const mul = (c, k) => [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(c[i] * k))));
/** @param {Color} a @param {Color} b @param {number} t */
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t));
/** 同じ場所なら毎回同じになる、わずかな色むら */
const grain = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) => {
  const h = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453;
  return 0.94 + (h - Math.floor(h)) * 0.1;
};

// ---------------------------------------------------------------
// 64x64 の画像と、体の部位（プレイヤーのスキンと同じ配置）
// ---------------------------------------------------------------
class Img {
  constructor() {
    this.px = new Uint8Array(64 * 64 * 4);
  }
  /** @param {number} x @param {number} y @param {Color | null | undefined} c */
  set(x, y, c) {
    if (!c) return;
    const i = (y * 64 + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = c.length > 3 ? c[3] : 255;
  }
  /** @param {number} x @param {number} y */
  clear(x, y) {
    this.px.fill(0, (y * 64 + x) * 4, (y * 64 + x) * 4 + 4);
  }
}

/** @typedef {"top"|"bottom"|"right"|"front"|"left"|"back"} Face */
/** @typedef {(f: Face, x: number, y: number, W: number, H: number, side: number) => (Color | null | undefined)} PaintFn */

/** @param {boolean} slim */
function parts(slim) {
  const aw = slim ? 3 : 4;
  return {
    head: [0, 0, 8, 8, 8],
    hat: [32, 0, 8, 8, 8],
    body: [16, 16, 8, 12, 4],
    jacket: [16, 32, 8, 12, 4],
    rarm: [40, 16, aw, 12, 4],
    rsleeve: [40, 32, aw, 12, 4],
    larm: [32, 48, aw, 12, 4],
    lsleeve: [48, 48, aw, 12, 4],
    rleg: [0, 16, 4, 12, 4],
    rpants: [0, 32, 4, 12, 4],
    lleg: [16, 48, 4, 12, 4],
    lpants: [0, 48, 4, 12, 4],
  };
}

/**
 * 部位の各面を塗る。side は横の面で「前からの距離」（0 = 一番前）
 * @param {Img} img
 * @param {number[]} part
 * @param {PaintFn} fn
 */
function paint(img, part, fn) {
  const [u, v, w, h, d] = part;
  /** @type {[Face, number, number, number, number][]} */
  const faces = [
    ["top", u + d, v, w, d],
    ["bottom", u + d + w, v, w, d],
    ["right", u, v + d, d, h],
    ["front", u + d, v + d, w, h],
    ["left", u + d + w, v + d, d, h],
    ["back", u + 2 * d + w, v + d, w, h],
  ];
  for (const [f, x0, y0, W, H] of faces) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const side = f === "right" ? W - 1 - x : x;
        const c = fn(f, x, y, W, H, side);
        if (c) img.set(x0 + x, y0 + y, c);
      }
    }
  }
}

// 道具やつばの色（顔の左上の、使われていない場所に置く。モデルの道具はここを参照する）
const SWATCH = {
  wood: [0, 0, [128, 90, 52]],
  woodDark: [1, 0, [92, 62, 36]],
  iron: [2, 0, [205, 205, 210]],
  ironDark: [3, 0, [140, 142, 150]],
  straw: [4, 0, [222, 192, 112]],
  strawDark: [5, 0, [186, 152, 80]],
  edge: [6, 0, [236, 238, 242]],
};

// ---------------------------------------------------------------
// キャラクター（肌・顔・髪）
// ---------------------------------------------------------------
/**
 * @param {Img} img
 * @param {import("../packs/BP/scripts/core/characters.js").Character} ch
 * @param {number} seed
 */
function drawCharacter(img, ch, seed) {
  const P = parts(ch.build === 1);
  const skin = ch.skin;
  const female = ch.gender === "f";
  /** @type {PaintFn} */
  const skinFn = (f, x, y) => mul(skin, (f === "bottom" ? 0.85 : f === "top" ? 1.02 : 1) * grain(x, y, seed));
  for (const k of ["head", "body", "rarm", "larm", "rleg", "lleg"]) paint(img, P[k], skinFn);

  // 顔
  const eyeWhite = [245, 245, 245];
  const brow = ch.style === "bald" ? mul(skin, 0.6) : mul(ch.hair, 0.85);
  // 女性はアニメ風の顔（大きな瞳・ハイライト・まつげ・小さな口・ほっぺ）
  const irisDark = mul(ch.eyes, 0.55);
  const irisLight = mix(ch.eyes, [255, 255, 255], 0.35);
  if (female) {
    paint(img, P.head, (f, x, y) => {
      if (f !== "front") return null;
      if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return [42, 30, 34];
      if (y === 3 && (x === 0 || x === 7)) return null;
      if (y === 4 && (x === 1 || x === 6)) return x === 1 ? [255, 255, 255] : irisDark;
      if (y === 4 && (x === 2 || x === 5)) return x === 2 ? irisDark : [255, 255, 255];
      if (y === 5 && (x === 1 || x === 2 || x === 5 || x === 6)) return x === 1 || x === 6 ? ch.eyes : irisLight;
      if (y === 6 && (x === 1 || x === 6)) return mix(skin, [245, 120, 135], 0.4);
      if (y === 6 && x === 4) return [205, 110, 115];
      return null;
    });
  }
  paint(img, P.head, (f, x, y) => {
    if (f !== "front" || female) return null;
    if (y === 4 && (x === 1 || x === 6)) return eyeWhite;
    if (y === 4 && (x === 2 || x === 5)) return ch.eyes;
    if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return female && (x === 2 || x === 5) ? null : brow;
    if (y === 3 && female && (x === 1 || x === 6)) return [40, 30, 30];
    if (y === 5 && (x === 3 || x === 4)) return mul(skin, 0.88);
    if (y === 6 && (x === 3 || x === 4)) return female ? [196, 96, 100] : mul(skin, 0.68);
    if (female && y === 5 && (x === 1 || x === 6)) return mix(skin, [240, 120, 130], 0.35);
    return null;
  });

  // ひげ
  if (ch.beard) {
    const b = ch.beard;
    const bc = mul(ch.hair, 0.95);
    paint(img, P.head, (f, x, y, W, H, side) => {
      if (f === "front") {
        if (b === "mustache") return y === 5 && x >= 2 && x <= 5 ? bc : null;
        if (y === 6 && (x === 3 || x === 4)) return b === "full" ? mul(skin, 0.55) : null;
        if (y >= 5 && !(y === 5 && x >= 3 && x <= 4 && b === "full")) return b === "stubble" ? mix(skin, bc, 0.45) : bc;
        if (b === "full" && y === 5 && x >= 2 && x <= 5) return bc;
        return null;
      }
      if ((f === "right" || f === "left") && y >= 5 && side <= 3) return b === "stubble" ? mix(skin, bc, 0.45) : bc;
      if (f === "bottom" && b === "full") return bc;
      return null;
    });
  }

  // 髪（頭の面）
  const hair = ch.hair;
  const hc = (/** @type {number} */ x, /** @type {number} */ y) => mul(hair, grain(x, y, seed + 7));
  const st = ch.style;
  paint(img, P.head, (f, x, y, W, H, side) => {
    if (st === "bald") return f === "back" && y >= 3 && y <= 4 && ch.hair[0] > 120 ? hc(x, y) : null;
    if (st === "buzz") {
      const c = mix(skin, hair, 0.75);
      if (f === "top") return c;
      if (f === "front") return y === 0 ? c : null;
      if (f === "right" || f === "left") return y <= 2 && side >= 1 ? c : y <= 1 ? c : null;
      if (f === "back") return y <= 3 ? c : null;
      return null;
    }
    if (f === "top") return hc(x, y);
    if (f === "bottom") return null;
    const longish = st === "long" || st === "bob";
    if (f === "front") {
      if (y <= 1) return hc(x, y);
      if (y === 2 && (x === 0 || x === 7)) return hc(x, y);
      if (st === "spiky" && y === 2 && (x === 2 || x === 5)) return hc(x, y);
      if (st === "long" && (x === 0 || x === 7)) return hc(x, y);
      if (st === "bob" && (x === 0 || x === 7) && y <= 5) return hc(x, y);
      return null;
    }
    if (f === "right" || f === "left") {
      if (st === "long") return hc(x, y);
      if (st === "bob") return y <= 5 ? hc(x, y) : null;
      if (y <= 2) return hc(x, y);
      if (y <= 4 && side >= 2) return hc(x, y);
      return null;
    }
    // 後ろ
    if (longish || st === "bun") return y <= (st === "bob" ? 6 : 7) ? hc(x, y) : null;
    return y <= 5 ? hc(x, y) : null;
  });
}

/**
 * 服の上に重なる髪（ポニーテール・長い髪・お団子など）
 * @param {Img} img
 * @param {import("../packs/BP/scripts/core/characters.js").Character} ch
 * @param {number} seed
 */
function drawHairOuter(img, ch, seed) {
  const P = parts(ch.build === 1);
  const hc = (/** @type {number} */ x, /** @type {number} */ y) => mul(ch.hair, grain(x, y, seed + 11) * 1.05);
  const st = ch.style;
  if (st === "spiky") {
    paint(img, P.hat, (f, x, y) => (f === "front" && y === 0 && x % 2 === 0) || (f === "top" && (x + y) % 3 === 0) ? hc(x, y) : null);
  }
  if (st === "bob") {
    paint(img, P.hat, (f, x, y) => ((f === "right" || f === "left" || f === "back") && y >= 3 && y <= 6) ? hc(x, y) : null);
  }
  if (st === "long") {
    paint(img, P.hat, (f, x, y) => (f === "back" || f === "right" || f === "left") && y >= 2 ? hc(x, y) : null);
    paint(img, P.jacket, (f, x, y) => (f === "back" && y <= 5 - (x === 0 || x === 7 ? 2 : 0)) ? hc(x, y) : null);
  }
  if (st === "ponytail" || st === "tied") {
    const len = st === "tied" ? 2 : 5;
    paint(img, P.hat, (f, x, y) => (f === "back" && (x === 3 || x === 4) && y >= 4 ? hc(x, y) : null));
    paint(img, P.jacket, (f, x, y) => (f === "back" && (x === 3 || x === 4) && y < len ? hc(x, y) : null));
  }
  if (st === "bun") {
    paint(img, P.hat, (f, x, y) => {
      if (f === "top" && x >= 2 && x <= 5 && y >= 4 && y <= 7) return mul(hc(x, y), 0.9);
      if (f === "back" && x >= 2 && x <= 5 && y <= 2) return mul(hc(x, y), 0.9);
      return null;
    });
  }
}

// ---------------------------------------------------------------
// 衣装（職業ごと）。registry の skin 番号がこの並び順
// ---------------------------------------------------------------
/**
 * @typedef {{
 *   id: string,
 *   clothes: (img: Img, ch: import("../packs/BP/scripts/core/characters.js").Character, seed: number) => void,
 *   headwear?: (img: Img, ch: import("../packs/BP/scripts/core/characters.js").Character, seed: number) => void
 * }} Outfit
 */

/** 腕の袖: 上から rows 段が服、残りは肌（手首は hands 段） */
const sleeve = (/** @type {Color} */ cloth, /** @type {number} */ rows) => /** @type {PaintFn} */ ((f, x, y) =>
  f === "bottom" ? null : f === "top" ? cloth : y < rows ? cloth : null);

/** @type {Outfit[]} */
const OUTFITS = [
  {
    // 0: 普段着（無職）。キャラクターの好きな色のシャツ
    id: "casual",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const shirt = ch.cloth;
      const g = (/** @type {Color} */ c, /** @type {number} */ x, /** @type {number} */ y) => mul(c, grain(x, y, seed + 3));
      paint(img, P.body, (f, x, y) => {
        if (f === "front" && y === 0 && (x === 3 || x === 4)) return null;
        if (y === 11 && f !== "top") return [90, 62, 38];
        return g(shirt, x, y);
      });
      for (const k of ["rarm", "larm"]) paint(img, P[k], sleeve(shirt, 4));
      const female = ch.gender === "f";
      const pants = female ? mul(shirt, 0.6) : [74, 64, 52];
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], (f, x, y) => {
          if (f === "bottom" || y === 11) return [48, 36, 28];
          if (female && y >= 8) return null;
          return g(pants, x, y);
        });
      }
      if (female) for (const k of ["rpants", "lpants"]) paint(img, P[k], (f, x, y) => (f !== "top" && f !== "bottom" && y <= 7 ? g(pants, x, y) : null));
    },
  },
  {
    // 1: 農家。麦わら帽子・生成りのシャツ・青いオーバーオール・長靴
    id: "farmer",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const shirt = [232, 222, 196];
      const denim = [66, 96, 154];
      const g = (/** @type {Color} */ c, /** @type {number} */ x, /** @type {number} */ y) => mul(c, grain(x, y, seed + 5));
      const check = (/** @type {number} */ x, /** @type {number} */ y) => (x % 3 === 0 || y % 3 === 0 ? mul(shirt, 0.86) : shirt);
      paint(img, P.body, (f, x, y) => {
        if (f === "front" && y === 0 && (x === 3 || x === 4)) return null;
        const bib = f === "front" && y <= 3 && x >= 2 && x <= 5;
        const strap = (f === "front" || f === "back") && y <= 3 && (x === 2 || x === 5);
        if (f === "front" && y === 3 && (x === 2 || x === 5)) return [220, 180, 60];
        if (y >= 4 || bib || strap) return g(denim, x, y);
        return check(x, y);
      });
      for (const k of ["rarm", "larm"]) paint(img, P[k], (f, x, y) => (f === "bottom" ? null : y < 6 || f === "top" ? check(x, y) : null));
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], (f, x, y) => {
          if (f === "bottom" || y >= 9) return g([96, 70, 40], x, y);
          return g(denim, x, y);
        });
      }
    },
    headwear(img, ch, seed) {
      const P = parts(ch.build === 1);
      const straw = (/** @type {number} */ x, /** @type {number} */ y) => ((x + y) % 2 === 0 ? SWATCH.straw[2] : mul(SWATCH.straw[2], 0.9));
      paint(img, P.hat, (f, x, y) => {
        if (f === "top") return straw(x, y);
        if (f === "bottom") return null;
        if (y === 0) return straw(x, y);
        if (y === 1) return [160, 60, 44];
        return null;
      });
    },
  },
  {
    // 2: 木こり。赤黒のチェックのネルシャツ・ジーンズ・革のブーツ・ニット帽
    id: "lumberjack",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const red = [176, 38, 36];
      const g = (/** @type {Color} */ c, /** @type {number} */ x, /** @type {number} */ y) => mul(c, grain(x, y, seed + 9));
      const plaid = (/** @type {number} */ x, /** @type {number} */ y) => {
        const a = Math.floor(x / 2) % 2 === 0;
        const b = Math.floor(y / 2) % 2 === 0;
        if (a && b) return [36, 26, 26];
        if (a || b) return mul(red, 0.62);
        return red;
      };
      paint(img, P.body, (f, x, y) => {
        if (f === "front" && y <= 1 && (x === 3 || x === 4)) return y === 0 ? null : [200, 190, 170];
        if (y === 11 && f !== "top") return f === "front" && (x === 3 || x === 4) ? [190, 170, 90] : [70, 44, 26];
        if (f === "front" && (x === 3 || x === 4) && y % 3 === 1) return [200, 190, 170];
        return plaid(x, y);
      });
      for (const k of ["rarm", "larm"]) {
        paint(img, P[k], (f, x, y) => {
          if (f === "bottom") return [120, 80, 46];
          if (y >= 11) return [120, 80, 46];
          return plaid(x + (k === "larm" ? 1 : 0), y);
        });
      }
      const jeans = [58, 78, 122];
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], (f, x, y) => {
          if (f === "bottom" || y >= 10) return g([72, 46, 26], x, y);
          if (y === 9) return mul(jeans, 1.25);
          return g(jeans, x, y);
        });
      }
    },
    headwear(img, ch, seed) {
      const P = parts(ch.build === 1);
      const knit = [150, 34, 36];
      paint(img, P.hat, (f, x, y) => {
        if (f === "top") return (x + y) % 2 === 0 ? knit : mul(knit, 0.85);
        if (f === "bottom") return null;
        if (y <= 1) return x % 2 === 0 ? knit : mul(knit, 0.85);
        if (y === 2) return mul(knit, 0.7);
        return null;
      });
    },
  },
];

// ---------------------------------------------------------------
// テクスチャを書き出す
// ---------------------------------------------------------------
const TEX_DIR = "textures/entity/blockai/human";
/** @type {string[]} */
const texKeys = [];
/** @type {Record<string, string>} */
const texMap = {};
CHARACTERS.forEach((ch, ci) => {
  OUTFITS.forEach((o, oi) => {
    const img = new Img();
    drawCharacter(img, ch, ci * 13 + 1);
    o.clothes(img, ch, ci * 13 + 1);
    drawHairOuter(img, ch, ci * 13 + 1);
    o.headwear?.(img, ch, ci * 13 + 1);
    for (const [x, y, c] of Object.values(SWATCH)) img.set(/** @type {number} */ (x), /** @type {number} */ (y), /** @type {Color} */ (c));
    const key = `c${ci}_${o.id}`;
    texKeys.push(key);
    texMap[key] = `${TEX_DIR}/${key}`;
    write(`packs/RP/${TEX_DIR}/${key}.png`, encodePng(64, 64, img.px));
  });
});

// ---------------------------------------------------------------
// モデル（3体型）
// ---------------------------------------------------------------
/** 1ピクセルの色を全部の面に貼る @param {keyof typeof SWATCH} name */
const solid = (name) => {
  const [x, y] = SWATCH[name];
  const f = { uv: [x, y], uv_size: [1, 1] };
  return { north: f, south: f, east: f, west: f, up: f, down: f };
};

/**
 * @param {string} id
 * @param {{ slim?: boolean, bulk?: number }} opt
 */
function human(id, { slim = false, bulk = 0 }) {
  const aw = slim ? 3 : 4;
  const b = bulk; // マッチョは体と腕を膨らませ、腕を外へずらす
  // ほっそりは、胴・腕・脚をアニメーション（animation.blockai.human.slim）で細くするので、
  // 細くなった後の位置に腕と脚を置いておく
  const armX = slim ? 4.2 : 4 + aw / 2 + b * 1.6; // 腕の中心
  const legX = slim ? 1.5 : 1.9; // 脚の中心
  const box = (/** @type {number[]} */ origin, /** @type {number[]} */ size, /** @type {number[]} */ uv, inflate = 0) =>
    inflate ? { origin, size, uv, inflate } : { origin, size, uv };
  /** 手に持つ道具（柄を前に向け、先を少し上げて持つ） @param {string} name @param {any[]} cubes */
  const tool = (name, cubes) => ({ name, parent: "rightArm", pivot: [-armX, 12.5, 0], rotation: [-20, 0, 0], cubes });
  const hx = -armX;
  return {
    description: {
      identifier: id,
      texture_width: 64,
      texture_height: 64,
      visible_bounds_width: 3,
      visible_bounds_height: 3,
      visible_bounds_offset: [0, 1.5, 0],
    },
    bones: [
      { name: "root", pivot: [0, 16, 0] },
      { name: "waist", parent: "root", pivot: [0, 12, 0] },
      { name: "body", parent: "waist", pivot: [0, 24, 0] },
      {
        name: "torso",
        parent: "body",
        pivot: [0, 24, 0],
        cubes: [box([-4, 12, -2], [8, 12, 4], [16, 16], b), box([-4, 12, -2], [8, 12, 4], [16, 32], b + 0.25)],
      },
      {
        name: "head",
        parent: "body",
        pivot: [0, 24, 0],
        cubes: [box([-4, 24, -4], [8, 8, 8], [0, 0]), box([-4, 24, -4], [8, 8, 8], [32, 0], 0.5)],
      },
      {
        name: "brim",
        parent: "head",
        pivot: [0, 24, 0],
        cubes: [{ origin: [-5.6, 29.6, -5.6], size: [11.2, 0.4, 11.2], uv: solid("straw") }],
      },
      {
        name: "rightArm",
        parent: "body",
        pivot: [-armX, 22, 0],
        cubes: [
          box([-armX - aw / 2, 12, -2], [aw, 12, 4], [40, 16], b),
          box([-armX - aw / 2, 12, -2], [aw, 12, 4], [40, 32], b + 0.25),
        ],
      },
      tool("tool_axe", [
        { origin: [hx - 0.5, 12, -12], size: [1, 1, 14], uv: solid("wood") },
        { origin: [hx - 0.7, 11.8, -11.4], size: [1.4, 1.4, 2], uv: solid("ironDark") },
        { origin: [hx - 0.5, 9.5, -11.6], size: [1, 2.5, 2.4], uv: solid("iron") },
        { origin: [hx - 0.5, 7.8, -12.2], size: [1, 1.7, 3.6], uv: solid("iron") },
        { origin: [hx - 0.5, 7.5, -12.2], size: [1, 0.3, 3.6], uv: solid("edge") },
      ]),
      tool("tool_hoe", [
        { origin: [hx - 0.5, 12, -12], size: [1, 1, 14], uv: solid("wood") },
        { origin: [hx - 0.6, 11.3, -12.1], size: [1.2, 1.4, 1.2], uv: solid("ironDark") },
        { origin: [hx - 1.4, 8.6, -12.0], size: [2.8, 2.7, 0.6], uv: solid("iron") },
        { origin: [hx - 1.4, 8.3, -12.0], size: [2.8, 0.3, 0.6], uv: solid("edge") },
      ]),
      {
        name: "leftArm",
        parent: "body",
        pivot: [armX, 22, 0],
        cubes: [
          box([armX - aw / 2, 12, -2], [aw, 12, 4], [32, 48], b),
          box([armX - aw / 2, 12, -2], [aw, 12, 4], [48, 48], b + 0.25),
        ],
      },
      {
        name: "rightLeg",
        parent: "waist",
        pivot: [-legX, 12, 0],
        cubes: [
          box([-legX - 2, 0, -2], [4, 12, 4], [0, 16], b * 0.4),
          box([-legX - 2, 0, -2], [4, 12, 4], [0, 32], b * 0.4 + 0.25),
        ],
      },
      {
        name: "leftLeg",
        parent: "waist",
        pivot: [legX, 12, 0],
        cubes: [
          box([legX - 2, 0, -2], [4, 12, 4], [16, 48], b * 0.4),
          box([legX - 2, 0, -2], [4, 12, 4], [0, 48], b * 0.4 + 0.25),
        ],
      },
    ],
  };
}

writeJson("packs/RP/models/entity/human.geo.json", {
  format_version: "1.12.0",
  "minecraft:geometry": [
    human("geometry.blockai.human_wide", {}),
    human("geometry.blockai.human_slim", { slim: true }),
    human("geometry.blockai.human_macho", { bulk: 0.6 }),
  ],
});

// ---------------------------------------------------------------
// アニメーション
// ---------------------------------------------------------------
writeJson("packs/RP/animations/human.animation.json", {
  format_version: "1.8.0",
  animations: {
    "animation.blockai.human.look": {
      loop: true,
      bones: { head: { relative_to: { rotation: "entity" }, rotation: ["query.target_x_rotation", "query.target_y_rotation", 0] } },
    },
    "animation.blockai.human.walk": {
      loop: true,
      bones: {
        rightArm: { rotation: ["-v.tcos0", 0, "2.5 + math.sin(query.life_time * 80) * 1.5"] },
        leftArm: { rotation: ["v.tcos0", 0, "-2.5 - math.sin(query.life_time * 80) * 1.5"] },
        rightLeg: { rotation: ["v.tcos0 * 1.4", 0, 0] },
        leftLeg: { rotation: ["v.tcos0 * -1.4", 0, 0] },
      },
    },
    // 作業（斧を振る・鍬を振る）。スクリプトの playAnimation で再生する
    "animation.blockai.human.swing": {
      animation_length: 0.45,
      bones: {
        rightArm: {
          rotation: {
            "0.0": [0, 0, 0],
            "0.12": [-125, 0, -8],
            "0.3": [-25, 0, 0],
            "0.45": [0, 0, 0],
          },
        },
        body: { rotation: { "0.0": [0, 0, 0], "0.12": [0, -12, 0], "0.3": [0, 8, 0], "0.45": [0, 0, 0] } },
      },
    },
    // ほっそり体型：胴・腕・脚を細くし、頭を少し大きく（アニメ風）
    "animation.blockai.human.slim": {
      loop: true,
      bones: {
        torso: { scale: [0.75, 1, 0.8] },
        rightArm: { scale: [0.8, 1, 0.8] },
        leftArm: { scale: [0.8, 1, 0.8] },
        rightLeg: { scale: [0.75, 1, 0.8] },
        leftLeg: { scale: [0.75, 1, 0.8] },
        head: { scale: 1.08 },
      },
    },
    // ベッドで寝る（体の中心を軸に横にする）
    "animation.blockai.human.sleep": {
      loop: true,
      bones: {
        root: { rotation: [-90, 0, 0], position: [0, -14, 0] },
        head: { rotation: [0, 0, 0] },
      },
    },
  },
});

// ---------------------------------------------------------------
// 描画の設定とクライアント側のエンティティ
// ---------------------------------------------------------------
const N = OUTFITS.length;
writeJson("packs/RP/render_controllers/villager.render_controllers.json", {
  format_version: "1.8.0",
  render_controllers: {
    "controller.render.blockai_human": {
      arrays: {
        textures: { "Array.skins": texKeys.map((k) => `Texture.${k}`) },
        geometries: { "Array.geos": ["Geometry.wide", "Geometry.slim", "Geometry.macho"] },
      },
      geometry: "Array.geos[v.build]",
      materials: [{ "*": "Material.default" }],
      textures: [`Array.skins[v.char * ${N} + (v.outfit < ${N} ? v.outfit : 0)]`],
      part_visibility: [
        { "*": true },
        { tool_axe: `v.outfit == ${OUTFITS.findIndex((o) => o.id === "lumberjack")} && !v.sleep` },
        { tool_hoe: `v.outfit == ${OUTFITS.findIndex((o) => o.id === "farmer")} && !v.sleep` },
        { brim: `v.outfit == ${OUTFITS.findIndex((o) => o.id === "farmer")}` },
      ],
    },
    // 見えないマーカー用（何も描かない）
    "controller.render.blockai_invisible": {
      geometry: "Geometry.default",
      materials: [{ "*": "Material.default" }],
      textures: ["Texture.default"],
      part_visibility: [{ "*": false }],
    },
  },
});

const prop = (/** @type {string} */ name, def = "0") => `query.has_property('blockai:${name}') ? query.property('blockai:${name}') : ${def}`;
writeJson("packs/RP/entity/villager.entity.json", {
  format_version: "1.10.0",
  "minecraft:client_entity": {
    description: {
      identifier: "blockai:villager",
      materials: { default: "entity_alphatest" },
      textures: texMap,
      geometry: {
        wide: "geometry.blockai.human_wide",
        slim: "geometry.blockai.human_slim",
        macho: "geometry.blockai.human_macho",
      },
      scripts: {
        scale: `(${prop("build")}) == 2 ? 1.0 : ((${prop("build")}) == 1 ? 0.9 : 0.9375)`,
        pre_animation: [
          `v.char = ${prop("char")};`,
          `v.build = ${prop("build")};`,
          `v.outfit = ${prop("job")};`,
          `v.sleep = (${prop("pose")}) == 1;`,
          "v.tcos0 = math.cos(query.modified_distance_moved * 38.17) * math.min(query.modified_move_speed, 1.0) * 57.3;",
        ],
        animate: [{ look: "!v.sleep" }, { walk: "!v.sleep" }, { sleep: "v.sleep" }, { slim: "v.build == 1" }],
      },
      animations: {
        look: "animation.blockai.human.look",
        walk: "animation.blockai.human.walk",
        sleep: "animation.blockai.human.sleep",
        swing: "animation.blockai.human.swing",
        slim: "animation.blockai.human.slim",
      },
      render_controllers: ["controller.render.blockai_human"],
      spawn_egg: { base_color: "#56a152", overlay_color: "#f2c14e" },
    },
  },
});

if (check && stale > 0) process.exit(1);
if (!check) console.log(`humans: ${CHARACTERS.length} characters x ${N} outfits`);
