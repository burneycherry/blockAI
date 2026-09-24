// 村人（人間の姿）のドット絵を描く部品。tools/gen-humans.mjs から使う
// 画風：陰影をつけた柔らかいドット絵（髪は毛束ごとに色を変え、服にはしわと縫い目を入れる）

/** @typedef {number[]} Color */
/** @typedef {import("../packs/BP/scripts/core/characters.js").Character} Character */

// ---------------------------------------------------------------
// 色の道具
// ---------------------------------------------------------------
/** @param {Color} c @param {number} k */
export const mul = (c, k) => [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(c[i] * k))));
/** @param {Color} a @param {Color} b @param {number} t */
export const mix = (a, b, t) => [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(a[i] * (1 - t) + b[i] * t))));
const WHITE = [255, 255, 255];
/** 同じ入力なら毎回同じになる 0〜1 の乱数 @param {number[]} n */
export const hash = (...n) => {
  let h = 0;
  for (const v of n) h = Math.sin(h * 1.7 + v * 12.9898 + 78.233) * 43758.5453;
  return h - Math.floor(h);
};
/** 明るい・ふつう・影・濃い影の4段階 @param {Color} c */
const ramp = (c) => ({ hi: mix(c, WHITE, 0.22), mid: c, lo: mul(c, 0.8), deep: mul(c, 0.6) });

/** 面ごとの明るさ（上から光が当たる） */
const FACE_LIGHT = { top: 1.07, front: 1.0, right: 0.88, left: 0.88, back: 0.92, bottom: 0.72 };

// ---------------------------------------------------------------
// 64x64 の画像と、体の部位（プレイヤーのスキンと同じ配置）
// ---------------------------------------------------------------
export class Img {
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
    this.px[i + 3] = 255;
  }
}

/** @typedef {"top"|"bottom"|"right"|"front"|"left"|"back"} Face */
/** side: 横の面で「前からの距離」（0 = 一番前） */
/** @typedef {(f: Face, x: number, y: number, W: number, H: number, side: number) => (Color | null | undefined)} PaintFn */

