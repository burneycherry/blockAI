// 倒木の演出用エンティティ（blockai:falling_tree）の定義を生成する
//   原木 16 段 + 葉のかたまり。高さと木の種類はエンティティのプロパティで切り替える
// 使い方: node tools/gen-tree.mjs        （書き出し）
//         node tools/gen-tree.mjs --check（最新かどうかだけ確認）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_H = 16;
// 木の種類（lumberjack.js の WOODS と同じ順番）
const WOODS = [
  ["oak", "textures/blocks/log_oak", "textures/blocks/leaves_oak_carried"],
  ["spruce", "textures/blocks/log_spruce", "textures/blocks/leaves_spruce_carried"],
  ["birch", "textures/blocks/log_birch", "textures/blocks/leaves_birch_carried"],
  ["jungle", "textures/blocks/log_jungle", "textures/blocks/leaves_jungle_carried"],
  ["acacia", "textures/blocks/log_acacia", "textures/blocks/leaves_acacia_carried"],
  ["dark_oak", "textures/blocks/log_big_oak", "textures/blocks/leaves_big_oak_carried"],
  ["cherry", "textures/blocks/cherry_log_side", "textures/blocks/cherry_leaves"],
  ["mangrove", "textures/blocks/mangrove_log_side", "textures/blocks/mangrove_leaves_carried"],
  ["pale_oak", "textures/blocks/pale_oak_log_side", "textures/blocks/pale_oak_leaves"],
];

const check = process.argv.includes("--check");
let stale = 0;
function out(path, data) {
  const text = JSON.stringify(data, null, 2) + "\n";
  let old = "";
  try {
    old = readFileSync(path, "utf8");
  } catch (e) {
    // 新規
  }
  if (old === text) return;
  if (check) {
    console.error(`NG: ${path} が古いです。node tools/gen-tree.mjs を実行してください`);
    stale++;
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}

// 1ブロック分の立方体（各面にテクスチャ全体を貼る）
const face = { uv: [0, 0], uv_size: [16, 16] };
const cube = (x, y, z) => ({
  origin: [x * 16 - 8, y * 16, z * 16 - 8],
  size: [16, 16, 16],
  uv: { north: face, south: face, east: face, west: face, up: face, down: face },
});

const bones = [{ name: "root", pivot: [0, 0, 0] }];
for (let i = 0; i < MAX_H; i++) bones.push({ name: `log_${i}`, parent: "root", pivot: [0, 0, 0], cubes: [cube(0, i, 0)] });
// 葉: 下2段は 5x5 の角抜き（幹の位置は空ける）、3段目は 3x3、一番上は十字
const leaves = [];
for (let y = 0; y < 2; y++) {
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      if (Math.abs(x) === 2 && Math.abs(z) === 2) continue;
      if (x === 0 && z === 0) continue;
      leaves.push(cube(x, y, z));
    }
  }
}
for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) leaves.push(cube(x, 2, z));
for (const [x, z] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) leaves.push(cube(x, 3, z));
bones.push({ name: "leaves", parent: "root", pivot: [0, 0, 0], cubes: leaves });

out("packs/RP/models/entity/falling_tree.geo.json", {
  format_version: "1.12.0",
  "minecraft:geometry": [
    {
      description: {
        identifier: "geometry.blockai.falling_tree",
        texture_width: 16,
        texture_height: 16,
        visible_bounds_width: 48,
        visible_bounds_height: 48,
        visible_bounds_offset: [0, 8, 0],
      },
      bones,
    },
  ],
});

const H = "query.property('blockai:height')";
const W = "query.property('blockai:wood')";

out("packs/RP/animations/falling_tree.animation.json", {
  format_version: "1.8.0",
  animations: {
    "animation.blockai.falling_tree.fall": {
      loop: true,
      bones: {
        // だんだん速く倒れる（約1.1秒で横倒し）
        root: { rotation: [`math.min(query.life_time * query.life_time * 75, 90)`, 0, 0] },
        // 葉は幹のてっぺんに合わせて持ち上げる
        leaves: { position: [0, `math.max(${H} - 2, 0) * 16`, 0] },
      },
    },
  },
});

const logVis = [];
const hideLogs = [];
for (let i = 0; i < MAX_H; i++) {
  logVis.push({ [`log_${i}`]: `${H} > ${i}` });
  hideLogs.push({ [`log_${i}`]: false });
}
out("packs/RP/render_controllers/falling_tree.render_controllers.json", {
  format_version: "1.8.0",
  render_controllers: {
    "controller.render.blockai_tree_logs": {
      arrays: { textures: { "Array.logs": WOODS.map(([n]) => `Texture.log_${n}`) } },
      geometry: "Geometry.default",
      materials: [{ "*": "Material.default" }],
      textures: [`Array.logs[${W}]`],
      part_visibility: [{ leaves: false }, ...logVis],
    },
    "controller.render.blockai_tree_leaves": {
      arrays: { textures: { "Array.leaves": WOODS.map(([n]) => `Texture.leaves_${n}`) } },
      geometry: "Geometry.default",
      materials: [{ "*": "Material.default" }],
      textures: [`Array.leaves[${W}]`],
      part_visibility: [{ leaves: true }, ...hideLogs],
    },
  },
});

const textures = {};
for (const [n, log, leaf] of WOODS) {
  textures[`log_${n}`] = log;
  textures[`leaves_${n}`] = leaf;
}
out("packs/RP/entity/falling_tree.entity.json", {
  format_version: "1.10.0",
  "minecraft:client_entity": {
    description: {
      identifier: "blockai:falling_tree",
      materials: { default: "entity_alphatest" },
      textures,
      geometry: { default: "geometry.blockai.falling_tree" },
      animations: { fall: "animation.blockai.falling_tree.fall" },
      scripts: { animate: ["fall"] },
      render_controllers: ["controller.render.blockai_tree_logs", "controller.render.blockai_tree_leaves"],
    },
  },
});

out("packs/BP/entities/falling_tree.json", {
  format_version: "1.21.0",
  "minecraft:entity": {
    description: {
      identifier: "blockai:falling_tree",
      is_spawnable: false,
      is_summonable: true,
      properties: {
        "blockai:height": { type: "int", range: [1, MAX_H], default: 5, client_sync: true },
        "blockai:wood": { type: "int", range: [0, WOODS.length - 1], default: 0, client_sync: true },
      },
    },
    components: {
      "minecraft:type_family": { family: ["blockai_prop"] },
      "minecraft:collision_box": { width: 0.01, height: 0.01 },
      // タップ・攻撃の当たり判定を地面の下へ逃がす（チェスト等の操作を邪魔しない）
      "minecraft:custom_hit_test": { hitboxes: [{ width: 0.01, height: 0.01, pivot: [0, -64, 0] }] },
      "minecraft:health": { value: 1, max: 1 },
      "minecraft:damage_sensor": { triggers: [{ cause: "all", deals_damage: "no" }] },
      "minecraft:physics": { has_gravity: false, has_collision: false },
      "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
      "minecraft:knockback_resistance": { value: 1.0 },
      "minecraft:fire_immune": {},
      "minecraft:breathable": { breathes_water: true, breathes_air: true, suffocate_time: 0, total_supply: 15 },
    },
  },
});

if (stale > 0) process.exit(1);
