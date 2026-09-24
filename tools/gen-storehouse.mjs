// 村の倉庫（blockai:storehouse）の見た目を生成する：焦げ茶の板張りに鉄枠の宝箱。村人が使うとふたが開く
// 使い方: node tools/gen-storehouse.mjs        （書き出し）
//         node tools/gen-storehouse.mjs --check（最新かどうかだけ確認）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { encodePng } from "./png.mjs";

const check = process.argv.includes("--check");
let stale = 0;
/** @param {string} path @param {string | Buffer} data */
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
    console.error(`NG: ${path} が古いです。node tools/gen-storehouse.mjs を実行してください`);
    stale++;
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}
const writeJson = (/** @type {string} */ p, /** @type {any} */ o) => write(p, JSON.stringify(o, null, 2) + "\n");

// ---------------------------------------------------------------
// テクスチャ（64x64）
//   (0,0)-(32,32)  板張り（焦げ目のある木）
//   (32,0)-(48,16) 板の端（木口）
//   (48,0)-(56,8)  鉄  (56,0)-(64,8) 暗い鉄
// ---------------------------------------------------------------
const S = 64;
const px = new Uint8Array(S * S * 4);
const hash = (/** @type {number[]} */ ...n) => {
  let h = 0;
  for (const v of n) h = Math.sin(h * 1.7 + v * 12.9898 + 78.233) * 43758.5453;
  return h - Math.floor(h);
};
const set = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number[]} */ c) => {
  const i = (y * S + x) * 4;
  px[i] = Math.max(0, Math.min(255, Math.round(c[0])));
  px[i + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
  px[i + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
  px[i + 3] = 255;
};
const mix = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ t) => [0, 1, 2].map((i) => a[i] * (1 - t) + b[i] * t);
const WOOD = [176, 128, 72];
const CHAR = [44, 30, 20];
// 板張り：4マスごとの板、木目、焦げ
for (let y = 0; y < 32; y++) {
  const plank = Math.floor(y / 4);
  for (let x = 0; x < 32; x++) {
    let c = WOOD.map((v) => v * (0.88 + hash(plank, 1) * 0.2));
    if (hash(x, plank, 2) < 0.25) c = c.map((v) => v * 0.9); // 木目
    // 焦げ（板の端ほど濃い、ところどころ斑点）
    const edge = Math.min(x, 31 - x) / 16;
    const burn = Math.max(0, 0.75 - edge) * 0.8 + (hash(Math.floor(x / 3), plank, 3) < 0.3 ? 0.35 : 0) + hash(x, y, 4) * 0.15;
    c = mix(c, CHAR, Math.min(0.85, burn));
    if (y % 4 === 3) c = mix(c, CHAR, 0.7); // 板の継ぎ目
    if (hash(x, plank, 5) < 0.03) c = mix(c, [20, 14, 10], 0.9); // 釘穴
    set(x, y, c);
  }
}
// 木口
for (let y = 0; y < 16; y++) for (let x = 32; x < 48; x++) set(x, y, mix(WOOD, CHAR, 0.45 + hash(x, y, 6) * 0.2));
// 鉄
for (let y = 0; y < 8; y++) {
  for (let x = 48; x < 56; x++) set(x, y, [74, 70, 68].map((v) => v * (0.9 + hash(x, y, 7) * 0.2)));
  for (let x = 56; x < 64; x++) set(x, y, [42, 40, 40].map((v) => v * (0.9 + hash(x, y, 8) * 0.2)));
}
write("packs/RP/textures/entity/blockai/storehouse.png", encodePng(S, S, px));

// ---------------------------------------------------------------
// モデル
// ---------------------------------------------------------------
const face = (/** @type {number} */ u, /** @type {number} */ v, /** @type {number} */ w, /** @type {number} */ h) => ({ uv: [u, v], uv_size: [w, h] });
const all = (/** @type {any} */ f) => ({ north: f, south: f, east: f, west: f, up: f, down: f });
const wood = all(face(0, 0, 32, 32));
const iron = all(face(48, 0, 8, 8));
const ironDark = all(face(56, 0, 8, 8));
const box = (/** @type {number[]} */ origin, /** @type {number[]} */ size, /** @type {any} */ uv) => ({ origin, size, uv });

// ふたは奥行き方向に丸い（横から見るとアーチ）
const LID = [
  [9, 2, 12],
  [11, 1.5, 11],
  [12.5, 1, 9],
  [13.5, 0.7, 6],
];
const lidCubes = [];
for (const [y, h, d] of LID) {
  lidCubes.push(box([-7, y, -d / 2], [14, h, d], wood));
  // 両端の鉄の縁（アーチに沿う）
  lidCubes.push(box([-7.1, y, -d / 2 - 0.1], [0.9, h, d + 0.2], iron));
  lidCubes.push(box([6.2, y, -d / 2 - 0.1], [0.9, h, d + 0.2], iron));
}
lidCubes.push(box([-7.2, 9, -6.2], [14.4, 0.6, 12.4], ironDark)); // ふたの縁
lidCubes.push(box([-0.8, 8.2, -6.6], [1.6, 2.6, 0.5], ironDark)); // 留め金

writeJson("packs/RP/models/entity/storehouse.geo.json", {
  format_version: "1.12.0",
  "minecraft:geometry": [
    {
      description: {
        identifier: "geometry.blockai.storehouse",
        texture_width: 64,
        texture_height: 64,
        visible_bounds_width: 2,
        visible_bounds_height: 2,
        visible_bounds_offset: [0, 0.5, 0],
      },
      bones: [
        { name: "root", pivot: [0, 0, 0] },
        {
          name: "base",
          parent: "root",
          pivot: [0, 0, 0],
          cubes: [
            box([-7, 0, -6], [14, 9, 12], wood),
            box([-7.2, 0, -6.2], [14.4, 1, 12.4], ironDark), // 下の縁
            box([-7.2, 8.2, -6.2], [14.4, 0.8, 12.4], iron), // 上の縁
            // 角の鉄枠
            box([-7.3, 0, -6.3], [1, 9, 1], iron),
            box([6.3, 0, -6.3], [1, 9, 1], iron),
            box([-7.3, 0, 5.3], [1, 9, 1], iron),
            box([6.3, 0, 5.3], [1, 9, 1], iron),
            // 錠前と、横の取っ手
            box([-1.3, 4.5, -6.6], [2.6, 3.6, 0.6], ironDark),
            box([-0.5, 5.4, -6.9], [1, 1.4, 0.4], iron),
            box([7, 5, -1.5], [0.5, 1.5, 3], ironDark),
            box([-7.5, 5, -1.5], [0.5, 1.5, 3], ironDark),
          ],
        },
        { name: "lid", parent: "root", pivot: [0, 9, 6], cubes: lidCubes },
      ],
    },
  ],
});

writeJson("packs/RP/animations/storehouse.animation.json", {
  format_version: "1.8.0",
  animations: {
    "animation.blockai.storehouse.lid": {
      loop: true,
      bones: { lid: { rotation: ["-v.lid", 0, 0] } },
    },
  },
});

writeJson("packs/RP/render_controllers/storehouse.render_controllers.json", {
  format_version: "1.8.0",
  render_controllers: {
    "controller.render.blockai_storehouse": {
      geometry: "Geometry.default",
      materials: [{ "*": "Material.default" }],
      textures: ["Texture.default"],
    },
  },
});

writeJson("packs/RP/entity/storehouse.entity.json", {
  format_version: "1.10.0",
  "minecraft:client_entity": {
    description: {
      identifier: "blockai:storehouse",
      materials: { default: "entity_alphatest" },
      textures: { default: "textures/entity/blockai/storehouse" },
      geometry: { default: "geometry.blockai.storehouse" },
      scripts: {
        pre_animation: [
          "v.target = (query.has_property('blockai:open') && query.property('blockai:open')) ? 70.0 : 0.0;",
          "v.lid = math.lerp(v.lid ?? 0.0, v.target, 0.25);",
        ],
        animate: ["lid"],
      },
      animations: { lid: "animation.blockai.storehouse.lid" },
      render_controllers: ["controller.render.blockai_storehouse"],
    },
  },
});

if (check && stale > 0) process.exit(1);
if (!check) console.log("storehouse written");