/** @param {boolean} slim */
export function parts(slim) {
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
 * 布の陰影（上が明るく下が暗い・縦のしわ・細かいむら）
 * @param {Color} base
 * @param {Face} f
 * @param {number} x
 * @param {number} y
 * @param {number} H
 * @param {number} seed
 */
function cloth(base, f, x, y, H, seed) {
  let k = FACE_LIGHT[f] * (1.05 - (0.1 * y) / Math.max(1, H - 1));
  if ((f === "front" || f === "back") && hash(x, seed, 3) < 0.22 && y > 1) k *= 0.9; // 縦のしわ
  if (hash(x, y, seed) < 0.12) k *= 0.93;
  else if (hash(y, x, seed + 1) < 0.1) k *= 1.05;
  return mul(base, k);
}

// 道具やつばの色（頭の左上の、使われていない場所に置く。モデルの道具はここを参照する）
export const SWATCH = {
  wood: [0, 0, [196, 156, 104]],
  woodDark: [1, 0, [150, 112, 70]],
  steel: [2, 0, [62, 68, 82]],
  steelDark: [3, 0, [40, 44, 54]],
  straw: [4, 0, [222, 192, 112]],
  strawDark: [5, 0, [186, 152, 80]],
  edge: [6, 0, [224, 228, 234]],
  woodLight: [7, 0, [232, 216, 184]],
  ferrule: [0, 1, [30, 30, 34]],
};

// ---------------------------------------------------------------
// 髪型（どこに髪があるか）
// ---------------------------------------------------------------
/**
 * @param {Character} ch
 * @returns {(f: Face, x: number, y: number, side: number) => boolean}
 */
function hairMask(ch) {
  const st = ch.style;
  const female = ch.gender === "f";
  return (f, x, y, side) => {
    if (st === "bald") return f === "back" && (y === 3 || y === 4) && ch.hair[0] > 120;
    if (f === "top") return true;
    if (f === "bottom") return false;
    if (st === "buzz") {
      if (f === "front") return y === 0;
      if (f === "back") return y <= 3;
      return y <= 1 || (y <= 2 && side >= 2);
    }
    if (f === "front") {
      if (y <= 1) return st !== "bun" || y === 0 || x <= 2 || x >= 5;
      if (female) {
        if (st === "long") return (y === 2 && x !== 3 && x !== 4) || x === 0 || x === 7;
        if (st === "bob") return (y === 2 && x !== 2 && x !== 5) || ((x === 0 || x === 7) && y <= 5);
        if (st === "ponytail") return (y === 2 && (x <= 1 || x >= 6)) || (y === 3 && (x === 0 || x === 7));
        return y === 2 && (x === 0 || x === 7);
      }
      if (st === "spiky") return y === 2 && (x === 0 || x === 2 || x === 5 || x === 7);
      if (y === 2) return x === 0 || x === 1 || x === 3 || x === 6 || x === 7;
      return y === 3 && (x === 0 || x === 7);
    }
    const ear = y >= 4 && y <= 5 && side >= 3 && side <= 4;
    if (f === "right" || f === "left") {
      if (st === "long") return true;
      if (st === "bob") return y <= 6;
      if (ear) return false;
      return y <= 3 || (y <= 6 && side >= 5) || (y <= 5 && side >= 2) || (female && side <= 1 && y <= 6);
    }
    // 後ろ
    if (st === "long" || st === "bun" || st === "bob") return true;
    return y <= 6;
  };
}

/**
 * 髪の色（毛束ごとに明暗をつけ、つむじ側を明るく、毛先を暗く）
 * @param {Character} ch
 * @param {number} seed
 */
function hairColor(ch, seed) {
  const r = ramp(ch.style === "buzz" ? mix(ch.hair, ch.skin, 0.3) : ch.hair);
  return (/** @type {Face} */ f, /** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ tipEdge) => {
    if (tipEdge) return r.lo;
    const strand = hash(f === "top" ? x + y * 3 : x, seed, f.length);
    if (f === "top") return strand < 0.3 ? r.hi : strand < 0.8 ? r.mid : r.lo;
    if (y === 0 && strand < 0.6) return r.hi;
    if (strand < 0.18) return r.hi;
    if (strand > 0.78) return r.lo;
    if (f === "back" || f === "right" || f === "left") return y > 4 && strand > 0.55 ? r.lo : r.mid;
    return r.mid;
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
  const sk = ramp(ch.skin);
  const mask = hairMask(ch);
  const hc = hairColor(ch, seed);

  // 肌（体・腕・脚）
  /** @type {PaintFn} */
  const skinFn = (f, x, y, W, H) => mul(ch.skin, FACE_LIGHT[f] * (1.03 - (0.06 * y) / Math.max(1, H - 1)) * (0.98 + hash(x, y, seed) * 0.04));
  for (const k of ["body", "rarm", "larm", "rleg", "lleg"]) paint(img, P[k], skinFn);

  // 頭：肌 → 髪。髪のすぐ下は影になる
  paint(img, P.head, (f, x, y, W, H, side) => {
    if (mask(f, x, y, side)) {
      const below = y + 1 < H && !mask(f, x, y + 1, side);
      return hc(f, x, y, below && f !== "top" && y >= 2);
    }
    let c = mul(ch.skin, FACE_LIGHT[f]);
    if (y > 0 && mask(f, x, y - 1, side)) c = mix(c, sk.lo, 0.6);
    if (f === "front") {
      if (x === 0 || x === 7) c = mix(c, sk.lo, 0.5);
      if (y === 7 && x >= 2 && x <= 5) c = mix(c, sk.lo, 0.3);
    }
    if ((f === "right" || f === "left") && y >= 4 && y <= 5 && side >= 3 && side <= 4) c = side === 3 ? sk.hi : sk.lo; // 耳
    return c;
  });

  // 顔
  const eyes = ramp(ch.eyes);
  const lip = mix(ch.skin, [196, 88, 92], female ? 0.55 : 0.35);
  paint(img, P.head, (f, x, y, W, H, side) => {
    if (f !== "front" || mask(f, x, y, side)) return null;
    if (female) {
      if (y === 3 && x >= 1 && x <= 6 && x !== 3 && x !== 4) return [44, 30, 34]; // まつげ
      if (y === 4 && (x === 1 || x === 5)) return mix(eyes.hi, WHITE, 0.6); // ハイライト
      if (y === 4 && (x === 2 || x === 6)) return eyes.deep;
      if (y === 5 && (x === 1 || x === 5)) return eyes.mid;
      if (y === 5 && (x === 2 || x === 6)) return eyes.hi;
      if (y === 6 && (x === 1 || x === 6)) return mix(ch.skin, [244, 120, 136], 0.45); // ほっぺ
      if (y === 6 && x === 4) return lip;
      if (y === 5 && x === 4) return mix(ch.skin, sk.lo, 0.35);
      return null;
    }
    if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return ch.style === "bald" ? sk.deep : mul(ch.hair, 0.7); // 眉
    if (y === 4 && (x === 1 || x === 6)) return [240, 240, 236];
    if (y === 4 && (x === 2 || x === 5)) return eyes.mid;
    if (y === 5 && (x === 1 || x === 2 || x === 5 || x === 6)) return mix(ch.skin, sk.lo, 0.3);
    if (y === 5 && x === 3) return sk.hi; // 鼻
    if (y === 5 && x === 4) return sk.lo;
    if (y === 6 && (x === 3 || x === 4)) return lip;
    return null;
  });

  // ひげ
  if (ch.beard) {
    const b = ch.beard;
    const br = ramp(ch.hair);
    const tone = (/** @type {number} */ x, /** @type {number} */ y) => (hash(x, y, seed + 5) < 0.3 ? br.lo : br.mid);
    const stub = (/** @type {number} */ x, /** @type {number} */ y) => mix(ch.skin, tone(x, y), 0.4);
    paint(img, P.head, (f, x, y, W, H, side) => {
      if (f === "front") {
        const mouth = y === 6 && (x === 3 || x === 4);
        if (b === "mustache") return (y === 5 && x >= 2 && x <= 5 && !(x === 3)) || (y === 6 && (x === 2 || x === 5)) ? tone(x, y) : null;
        if (y < 5 || (y === 5 && x >= 3 && x <= 4) || mouth) return null;
        if (b === "stubble") return stub(x, y);
        return tone(x, y);
      }
      if ((f === "right" || f === "left") && y >= 5 && side <= 2) return b === "stubble" ? stub(x, y) : tone(x, y);
      if (f === "bottom" && b === "full") return br.lo;
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
  const r = ramp(ch.hair);
  const tone = (/** @type {number} */ x, /** @type {number} */ y) => {
    const h = hash(x, y, seed + 9);
    return h < 0.25 ? r.hi : h > 0.75 ? r.lo : r.mid;
  };
  const female = ch.gender === "f";
  // 横と前のはね毛（ボリューム）
  paint(img, P.hat, (f, x, y, W, H, side) => {
    if (f === "top") return hash(x, y, seed + 2) < 0.35 ? tone(x, y) : null;
    if (f === "front") return y === 0 && hash(x, seed + 4) < (st === "spiky" ? 0.7 : 0.4) ? tone(x, y) : null;
    if (f === "right" || f === "left") return y >= 1 && y <= 3 && side >= 1 && hash(side, y, seed + 6) < 0.5 ? tone(x, y) : null;
    if (f === "back") return y <= 2 && hash(x, y, seed + 7) < 0.45 ? tone(x, y) : null;
    return null;
  });
  if (st === "long") {
    paint(img, P.hat, (f, x, y) => ((f === "back" || f === "right" || f === "left") && y >= 2 ? (y === 7 ? r.lo : tone(x, y)) : null));
    paint(img, P.jacket, (f, x, y, W) => {
      if (f !== "back") return null;
      const len = 6 - (x === 0 || x === W - 1 ? 2 : 0) - (hash(x, seed) < 0.4 ? 1 : 0);
      return y < len ? (y === len - 1 ? r.lo : tone(x, y)) : null;
    });
  }
  if (st === "bob") {
    paint(img, P.hat, (f, x, y) => ((f === "right" || f === "left" || f === "back") && y >= 3 && y <= 6 ? (y === 6 ? r.lo : tone(x, y)) : null));
  }
  if (st === "ponytail" || st === "tied") {
    const len = st === "tied" ? 3 : 7;
    const ribbon = female ? [214, 70, 96] : r.deep;
    paint(img, P.hat, (f, x, y) => (f === "back" && (x === 3 || x === 4) && y >= 3 ? (y === 3 ? ribbon : tone(x, y)) : null));
    paint(img, P.jacket, (f, x, y) => (f === "back" && (x === 3 || x === 4) && y < len ? (y === len - 1 ? r.lo : tone(x, y)) : null));
  }
  if (st === "bun") {
    paint(img, P.hat, (f, x, y) => {
      if (f === "top" && x >= 2 && x <= 5 && y >= 4 && y <= 7) return x === 2 || y === 7 ? r.lo : tone(x, y);
      if (f === "back" && x >= 2 && x <= 5 && y <= 2) return y === 2 ? r.lo : tone(x, y);
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
 * 靴（下2段）
 * @param {Color} upper
 * @param {Color} sole
 * @returns {PaintFn}
 */
const shoes = (upper, sole) => (f, x, y, W, H) => {
  if (f === "bottom") return mul(sole, 0.8);
  if (f === "top") return null;
  if (y === H - 1) return sole;
  if (y === H - 2) return mul(upper, FACE_LIGHT[f] * (hash(x, y) < 0.3 ? 1.1 : 1));
  return null;
};

/**
 * 長ズボン
 * @param {Color} base
 * @param {number} seed
 * @param {number} rows 何段目まで
 * @returns {PaintFn}
 */
const trousers = (base, seed, rows = 10) => (f, x, y, W, H) => {
  if (f === "top" || y >= rows) return null;
  if (f === "bottom") return null;
  let c = cloth(base, f, x, y, H, seed);
  if (y === 5 && hash(x, seed + 11) < 0.5) c = mul(c, 0.88); // ひざのしわ
  if (y === rows - 1) c = mul(c, 0.85); // すそ
  return c;
};

/** @type {Outfit[]} */
export const OUTFITS = [
  {
    // 0: 普段着（無職）。男性はパーカー、女性はブラウスとスカート
    id: "casual",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const main = ch.cloth;
      const r = ramp(main);
      const female = ch.gender === "f";
      if (!female) {
        paint(img, P.body, (f, x, y, W, H) => {
          if (f === "front" && y === 0 && (x === 3 || x === 4)) return null; // 首元
          if (f === "bottom") return r.lo;
          if (y === 11) return mul(r.lo, FACE_LIGHT[f]); // すそのリブ
          if (f === "front") {
            if ((x === 3 || x === 4) && y >= 1 && y <= 3) return y === 3 ? [236, 236, 236] : [214, 214, 214]; // ひも
            if (y === 7 && x >= 1 && x <= 6) return r.deep; // ポケットの口
            if (y >= 8 && y <= 10 && (x === 1 || x === 6)) return r.lo;
          }
          return cloth(main, f, x, y, H, seed);
        });
        paint(img, P.jacket, (f, x, y) => (f === "back" && y <= 2 ? (y === 2 ? r.deep : r.lo) : null)); // フード
        for (const k of ["rarm", "larm"]) {
          paint(img, P[k], (f, x, y, W, H) => {
            if (y === 11 && f !== "top") return null;
            if (f === "bottom") return null;
            if (y === 10) return mul(r.lo, FACE_LIGHT[f]); // 袖口
            return cloth(main, f, x, y, H, seed + 2);
          });
        }
        for (const k of ["rleg", "lleg"]) {
          paint(img, P[k], trousers([176, 132, 92], seed + 4));
          paint(img, P[k], shoes([72, 72, 80], [236, 236, 236]));
        }
        return;
      }
      // 女性：襟付きブラウス・プリーツスカート・ブーツ
      paint(img, P.body, (f, x, y, W, H) => {
        if (f === "bottom") return r.lo;
        if (f === "front") {
          if (y === 0 && (x === 3 || x === 4)) return null;
          if (y <= 1 && x >= 1 && x <= 6) return y === 0 || x === 2 || x === 5 ? [246, 246, 242] : null; // 襟
          if ((x === 3 || x === 4) && y >= 2 && y % 3 === 2) return [246, 246, 242]; // ボタン
          if (y === 9) return mul(r.deep, 1); // ベルト
        }
        if (y >= 10) return cloth(mul(main, 0.62), f, x, y, H, seed + 1);
        return cloth(main, f, x, y, H, seed);
      });
      for (const k of ["rarm", "larm"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (y === 11 || f === "bottom") return null;
          if (y === 10) return [246, 246, 242];
          return cloth(main, f, x, y, H, seed + 2);
        });
      }
      const skirt = mul(main, 0.62);
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "top" || f === "bottom") return null;
          if (y <= 5) return cloth(skirt, f, x, y, H, seed + 3);
          if (y >= 9) return mul([110, 72, 46], FACE_LIGHT[f] * (y === 11 ? 0.8 : 1)); // ブーツ
          return null;
        });
      }
      for (const k of ["rpants", "lpants"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "top" || f === "bottom" || y > 6) return null;
          const c = cloth(skirt, f, x, y, H, seed + 3);
          return (x + (f === "front" ? 0 : 1)) % 2 === 0 ? mul(c, 0.86) : c; // プリーツ
        });
      }
    },
  },
  {
    // 1: 農家。麦わら帽子・生成りのシャツ（袖まくり）・デニムのオーバーオール・長靴
    id: "farmer",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const shirt = [230, 220, 194];
      const denim = [70, 100, 156];
      const d = ramp(denim);
      const female = ch.gender === "f";
      paint(img, P.body, (f, x, y, W, H) => {
        if (f === "front" && y === 0 && (x === 3 || x === 4)) return null;
        if (f === "bottom") return d.lo;
        const bib = f === "front" && y >= 2 && x >= 2 && x <= 5;
        const strap = (f === "front" || f === "back") && y <= 3 && (x === 2 || x === 5);
        if (f === "front" && y === 3 && (x === 2 || x === 5)) return [226, 186, 70]; // ボタン
        if (f === "front" && y === 5 && (x === 3 || x === 4)) return d.hi; // 胸ポケットの縫い目
        if (f === "front" && y >= 6 && y <= 7 && (x === 3 || x === 4)) return d.lo;
        if (y >= 7 || bib || strap) {
          const c = cloth(denim, f, x, y, H, seed);
          return (f === "front" && (x === 1 || x === 6) && y >= 7) ? mix(c, d.hi, 0.5) : c;
        }
        if (female && f === "front" && y <= 1) return [200, 64, 60]; // スカーフ
        return cloth(shirt, f, x, y, H, seed + 1);
      });
      for (const k of ["rarm", "larm"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "bottom" || y > 5) return null;
          if (y === 5) return mul(shirt, FACE_LIGHT[f] * 0.9); // まくった袖
          return cloth(shirt, f, x, y, H, seed + 2);
        });
      }
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], trousers(denim, seed + 3, 9));
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "top") return null;
          if (f === "bottom") return [40, 56, 42];
          if (y >= 9) return mul([84, 110, 82], FACE_LIGHT[f] * (y === 9 ? 1.1 : y === 11 ? 0.75 : 1)); // 長靴
          return null;
        });
      }
    },
    headwear(img, ch, seed) {
      const P = parts(ch.build === 1);
      const [, , sc] = SWATCH.straw;
      const straw = (/** @type {number} */ x, /** @type {number} */ y) => mul(sc, (x + y) % 2 === 0 ? 1.04 : 0.9);
      paint(img, P.hat, (f, x, y) => {
        if (f === "top") return straw(x, y);
        if (f === "bottom") return null;
        if (y === 0) return straw(x, y);
        if (y === 1) return [168, 58, 46]; // 帽子のリボン
        return null;
      });
    },
  },
  {
    // 2: 木こり。赤黒チェックのネルシャツ・サスペンダー・ジーンズ・革のブーツ・ニット帽
    id: "lumberjack",
    clothes(img, ch, seed) {
      const P = parts(ch.build === 1);
      const red = [178, 40, 38];
      const plaid = (/** @type {Face} */ f, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ H, /** @type {number} */ s) => {
        const a = Math.floor(x / 2) % 2 === 0;
        const b = Math.floor(y / 2) % 2 === 0;
        const base = a && b ? [34, 26, 28] : a || b ? mul(red, 0.6) : red;
        return cloth(base, f, x, y, H, s);
      };
      paint(img, P.body, (f, x, y, W, H) => {
        if (f === "bottom") return [60, 40, 26];
        if (f === "front") {
          if (y === 0 && (x === 3 || x === 4)) return null;
          if (y === 0 && (x === 2 || x === 5)) return mul(red, 0.5); // 襟
          if ((x === 3 || x === 4) && y >= 1 && y <= 10) return x === 3 && y % 3 === 1 ? [222, 212, 190] : plaid(f, x, y, H, seed); // ボタン
        }
        if (y === 11) return f === "front" && (x === 3 || x === 4) ? [196, 170, 90] : mul([84, 54, 32], FACE_LIGHT[f]); // ベルト
        if ((f === "front" || f === "back") && (x === 1 || x === 6)) return mul([96, 62, 36], FACE_LIGHT[f] * (y % 4 === 0 ? 1.12 : 1)); // サスペンダー
        return plaid(f, x, y, H, seed);
      });
      for (const k of ["rarm", "larm"]) {
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "bottom" || y === 11) return mul([128, 86, 50], FACE_LIGHT[f]); // 手袋
          if (y === 10) return mul(red, 0.5 * FACE_LIGHT[f]); // 袖口
          return plaid(f, x + (k === "larm" ? 1 : 0), y, H, seed + 1);
        });
      }
      for (const k of ["rleg", "lleg"]) {
        paint(img, P[k], trousers([52, 70, 112], seed + 2, 9));
        paint(img, P[k], (f, x, y, W, H) => {
          if (f === "top") return null;
          if (f === "bottom") return [46, 30, 20];
          if (y < 9) return null;
          if (y === 9 && f === "front") return x === 1 || x === 2 ? [206, 190, 150] : [110, 72, 40]; // 靴ひも
          return mul([110, 72, 40], FACE_LIGHT[f] * (y === 11 ? 0.7 : 1));
        });
      }
    },
    headwear(img, ch, seed) {
      const P = parts(ch.build === 1);
      const knit = [156, 36, 38];
      paint(img, P.hat, (f, x, y) => {
        if (f === "top") return x >= 3 && x <= 4 && y >= 3 && y <= 4 ? mix(knit, WHITE, 0.3) : mul(knit, (x + y) % 2 === 0 ? 1.05 : 0.9);
        if (f === "bottom") return null;
        if (y <= 1) return mul(knit, FACE_LIGHT[f] * (x % 2 === 0 ? 1.05 : 0.88)); // リブ編み
        if (y === 2) return mul(knit, FACE_LIGHT[f] * 0.7); // 折り返し
        return null;
      });
    },
  },
];
