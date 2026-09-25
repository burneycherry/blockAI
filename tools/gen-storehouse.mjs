// 村の倉庫（blockai:storehouse）の見た目を生成する：普通のチェストの形で、焦げ目のある板張りと鉄枠。村人が使うとふたが開く
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

/**
 * 四角い縁取り（外周の帯だけ。真ん中は木が見える）
 * @param {number} y
 * @param {number} h
 * @param {any} uv
 */
const frame = (y, h, uv) => [
  box([-7.15, y, -7.15], [14.3, h, 1], uv),
  box([-7.15, y, 6.15], [14.3, h, 1], uv),
  box([-7.15, y, -6.15], [1, h, 12.3], uv),
  box([6.15, y, -6.15], [1, h, 12.3], uv),
];
// 形は普通のチェストと同じ（14x14x14。本体10段＋ふた4段＋留め金）
const lidCubes = [
  box([-7, 10, -7], [14, 4, 14], wood),
  ...frame(13.4, 0.7, iron), // ふたの上の縁
  ...frame(10, 0.6, ironDark), // ふたの下の縁
  box([-1, 7, -8], [2, 4, 1], ironDark), // 留め金
];
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
            box([-7, 0, -7], [14, 10, 14], wood),
            ...frame(0, 0.7, ironDark), // 下の縁
            ...frame(9.4, 0.6, iron), // 上の縁
            // 角の鉄枠
            box([-7.25, 0, -7.25], [1, 10, 1], iron),
            box([6.25, 0, -7.25], [1, 10, 1], iron),
            box([-7.25, 0, 6.25], [1, 10, 1], iron),
            box([6.25, 0, 6.25], [1, 10, 1], iron),
          ],
        },
        { name: "lid", parent: "root", pivot: [0, 10, 7], cubes: lidCubes },
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
      // 叩かれても赤く光らない
      is_hurt_color: { r: 0, g: 0, b: 0, a: 0 },
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

// ---------------------------------------------------------------
// 当たり判定用の見えないブロック（普通のチェストと同じ 14x14x14）
// 倉庫のエンティティはこの中に入っている。ブロックなので、歩いて近づくと自動ジャンプで乗れる
// ---------------------------------------------------------------
writeJson("packs/BP/blocks/storehouse_block.json", {
  format_version: "1.21.40",
  "minecraft:block": {
    description: {
      identifier: "blockai:storehouse_block",
      menu_category: { category: "none", is_hidden_in_commands: true },
    },
    components: {
      "minecraft:collision_box": { origin: [-7, 0, -7], size: [14, 14, 14] },
      "minecraft:selection_box": { origin: [-7, 0, -7], size: [14, 14, 14] },
      "minecraft:geometry": "minecraft:geometry.full_block",
      "minecraft:material_instances": { "*": { texture: "blockai_invisible", render_method: "alpha_test", ambient_occlusion: false, face_dimming: false } },
      "minecraft:destructible_by_mining": false,
      "minecraft:destructible_by_explosion": false,
      "minecraft:light_dampening": 0,
      "minecraft:loot": "loot_tables/blockai/empty.json",
    },
  },
});
writeJson("packs/BP/loot_tables/blockai/empty.json", { pools: [] });
writeJson("packs/RP/textures/terrain_texture.json", {
  resource_pack_name: "blockai",
  texture_name: "atlas.terrain",
  texture_data: { blockai_invisible: { textures: "textures/blockai/invisible" } },
});
write("packs/RP/textures/blockai/invisible.png", encodePng(16, 16, new Uint8Array(16 * 16 * 4)));
writeJson("packs/RP/blocks.json", { format_version: [1, 1, 0], "blockai:storehouse_block": { sound: "wood" } });

// 叩かれたときの音は鳴らさない
writeJson("packs/RP/sounds.json", {
  entity_sounds: {
    entities: {
      "blockai:storehouse": {
        volume: 1.0,
        pitch: 1.0,
        events: {
          hurt: { sound: "random.chestopen", volume: 0.0 },
          death: { sound: "random.chestclosed", volume: 0.0 },
        },
      },
    },
  },
});

if (check && stale > 0) process.exit(1);
if (!check) console.log("storehouse written");
