// 村人（人間の姿）の絵を描く部品。tools/gen-humans.mjs から使う
// 画風：リアル寄りの陰影付きドット絵。プレイヤーのスキンと同じ配置を 2 倍の細かさ（128x128）で描く
//   （モデルの UV は 64x64 のままでよい。ゲームが自動で合わせる）

/** @typedef {number[]} Color */
/** @typedef {import("../packs/BP/scripts/core/characters.js").Character} Character */

/** 64x64 配置の何倍で描くか */
export const RES = 2;
export const SIZE = 64 * RES;

// ---------------------------------------------------------------
// 色の道具
// ---------------------------------------------------------------
const clamp = (/** @type {number} */ v) => Math.max(0, Math.min(255, Math.round(v)));
/** @param {Color} c @param {number} k */
export const mul = (c, k) => [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)];
/** @param {Color} a @param {Color} b @param {number} t */
export const mix = (a, b, t) => [0, 1, 2].map((i) => clamp(a[i] * (1 - t) + b[i] * t));
const WHITE = [255, 255, 255];
/** 同じ入力なら毎回同じになる 0〜1 の乱数 @param {number[]} n */
export const hash = (...n) => {
  let h = 0;
  for (const v of n) h = Math.sin(h * 1.7 + v * 12.9898 + 78.233) * 43758.5453;
  return h - Math.floor(h);
};
/**
 * 明るさ t（0 = 一番暗い・0.5 = 元の色・1 = 一番明るい）で色を選ぶ
 * @param {Color} c
 * @param {number} t
 */
const tone = (c, t) => {
  const tt = Math.max(0, Math.min(1, t));
  return tt < 0.5 ? mix(mul(c, 0.5), c, tt * 2) : mix(c, mix(c, WHITE, 0.4), (tt - 0.5) * 2);
};

/** 面ごとの明るさ（上から光が当たる） */
const FACE_LIGHT = { top: 1.06, front: 1.0, right: 0.86, left: 0.86, back: 0.9, bottom: 0.7 };

