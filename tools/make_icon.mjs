// pack_icon.png（256x256）を作る：夕焼けの空に、草ブロックの上に立つ村人2人の頭（斜め上から見た立体）
// 使い方: node tools/make_icon.mjs [バニラのテクスチャのフォルダ（blocks）]
//   フォルダを渡さなければ Mojang/bedrock-samples から取ってくる（ネットが必要）
//   村人の顔は packs/RP/textures/entity/blockai/human（gen-humans.mjs の生成物）から取る
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "./png.mjs";
import { decodePng } from "./img.mjs";

/** @typedef {import("./img.mjs").Img} Img */

const SRC = process.argv[2];
const URL = "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/textures/blocks/";
const S = 256;
const out = new Uint8Array(S * S * 4);

/** @param {string} file */
async function vanilla(file) {
  if (SRC) return decodePng(readFileSync(join(SRC, file)));
  const res = await fetch(URL + file);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return decodePng(Buffer.from(await res.arrayBuffer()));
}

/**
 * 画像の一部を切り出す
 * @param {Img} img
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Img}
 */
function crop(img, x, y, w, h) {
  const px = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) px.set(img.px.subarray(((y + j) * img.w + x) * 4, ((y + j) * img.w + x + w) * 4), j * w * 4);
  return { w, h, px };
}

/**
 * 1点を塗る（半透明は重ねる）
 * @param {number} x
 * @param {number} y
 * @param {number[]} c RGBA
 */
function blend(x, y, c) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const o = (y * S + x) * 4;
  const a = c[3] / 255;
  for (let k = 0; k < 3; k++) out[o + k] = Math.round(out[o + k] * (1 - a) + c[k] * a);
  out[o + 3] = 255;
}

/**
 * 斜め上から見た立方体を描く（持ち物の欄のブロックと同じ向き）
 * @param {number} x0 左上
 * @param {number} y0
 * @param {number} W 幅（高さも同じ）
 * @param {{ top: Img, left: Img, right: Img }} f
 * @param {number[]} shade [上, 左, 右] の明るさ
 */
function cube(x0, y0, W, f, shade = [1, 0.86, 0.66]) {
  /**
   * @param {Img} img
   * @param {number} u
   * @param {number} v
   * @param {number} s
   * @param {number} x
   * @param {number} y
   */
  const put = (img, u, v, s, x, y) => {
    const tx = Math.min(img.w - 1, Math.floor(u * img.w));
    const ty = Math.min(img.h - 1, Math.floor(v * img.h));
    const i = (ty * img.w + tx) * 4;
    if (img.px[i + 3] < 128) return;
    blend(x, y, [img.px[i] * s, img.px[i + 1] * s, img.px[i + 2] * s, 255]);
  };
  for (let y = Math.floor(y0); y < y0 + W; y++) {
    for (let x = Math.floor(x0); x < x0 + W; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const a = (px - W / 2) / W + (py * 2) / W;
      const b = (py * 2) / W - (px - W / 2) / W;
      if (a >= 0 && a < 1 && b >= 0 && b < 1) {
        put(f.top, a, b, shade[0], x, y);
        continue;
      }
      if (px < W / 2) {
        const u = px / (W / 2);
        const v = (py - W / 4 - (u * W) / 4) / (W / 2);
        if (v >= 0 && v < 1) put(f.left, u, v, shade[1], x, y);
      } else if (px < W) {
        const u = (px - W / 2) / (W / 2);
        const v = (py - W / 2 + (u * W) / 4) / (W / 2);
        if (v >= 0 && v < 1) put(f.right, u, v, shade[2], x, y);
      }
    }
  }
}

/**
 * 村人の頭（顔を左手前に向ける）。帽子の層は少し大きい立方体で重ねる
 * @param {string} file human テクスチャ（128x128 = 64配置の2倍）
 * @param {number} cx 足元（上の面の中心）
 * @param {number} cy
 * @param {number} W
 */
function head(file, cx, cy, W) {
  const t = decodePng(readFileSync(`packs/RP/textures/entity/blockai/human/${file}.png`));
  const k = t.w / 64;
  const faces = (/** @type {number} */ ox) => ({
    top: crop(t, (ox + 8) * k, 0, 8 * k, 8 * k),
    left: crop(t, (ox + 8) * k, 8 * k, 8 * k, 8 * k), // 顔
    right: crop(t, (ox + 16) * k, 8 * k, 8 * k, 8 * k), // 左の横顔
  });
  const x0 = cx - W / 2;
  const y0 = cy - (W * 3) / 4;
  cube(x0, y0, W, faces(0), [1, 0.95, 0.7]);
  const H = W * 1.125;
  cube(cx - H / 2, y0 - (H - W) / 2 - (H - W) / 4, H, faces(32), [1, 0.95, 0.7]);
}

// 空：上は深い青、下は夕焼けのオレンジ
const TOP = [38, 70, 128];
const MID = [96, 150, 206];
const LOW = [250, 196, 120];
for (let y = 0; y < S; y++) {
  const t = y / (S - 1);
  const c = t < 0.55 ? TOP.map((v, i) => v + (MID[i] - v) * (t / 0.55)) : MID.map((v, i) => v + (LOW[i] - v) * ((t - 0.55) / 0.45));
  for (let x = 0; x < S; x++) {
    // 真ん中の後ろを少し明るく（光が差す感じ）
    const d = Math.hypot(x - S / 2, y - S * 0.42) / (S * 0.6);
    const glow = Math.max(0, 1 - d) * 40;
    blend(x, y, [c[0] + glow, c[1] + glow, c[2] + glow * 0.7, 255]);
  }
}
// ドット絵の雲
for (const [cx, cy, w] of [[40, 44, 44], [196, 30, 52], [150, 70, 30]]) {
  for (let y = 0; y < 12; y += 4) {
    const inset = y === 0 ? w / 4 : y === 8 ? w / 8 : 0;
    for (let x = cx - w / 2 + inset; x < cx + w / 2 - inset; x++) for (let j = 0; j < 4; j++) blend(Math.round(x), cy + y + j, [255, 255, 255, 150]);
  }
}

// 草ブロック（持ち物の欄と同じ色の carried を使う）
const grassTop = await vanilla("grass_carried.png");
const grassSide = await vanilla("grass_side_carried.png");
const G = 176;
const gx = (S - G) / 2;
const gy = S - G + 14;
cube(gx, gy, G, { top: grassTop, left: grassSide, right: grassSide });

// 上の面の中心あたりに、村人2人（木こりのケンタと農家のサクラ）
const topY = gy + G / 4;
head("c2_lumberjack", S / 2 - 38, topY - 4, 86);
head("c11_farmer", S / 2 + 38, topY + 8, 86);

// 外枠：角を少し暗く（アイコンらしく締める）
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = Math.max(Math.abs(x - S / 2), Math.abs(y - S / 2)) / (S / 2);
    if (d > 0.8) blend(x, y, [0, 0, 0, Math.round((d - 0.8) * 180)]);
  }
}

const png = encodePng(S, S, out);
for (const p of ["packs/BP/pack_icon.png", "packs/RP/pack_icon.png"]) writeFileSync(p, png);
console.log("icon written");
