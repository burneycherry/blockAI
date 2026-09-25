// メニューに出すブロックの立体アイコン（持ち物の欄と同じ、斜め上から見た立方体）を作る
// 使い方: node tools/gen-icons.mjs [バニラのテクスチャのフォルダ]
//   フォルダを渡さなければ Mojang/bedrock-samples から取ってくる（ネットが必要）
//   出力: packs/RP/textures/blockai/icons/<名前>.png（core/icons.js から参照する）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "./png.mjs";
import { decodePng, decodeTga } from "./img.mjs";

const SRC = process.argv[2];
const URL = "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/textures/";
const OUT = "packs/RP/textures/blockai/icons";
const SIZE = 64;

/**
 * 名前 → [上の面, 横の面]（blocks/ からの場所。.png か .tga）
 * @type {Record<string, [string, string]>}
 */
const CUBES = {
  // 原木
  log_oak: ["log_oak_top.png", "log_oak.png"],
  log_spruce: ["log_spruce_top.png", "log_spruce.png"],
  log_birch: ["log_birch_top.png", "log_birch.png"],
  log_jungle: ["log_jungle_top.png", "log_jungle.png"],
  log_acacia: ["log_acacia_top.png", "log_acacia.png"],
  log_big_oak: ["log_big_oak_top.png", "log_big_oak.png"],
  cherry_log: ["cherry_log_top.png", "cherry_log_side.png"],
  mangrove_log: ["mangrove_log_top.png", "mangrove_log_side.png"],
  pale_oak_log: ["pale_oak_log_top.png", "pale_oak_log_side.png"],
  // 葉（持ち物の欄と同じ、色付きの carried を使う）
  leaves_oak: ["leaves_oak_carried.tga", "leaves_oak_carried.tga"],
  leaves_spruce: ["leaves_spruce_carried.tga", "leaves_spruce_carried.tga"],
  leaves_birch: ["leaves_birch_carried.tga", "leaves_birch_carried.tga"],
  leaves_jungle: ["leaves_jungle_carried.tga", "leaves_jungle_carried.tga"],
  leaves_acacia: ["leaves_acacia_carried.tga", "leaves_acacia_carried.tga"],
  leaves_big_oak: ["leaves_big_oak_carried.tga", "leaves_big_oak_carried.tga"],
  leaves_cherry: ["cherry_leaves.tga", "cherry_leaves.tga"],
  leaves_mangrove: ["mangrove_leaves_carried.tga", "mangrove_leaves_carried.tga"],
  leaves_pale_oak: ["pale_oak_leaves.tga", "pale_oak_leaves.tga"],
  // そのほかのブロック
  dirt: ["dirt.png", "dirt.png"],
  cobblestone: ["cobblestone.png", "cobblestone.png"],
  stone: ["stone.png", "stone.png"],
  sand: ["sand.png", "sand.png"],
  gravel: ["gravel.png", "gravel.png"],
  planks_oak: ["planks_oak.png", "planks_oak.png"],
  planks_spruce: ["planks_spruce.png", "planks_spruce.png"],
  planks_birch: ["planks_birch.png", "planks_birch.png"],
  wool_white: ["wool_colored_white.png", "wool_colored_white.png"],
};

/** @typedef {import("./img.mjs").Img} Img */

/** @param {string} file */
async function load(file) {
  if (SRC) return readFileSync(join(SRC, file));
  const res = await fetch(URL + "blocks/" + file);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** @param {string} file */
async function image(file) {
  const buf = await load(file);
  return file.endsWith(".tga") ? decodeTga(buf) : decodePng(buf);
}

/**
 * 斜め上から見た立方体を描く（持ち物の欄のブロックと同じ向き・明るさ）
 * @param {Img} top
 * @param {Img} side
 */
function renderCube(top, side) {
  const S = SIZE;
  const out = new Uint8Array(S * S * 4);
  /**
   * @param {Img} img
   * @param {number} u 0〜1
   * @param {number} v 0〜1
   * @param {number} shade
   * @param {number} o
   */
  const put = (img, u, v, shade, o) => {
    const tx = Math.min(img.w - 1, Math.floor(u * img.w));
    const ty = Math.min(img.h - 1, Math.floor(v * img.h));
    let s = (ty * img.w + tx) * 4;
    if (img.px[s + 3] < 128) {
      // 葉のすき間からは奥の面が見える（ずらした位置を暗めに描く）
      const bx = (tx + (img.w >> 1)) % img.w;
      const by = (ty + (img.h >> 1)) % img.h;
      s = (by * img.w + bx) * 4;
      if (img.px[s + 3] < 128) return false;
      shade *= 0.6;
    }
    out[o] = Math.round(img.px[s] * shade);
    out[o + 1] = Math.round(img.px[s + 1] * shade);
    out[o + 2] = Math.round(img.px[s + 2] * shade);
    out[o + 3] = 255;
    return true;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      // 上の面（ひし形）
      const a = (px - S / 2) / S + (py * 2) / S;
      const b = (py * 2) / S - (px - S / 2) / S;
      if (a >= 0 && a < 1 && b >= 0 && b < 1 && put(top, a, b, 1, o)) continue;
      // 左の面（明るめ）と右の面（暗め）
      if (px < S / 2) {
        const u = px / (S / 2);
        const v = (py - S / 4 - (u * S) / 4) / (S / 2);
        if (v >= 0 && v < 1) put(side, u, v, 0.8, o);
      } else {
        const u = (px - S / 2) / (S / 2);
        const v = (py - S / 2 + (u * S) / 4) / (S / 2);
        if (v >= 0 && v < 1) put(side, u, v, 0.6, o);
      }
    }
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
for (const name of Object.keys(CUBES)) {
  const [t, s] = CUBES[name];
  const top = await image(t);
  const side = t === s ? top : await image(s);
  writeFileSync(join(OUT, `${name}.png`), encodePng(SIZE, SIZE, renderCube(top, side)));
  console.log(`${OUT}/${name}.png`);
}