// ---------------------------------------------------------------
// 画像と、体の部位（プレイヤーのスキンと同じ配置 × RES）
// ---------------------------------------------------------------
export class Img {
  constructor() {
    this.px = new Uint8Array(SIZE * SIZE * 4);
  }
  /** @param {number} x @param {number} y @param {Color | null | undefined} c */
  set(x, y, c) {
    if (!c) return;
    const i = (y * SIZE + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = 255;
  }
}

/** @typedef {"top"|"bottom"|"right"|"front"|"left"|"back"} Face */
/** side: 横の面で「前からの距離」（0 = 一番前） */
/** @typedef {(f: Face, x: number, y: number, W: number, H: number, side: number) => (Color | null | undefined)} PaintFn */

/** @param {boolean} slim */
export function parts(slim) {
  const aw = slim ? 3 : 4;
  /** @type {Record<string, number[]>} */
  const p = {
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
  for (const k of Object.keys(p)) p[k] = p[k].map((n) => n * RES);
  return p;
}

/**
 * 部位の各面を塗る
 * @param {Img} img
 * @param {number[]} part
 * @param {PaintFn} fn
 */
export function paint(img, part, fn) {
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

/**
 * 布の陰影（上が明るく下が暗い・縦のしわ・端の影・細かいむら）
 * @param {Color} base
 * @param {Face} f
 * @param {number} x
 * @param {number} y
 * @param {number} W
 * @param {number} H
 * @param {number} seed
 */
function cloth(base, f, x, y, W, H, seed) {
  let k = FACE_LIGHT[f] * (1.06 - (0.14 * y) / Math.max(1, H - 1));
  if (f === "front" || f === "back") {
    if (x === 0 || x === W - 1) k *= 0.9;
    const fold = hash(x, seed, 3);
    if (fold < 0.16 && y > 2) k *= 0.88 + 0.06 * Math.sin(y * 0.7);
    else if (fold > 0.9 && y > 2) k *= 1.05;
  }
  k *= 0.975 + hash(x, y, seed) * 0.05;
  return mul(base, k);
}

/**
 * 肌の陰影
 * @param {Color} skin
 * @param {Face} f
 * @param {number} x
 * @param {number} y
 * @param {number} W
 * @param {number} H
 */
function skinShade(skin, f, x, y, W, H) {
  let k = FACE_LIGHT[f] * (1.03 - (0.08 * y) / Math.max(1, H - 1));
  if ((f === "front" || f === "back") && (x === 0 || x === W - 1)) k *= 0.93;
  k *= 0.985 + hash(x, y, 7) * 0.03;
  return mul(skin, k);
}

// 道具やつばの色（頭の左上の、使われていない場所。モデルの道具は 64 配置の座標で参照する）
export const SWATCH = {
  wood: [0, 0, [188, 146, 96]],
  woodDark: [1, 0, [140, 102, 62]],
  steel: [2, 0, [62, 68, 82]],
  steelDark: [3, 0, [38, 42, 52]],
  straw: [4, 0, [222, 192, 112]],
  strawDark: [5, 0, [186, 152, 80]],
  edge: [6, 0, [226, 230, 236]],
  woodLight: [7, 0, [232, 216, 184]],
  ferrule: [0, 1, [30, 30, 34]],
};

/** 道具の色を書き込む @param {Img} img */
export function stampSwatches(img) {
  for (const [x, y, c] of Object.values(SWATCH)) {
    for (let dy = 0; dy < RES; dy++) {
      for (let dx = 0; dx < RES; dx++) img.set(/** @type {number} */ (x) * RES + dx, /** @type {number} */ (y) * RES + dy, /** @type {Color} */ (c));
    }
  }
}

// ---------------------------------------------------------------
// 髪
// ---------------------------------------------------------------
/**
 * 髪がある場所（頭の面、16x16）
 * @param {Character} ch
 * @param {number} seed
 * @returns {(f: Face, x: number, y: number, side: number) => boolean}
 */
function hairMask(ch, seed) {
  const st = ch.style;
  const female = ch.gender === "f";
  const grayish = ch.hair[0] > 120;
  // 生え際のでこぼこ
  const jag = (/** @type {number} */ x, /** @type {number} */ k) => (hash(x, seed, k) < 0.35 ? 1 : 0);
  return (f, x, y, side) => {
    if (st === "bald") {
      if (f === "back") return grayish && y >= 6 && y <= 9;
      return (f === "right" || f === "left") && grayish && side >= 9 && y >= 6 && y <= 8;
    }
    if (f === "top") return true;
    if (f === "bottom") return false;
    if (st === "buzz") {
      if (f === "front") return y <= 1 + jag(x, 1);
      if (f === "back") return y <= 7;
      return y <= 3 || (side >= 10 && y <= 7);
    }
    if (f === "front") {
      if (female) {
        if (st === "long") {
          if (x <= 1 || x >= 14) return true;
          // 横に流した前髪
          const line = x < 8 ? 5 - Math.floor(x / 3) : 3;
          return y <= line + jag(x, 2);
        }
        if (st === "bob") {
          if (x <= 1 || x >= 14) return y <= 12;
          return y <= 4 + jag(x, 3) + (x >= 5 && x <= 10 ? 0 : 1);
        }
        if (st === "ponytail") return y <= 3 + jag(x, 4) || ((x === 0 || x === 15) && y <= 9);
        return y <= 2 + jag(x, 5) || ((x === 0 || x === 15) && y <= 7);
      }
      if (st === "spiky") return y <= 3 + ((x % 4 === 1 || x % 4 === 2) && hash(x, seed) < 0.6 ? 2 : 0);
      // もみあげ
      if (x <= 1 || x >= 14) return y <= (x === 0 || x === 15 ? 9 : 6);
      return y <= 3 + jag(x, 6);
    }
    const ear = y >= 7 && y <= 11 && side >= 6 && side <= 9;
    if (f === "right" || f === "left") {
      if (st === "long") return true;
      if (st === "bob") return y <= 12;
      if (ear) return false;
      if (side <= 2) return y <= (female ? 7 : 9);
      if (side >= 10) return y <= (st === "ponytail" || st === "bun" ? 12 : 10) + jag(side, 7);
      return y <= 5 + jag(side, 8);
    }
    // 後ろ
    if (st === "long" || st === "bun") return true;
    if (st === "bob") return y <= 12;
    return y <= 10 + jag(x, 9);
  };
}

/**
 * 髪の色：毛束ごとの明暗・上の方の光沢（つや）・毛先の影
 * @param {Character} ch
 * @param {number} seed
 * @param {(f: Face, x: number, y: number, side: number) => boolean} mask
 */
function hairShade(ch, seed, mask) {
  const base = ch.style === "buzz" ? mix(ch.hair, ch.skin, 0.35) : ch.hair;
  return (/** @type {Face} */ f, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ side, /** @type {number} */ H) => {
    const strand = hash(f === "top" ? x * 3 + Math.floor(y / 4) : x, seed, f.length);
    let t = 0.42 + (strand - 0.5) * 0.35;
    if (f === "top") {
      // つむじから外へ流れる明暗
      t += 0.12 - (Math.abs(x - 7.5) + Math.abs(y - 9)) * 0.012;
    } else {
      if (y >= 2 && y <= 4) t += 0.16; // つや
      if (y + 1 < H && !mask(f, x, y + 1, side)) t -= 0.22; // 毛先
      if (y + 2 < H && !mask(f, x, y + 2, side)) t -= 0.08;
    }
    t *= f === "back" ? 0.95 : f === "right" || f === "left" ? 0.93 : 1;
    t += (hash(x, y, seed + 1) - 0.5) * 0.06;
    return tone(base, t);
  };
}

// ---------------------------------------------------------------
// キャラクター（肌・顔・髪）
// ---------------------------------------------------------------
/**
 * @param {Img} img
 * @param {Character} ch
 * @param {number} seed
 */
export function drawCharacter(img, ch, seed) {
  const P = parts(ch.build === 1);
  const female = ch.gender === "f";
  const skin = ch.skin;
  const old = ch.hair[0] > 140 && Math.abs(ch.hair[0] - ch.hair[2]) < 20;

  // 体・腕・脚の肌
  for (const k of ["body", "rarm", "larm", "rleg", "lleg"]) paint(img, P[k], (f, x, y, W, H) => skinShade(skin, f, x, y, W, H));

  const mask = hairMask(ch, seed);
  const hs = hairShade(ch, seed, mask);
  const shadow = mul(skin, 0.78);
  const deep = mul(skin, 0.64);
  const light = mix(skin, WHITE, 0.14);

  // 頭の肌（顔の立体感）
  paint(img, P.head, (f, x, y, W, H, side) => {
    if (mask(f, x, y, side)) return hs(f, x, y, side, H);
    let c = mul(skin, FACE_LIGHT[f]);
    // 髪のすぐ下は影
    if (y > 0 && mask(f, x, y - 1, side)) c = mix(c, deep, 0.45);
    else if (y > 1 && mask(f, x, y - 2, side)) c = mix(c, shadow, 0.3);
    if (f === "front") {
      if (x <= 1 || x >= 14) c = mix(c, shadow, 0.55); // ほおの横
      if (y >= 4 && y <= 6 && x >= 5 && x <= 10) c = mix(c, light, 0.35); // おでこの光
      if (y >= 9 && y <= 11 && ((x >= 2 && x <= 4) || (x >= 11 && x <= 13))) c = mix(c, light, 0.3); // ほお骨
      if (y >= 13 && (x <= 3 || x >= 12)) c = mix(c, shadow, 0.4); // あご
      if (y === 15) c = mix(c, shadow, 0.35);
    }
    if (f === "right" || f === "left") {
      if (y >= 7 && y <= 11 && side >= 6 && side <= 9) {
        // 耳
        if (y === 7 || side === 9) c = mix(c, light, 0.3);
        else if (y >= 8 && y <= 10 && side >= 7 && side <= 8) c = mix(c, deep, 0.55);
      }
      if (side <= 1) c = mix(c, light, 0.12);
      if (y >= 13) c = mix(c, shadow, 0.3);
    }
    if (f === "bottom") c = mul(skin, 0.62);
    return mul(c, 0.99 + hash(x, y, seed + 3) * 0.02);
  });

  // 顔のパーツ
  const sclera = [236, 234, 228];
  const iris = ch.eyes;
  const brow = ch.style === "bald" ? mul(skin, 0.5) : mul(ch.hair, old ? 0.8 : 0.72);
  const lipUp = mix(skin, [168, 78, 76], female ? 0.5 : 0.3);
  const lipLow = mix(skin, [206, 112, 112], female ? 0.5 : 0.25);
  const lash = [40, 28, 26];
  paint(img, P.head, (f, x, y, W, H, side) => {
    if (f !== "front" || mask(f, x, y, side)) return null;
    // 左右の目（mx: 目の中の位置 0〜3。0 = 外側）
    const eyeL = x >= 3 && x <= 6;
    const eyeR = x >= 9 && x <= 12;
    const mx = eyeL ? x - 3 : eyeR ? 12 - x : -1;
    // 眉
    if (female) {
      // 細く弧を描く眉
      if (y === 5 && mx >= 1) return mix(brow, skin, mx === 3 ? 0.55 : 0.35);
      if (y === 6 && mx === 0) return mix(brow, skin, 0.5);
    } else {
      if (y === 6 && mx >= 0) return brow;
      if (y === 5 && mx >= 1) return mix(brow, skin, 0.35);
      if (y === 6 && (x === 2 || x === 13)) return mix(brow, skin, 0.5);
    }
    // まぶた・目
    if (y === 7 && mx >= 0) return female ? (mx === 3 ? mix(lash, skin, 0.5) : lash) : mix(skin, deep, 0.7);
    if (female && y === 7 && (x === 2 || x === 13)) return mix(lash, skin, 0.3);
    if (y === 8 && mx >= 0) {
      if (mx === 0) return mix(sclera, shadow, 0.25);
      if (mx === 3) return mix(sclera, shadow, 0.1);
      return mx === 1 ? mix(iris, WHITE, 0.15) : mul(iris, 0.45); // 瞳（内側が暗い＝瞳孔）
    }
    if (y === 9 && mx >= 0) {
      if (mx === 0 || mx === 3) return mix(skin, shadow, 0.45);
      return mx === 1 ? iris : mul(iris, 0.7);
    }
    if (y === 10 && mx >= 0 && mx <= 2) return mix(skin, shadow, 0.25); // 目の下
    // 鼻
    if (x === 7 && y >= 8 && y <= 10) return mix(skin, light, 0.35);
    if (x === 8 && y >= 9 && y <= 10) return mix(skin, shadow, female ? 0.3 : 0.5);
    if (y === 11 && (x === 6 || x === 9)) return mix(skin, deep, female ? 0.35 : 0.6);
    if (y === 11 && (x === 7 || x === 8)) return mix(skin, shadow, 0.2);
    // ほお（女性は少し血色）
    if (female && y >= 10 && y <= 11 && ((x >= 2 && x <= 4) || (x >= 11 && x <= 13))) return mix(skin, [236, 130, 130], 0.22);
    // 口
    if (y === 12 && x >= 6 && x <= 9) return mix(skin, shadow, 0.2);
    if (y === 13 && x >= 5 && x <= 10) return x === 5 || x === 10 ? mix(skin, deep, 0.5) : lipUp;
    if (y === 14 && x >= 6 && x <= 9) return lipLow;
    // しわ（年配）
    if (old && y === 3 && x >= 5 && x <= 10 && x % 2 === 0) return mix(skin, shadow, 0.5);
    if (old && y === 12 && (x === 4 || x === 11)) return mix(skin, shadow, 0.6);
    return null;
  });

  // ひげ
  if (ch.beard) {
    const b = ch.beard;
    const bc = (/** @type {number} */ x, /** @type {number} */ y) => tone(ch.hair, 0.4 + (hash(x, y, seed + 5) - 0.5) * 0.35);
    const stub = (/** @type {number} */ x, /** @type {number} */ y) => mix(skin, bc(x, y), 0.18 + hash(x, y, seed + 6) * 0.22);
    paint(img, P.head, (f, x, y, W, H, side) => {
      if (f === "front") {
        const lips = (y === 13 && x >= 5 && x <= 10) || (y === 14 && x >= 6 && x <= 9);
        const must = (y === 12 && x >= 4 && x <= 11) || (y === 13 && (x === 4 || x === 11));
        if (b === "mustache") return must ? bc(x, y) : null;
        if (b === "stubble") return y >= 11 && !lips ? stub(x, y) : null;
        if (y === 14 && x >= 6 && x <= 9) return null;
        if (y === 13 && x >= 6 && x <= 9) return null;
        if (y >= 11 || (y >= 9 && (x <= 2 || x >= 13))) return bc(x, y);
        return null;
      }
      if ((f === "right" || f === "left") && y >= 9 && side <= 5) return b === "stubble" ? stub(x, y) : bc(x, y);
      if (f === "bottom" && b !== "mustache") return b === "stubble" ? stub(x, y) : bc(x, y);
      return null;
    });
  }
}

/**
 * 服の上に重なる髪（外側の層：髪のボリューム・長い髪・ポニーテール・お団子）
 * @param {Img} img
 * @param {Character} ch
 * @param {number} seed
 */
export function drawHairOuter(img, ch, seed) {
  const P = parts(ch.build === 1);
  const st = ch.style;
  if (st === "bald" || st === "buzz") return;
  const c = (/** @type {number} */ x, /** @type {number} */ y, t = 0.45) => tone(ch.hair, t + (hash(x, seed, 21) - 0.5) * 0.3 + (hash(x, y, seed) - 0.5) * 0.06);
  const female = ch.gender === "f";
  // はね毛（ボリューム）
  paint(img, P.hat, (f, x, y, W, H, side) => {
    if (f === "top") return hash(x, y, seed + 2) < 0.25 ? c(x, y, 0.55) : null;
    if (f === "front") return y <= 1 && hash(x, seed + 4) < (st === "spiky" ? 0.6 : 0.3) ? c(x, y, 0.5) : null;
    if (f === "right" || f === "left") return y >= 2 && y <= 6 && side >= 2 && hash(side, seed + 6) < 0.4 && y <= 3 + hash(side, seed + 8) * 4 ? c(side, y, 0.42) : null;
    if (f === "back") return y <= 4 && hash(x, seed + 7) < 0.4 && y <= 1 + hash(x, seed + 9) * 4 ? c(x, y, 0.4) : null;
    return null;
  });
  if (st === "long") {
    paint(img, P.hat, (f, x, y) => ((f === "back" || f === "right" || f === "left") && y >= 5 ? c(x, y, y >= 14 ? 0.3 : 0.44) : null));
    paint(img, P.jacket, (f, x, y, W) => {
      if (f !== "back") return null;
      const len = 13 - (x <= 1 || x >= W - 2 ? 4 : 0) - Math.floor(hash(x, seed, 30) * 3);
      return y < len ? c(x, y, y >= len - 2 ? 0.28 : 0.42) : null;
    });
  }
  if (st === "bob") {
    paint(img, P.hat, (f, x, y) => ((f === "right" || f === "left" || f === "back") && y >= 6 && y <= 12 ? c(x, y, y >= 11 ? 0.3 : 0.44) : null));
  }
  if (st === "ponytail" || st === "tied") {
    const len = st === "tied" ? 5 : 14;
    const tie = female ? [120, 60, 70] : mul(ch.hair, 0.5);
    paint(img, P.hat, (f, x, y) => (f === "back" && x >= 6 && x <= 9 && y >= 6 ? (y <= 7 ? tie : c(x, y, x === 6 || x === 9 ? 0.34 : 0.48)) : null));
    paint(img, P.jacket, (f, x, y) => {
      if (f !== "back") return null;
      const w = y > len - 4 ? 1 : 2; // 毛先は細く
      if (x < 8 - w || x > 7 + w || y >= len) return null;
      return c(x, y, y >= len - 2 ? 0.28 : 0.44);
    });
  }
  if (st === "bun") {
    paint(img, P.hat, (f, x, y) => {
      if (f === "top" && x >= 4 && x <= 11 && y >= 8) return c(x, y, x <= 5 || y >= 14 ? 0.32 : 0.5);
      if (f === "back" && x >= 4 && x <= 11 && y <= 5) return c(x, y, y >= 4 ? 0.3 : 0.46);
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
 *   clothes: (img: Img, ch: Character, seed: number) => void,
 *   headwear?: (img: Img, ch: Character, seed: number) => void
 * }} Outfit
 */

/**
 * 長ズボン（上から rows 段目まで）
 * @param {Color} base
 * @param {number} seed
 * @param {number} rows
 * @param {boolean} [twill] デニムの綾織り
 * @returns {PaintFn}
 */
const trousers = (base, seed, rows, twill = false) => (f, x, y, W, H) => {
  if (f === "top" || f === "bottom" || y >= rows) return null;
  let col = cloth(base, f, x, y, W, H, seed);
  if (twill && (x + y) % 3 === 0) col = mul(col, 1.06);
  if (f === "front" && x === Math.floor(W / 2) && y > 2) col = mul(col, 1.05); // 折り目
  if (y >= 9 && y <= 10 && hash(x, seed + 11) < 0.5) col = mul(col, 0.88); // ひざ
  if (y === rows - 1) col = mul(col, 0.82); // すそ
  if ((f === "right" || f === "left") && (x === 3 || x === 4)) col = mul(col, twill ? 1.1 : 0.94); // 脇の縫い目
  return col;
};

/**
 * 靴（下から rows 段）
 * @param {Color} upper
 * @param {Color} sole
 * @param {number} rows
 * @param {Color | null} [lace]
 * @returns {PaintFn}
 */
const boots = (upper, sole, rows, lace = null) => (f, x, y, W, H) => {
  if (f === "top") return null;
  if (f === "bottom") return mul(sole, 0.7);
  if (y < H - rows) return null;
  if (y >= H - 2) return mul(sole, FACE_LIGHT[f] * (y === H - 1 ? 0.85 : 1));
  let col = mul(upper, FACE_LIGHT[f] * (1.08 - ((y - (H - rows)) / rows) * 0.12));
  if (y === H - rows) col = mul(col, 1.12); // 履き口
  if (lace && f === "front" && (x === 3 || x === 4) && y < H - 3 && y > H - rows && (x + y) % 2 === 0) col = mix(col, lace, 0.7);
  if (f === "front" && (x === 2 || x === 5) && y === H - 3) col = mix(col, WHITE, 0.25); // つやの点
  return col;
};

/** 手（袖から出る部分）の段数 */
const HAND_ROWS = 3;

/** @type {Outfit[]} */
export const OUTFITS = [
  {
    // 0: 普段着（無職）。男性はパーカーとチノパン、女性はブラウスとプリーツスカート
    id: "casual",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const main = ch.cloth;
      const female = ch.gender === "f";
      if (!female) {
        const rib = mul(main, 0.8);
        paint(img, P.body, (f, x, y, W, H) => {
          if (f === "bottom") return mul(main, 0.6);
          if (f === "top") return cloth(main, f, x, y, W, H, seed);
          if (f === "front") {
            if (y <= 1 && x >= 6 && x <= 9) return null; // 首元
            if (y <= 2 && x >= 4 && x <= 11) return mul(main, 0.72); // フードの縁
            if ((x === 6 || x === 9) && y >= 3 && y <= 9) return y === 9 ? [150, 150, 150] : [226, 226, 222]; // ひも
            if (y === 14 && x >= 3 && x <= 12) return mul(main, 0.62); // ポケットの口
            if (y >= 15 && y <= 19 && (x === 3 || x === 12)) return mul(main, 0.78);
            if (y >= 15 && y <= 19 && x >= 4 && x <= 11) return mul(cloth(main, f, x, y, W, H, seed), 0.95);
          }
          if (y >= 21) return mul(rib, FACE_LIGHT[f] * (x % 2 === 0 ? 1 : 0.9)); // すそのリブ
          return cloth(main, f, x, y, W, H, seed);
        });
        // 背中のフード
        paint(img, P.jacket, (f, x, y, W) => {
          if (f !== "back" || y > 5) return null;
          if (y === 5) return mul(main, 0.6);
          if (x === 7 || x === 8) return mul(main, 0.75);
          return cloth(main, "back", x, y, W, 6, seed + 9);
        });
        for (const k of ["rarm", "larm"]) {
          paint(img, P[k], (f, x, y, W, H) => {
            if (f === "bottom" || y >= H - HAND_ROWS) return null;
            if (y >= H - HAND_ROWS - 3) return mul(rib, FACE_LIGHT[f] * (x % 2 === 0 ? 1 : 0.9)); // 袖口
            if (y === 9 && hash(x, seed + 13) < 0.5) return mul(cloth(main, f, x, y, W, H, seed + 2), 0.9); // ひじのしわ
            return cloth(main, f, x, y, W, H, seed + 2);
          });
        }
        for (const k of ["rleg", "lleg"]) {
          paint(img, P[k], trousers([176, 134, 94], seed + 4, 20));
          paint(img, P[k], boots([70, 72, 80], [236, 236, 232], 4, [230, 230, 230]));
        }
        return;
      }
      // 女性：襟付きブラウス・ベルト・プリーツスカート・タイツ・ブーツ
      const collar = [246, 245, 240];
      const skirt = mul(main, 0.6);
      paint(img, P.body, (f, x, y, W, H) => {
        if (f === "bottom") return mul(skirt, 0.7);
        if (f === "front") {
          if (y <= 1 && x >= 6 && x <= 9) return null;
          // 襟（左右の三角）
          if (y <= 3 && ((x >= 3 && x <= 6 && x - 3 >= y - 1) || (x >= 9 && x <= 12 && 12 - x >= y - 1))) return mul(collar, y === 3 ? 0.9 : 1);
          if (x === 7 && y >= 2 && y <= 16) return mul(cloth(main, f, x, y, W, H, seed), 0.9); // 前立て
          if (x === 8 && y >= 4 && y <= 16 && y % 4 === 0) return collar; // ボタン
        }
        if (y >= 17 && y <= 18) return mul([70, 46, 34], FACE_LIGHT[f] * (f === "front" && x >= 7 && x <= 8 ? 1.6 : 1)); // ベルト
        if (y >= 19) return cloth(skirt, f, x, y, W, H, seed + 1);
        return cloth(main, f, x, y, W, H, seed);
      });
      for (const k of ["rarm", "larm"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "bottom" || y >= H - HAND_ROWS) return null;
          if (y >= H - HAND_ROWS - 2) return mul(collar, FACE_LIGHT[f]); // 袖口
          return cloth(main, f, x, y, W, H, seed + 2);
        });
      }
      const tights = mix(ch.skin, [40, 36, 44], 0.45);
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "top" || f === "bottom") return null;
          if (y <= 9) return cloth(skirt, f, x, y, W, H, seed + 3);
          if (y <= 17) return mul(tights, FACE_LIGHT[f] * (x === 0 || x === W - 1 ? 0.9 : 1.02));
          return null;
        });
        paint(img, P[k], boots([108, 70, 44], [60, 40, 30], 6));
      }
      for (const k of ["rpants", "lpants"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "top" || f === "bottom" || y > 11) return null;
          const col = cloth(skirt, f, x, y, W, H, seed + 3);
          if (y === 11) return mul(col, 0.8);
          return x % 2 === 0 ? mul(col, 0.84) : mul(col, 1.04); // プリーツ
        });
      }
    },
  },
  {
    // 1: 農家。麦わら帽子・生成りのシャツ（袖まくり）・デニムのオーバーオール・長靴
    id: "farmer",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const shirt = [232, 222, 196];
      const denim = [72, 102, 156];
      const stitch = mix([214, 170, 92], denim, 0.45);
      const female = ch.gender === "f";
      const shirtAt = (/** @type {Face} */ f, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ s) => {
        const col = cloth(shirt, f, x, y, W, H, s);
        return x % 4 === 0 || y % 4 === 0 ? mul(col, 0.94) : col; // 細かいチェック
      };
      const denimAt = (/** @type {Face} */ f, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ s) => {
        const col = cloth(denim, f, x, y, W, H, s);
        return (x + y) % 3 === 0 ? mul(col, 1.06) : col;
      };
      paint(img, P.body, (f, x, y, W, H) => {
        if (f === "bottom") return mul(denim, 0.6);
        if (f === "front" && y <= 1 && x >= 6 && x <= 9) return null;
        if (female && f === "front" && y <= 3 && x >= 4 && x <= 11) return (x + y) % 4 === 0 ? [240, 236, 230] : [196, 56, 52]; // スカーフ
        const bib = f === "front" && y >= 6 && x >= 3 && x <= 12;
        const cross = f === "back" && y <= 12 && (Math.abs(x - 7.5 - (y - 6) * 0.5) < 1.2 || Math.abs(x - 7.5 + (y - 6) * 0.5) < 1.2);
        const strap = (f === "front" && y <= 6 && (x === 4 || x === 5 || x === 10 || x === 11)) || cross;
        if (f === "front" && y >= 6 && y <= 7 && (x === 4 || x === 5 || x === 10 || x === 11)) return x === 4 || x === 11 ? [236, 196, 84] : [180, 140, 50]; // 金具
        if (bib && y >= 9 && y <= 13 && x >= 6 && x <= 9) {
          if (y === 9) return mul(denim, 0.75); // ポケット
          if ((x === 6 || x === 9) && y % 2 === 0) return stitch;
        }
        if (bib && (x === 3 || x === 12) && y % 2 === 0) return stitch;
        if (y >= 14 || bib || strap) return denimAt(f, x, y, W, H, seed);
        return shirtAt(f, x, y, W, H, seed + 1);
      });
      for (const k of ["rarm", "larm"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "bottom" || y >= 12) return null;
          if (y >= 9) return mul(shirt, FACE_LIGHT[f] * (y === 10 ? 0.82 : 1.02)); // まくった袖
          return shirtAt(f, x, y, W, H, seed + 2);
        });
      }
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "top" || f === "bottom" || y >= 18) return null;
          let col = denimAt(f, x, y, W, H, seed + 3);
          if (y >= 9 && y <= 10 && hash(x, seed) < 0.5) col = mul(col, 0.88);
          if ((f === "right" || f === "left") && (x === 3 || x === 4) && y % 2 === 0) col = stitch;
          return col;
        });
        paint(img, P[k], boots([80, 108, 78], [44, 58, 44], 6));
      }
    },
    headwear(img, ch, seed) {
      const P = parts(ch.build === 1);
      const sc = /** @type {Color} */ (SWATCH.straw[2]);
      const straw = (/** @type {number} */ x, /** @type {number} */ y) => mul(sc, ((x + y) % 2 === 0 ? 1.06 : 0.9) * (0.96 + hash(x, y, seed) * 0.08));
      paint(img, P.hat, (f, x, y) => {
        if (f === "top") return straw(x, y);
        if (f === "bottom") return null;
        if (y <= 1) return mul(straw(x, y), FACE_LIGHT[f]);
        if (y <= 3) return mul([168, 58, 46], FACE_LIGHT[f] * (y === 3 ? 0.8 : 1)); // リボン
        return null;
      });
    },
  },
  {
    // 2: 木こり。赤黒チェックのネルシャツ・胸ポケット・サスペンダー・ジーンズ・革の手袋とブーツ・ニット帽
    id: "lumberjack",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const red = [176, 38, 36];
      const leather = [98, 62, 36];
      const plaid = (/** @type {Face} */ f, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ s) => {
        const a = Math.floor(x / 4) % 2 === 0;
        const b = Math.floor(y / 4) % 2 === 0;
        let base = a && b ? [32, 24, 26] : a || b ? mul(red, 0.58) : red;
        if (x % 4 === 1 || y % 4 === 1) base = mul(base, 0.92); // 織り目
        return cloth(base, f, x, y, W, H, s);
      };
      paint(img, P.body, (f, x, y, W, H) => {
        if (f === "bottom") return mul(leather, 0.6);
        if (f === "front") {
          if (y <= 1 && x >= 6 && x <= 9) return null;
          if (y <= 2 && ((x >= 4 && x <= 6) || (x >= 9 && x <= 11))) return mul(red, 0.45); // 襟
          if (x === 7 || x === 8) {
            if (x === 7 && y >= 3 && y <= 20 && y % 5 === 3) return [226, 216, 196]; // ボタン
            return mul(plaid(f, x, y, W, H, seed), 0.92); // 前立て
          }
          if (y === 5 && ((x >= 1 && x <= 5) || (x >= 10 && x <= 14))) return mul(red, 0.4); // ポケットのふた
        }
        if (y >= 22) {
          if (f === "front" && x >= 6 && x <= 9) return x === 6 || x === 9 ? [150, 120, 60] : [214, 180, 90]; // バックル
          return mul(leather, FACE_LIGHT[f] * (y === 22 ? 1.08 : 0.92)); // ベルト
        }
        if ((f === "front" || f === "back") && (x === 2 || x === 3 || x === 12 || x === 13)) {
          if (y === 1 && f === "front") return [196, 196, 200]; // 金具
          return mul(leather, FACE_LIGHT[f] * (x === 2 || x === 12 ? 1.1 : 0.95)); // サスペンダー
        }
        return plaid(f, x, y, W, H, seed);
      });
      for (const k of ["rarm", "larm"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "bottom" || y >= H - HAND_ROWS - 1) return mul([136, 94, 56], FACE_LIGHT[f] * (y === H - HAND_ROWS - 1 ? 1.12 : 1)); // 革の手袋
          if (y >= H - HAND_ROWS - 3) return mul(red, 0.45 * FACE_LIGHT[f]); // 袖口
          return plaid(f, x + (k === "larm" ? 2 : 0), y, W, H, seed + 1);
        });
      }
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], trousers([50, 66, 108], seed + 2, 17, true));
        paint(img, P[k], boots([112, 72, 40], [44, 30, 22], 7, [214, 196, 150]));
      }
    },
    headwear(img, ch, seed) {
      const P = parts(ch.build === 1);
      const knit = [150, 34, 38];
      paint(img, P.hat, (f, x, y) => {
        if (f === "top") {
          const d = Math.hypot(x - 7.5, y - 7.5);
          if (d < 2.2) return mix(knit, WHITE, 0.35); // ボンボン
          const ray = Math.floor((Math.atan2(y - 7.5, x - 7.5) + Math.PI) * 4);
          return mul(knit, (ray % 2 === 0 ? 1.05 : 0.88) * (1.02 - d * 0.02));
        }
        if (f === "bottom") return null;
        if (y <= 3) return mul(knit, FACE_LIGHT[f] * (x % 2 === 0 ? 1.06 : 0.86)); // リブ編み
        if (y <= 5) return mul(knit, FACE_LIGHT[f] * (y === 5 ? 0.62 : 0.78)); // 折り返し
        return null;
      });
    },
  },
];
