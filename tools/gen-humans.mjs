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
import { Img, OUTFITS, SIZE, SWATCH, drawCharacter, drawHairOuter, stampSwatches } from "./human-art.mjs";

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
    stampSwatches(img);
    const key = `c${ci}_${o.id}`;
    texKeys.push(key);
    texMap[key] = `${TEX_DIR}/${key}`;
    write(`packs/RP/${TEX_DIR}/${key}.png`, encodePng(SIZE, SIZE, img.px));
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
      // 手斧：柄の先に、黒い鋼の頭と、下へ広がる刃（刃先は銀色）
      tool("tool_axe", [
        { origin: [hx - 0.5, 12, -11], size: [1, 1, 13], uv: solid("wood") },
        { origin: [hx - 0.5, 12, 1.2], size: [1, 1, 0.8], uv: solid("woodDark") },
        { origin: [hx - 0.65, 11.8, -11.4], size: [1.3, 1.4, 1.8], uv: solid("steelDark") },
        { origin: [hx - 0.35, 10, -11.8], size: [0.7, 1.6, 2.8], uv: solid("steel") },
        { origin: [hx - 0.35, 8.6, -12.2], size: [0.7, 1.4, 3.4], uv: solid("steel") },
        { origin: [hx - 0.35, 7.6, -12.6], size: [0.7, 1, 4], uv: solid("steel") },
        { origin: [hx - 0.4, 7.2, -12.6], size: [0.8, 0.4, 4], uv: solid("edge") },
      ]),
      // 鎌：白木の柄・黒い口金・下へ伸びて手前に曲がる刃（斧と同じく縦向き。内側が刃）
      tool("tool_sickle", [
        { origin: [hx - 0.5, 12, -8], size: [1, 1, 10], uv: solid("woodLight") },
        { origin: [hx - 0.6, 11.9, -9], size: [1.2, 1.2, 1.2], uv: solid("ferrule") },
        { origin: [hx - 0.2, 9.6, -9.2], size: [0.4, 2.2, 0.9], uv: solid("steelDark") },
        { origin: [hx - 0.2, 8.0, -9.0], size: [0.4, 1.8, 1.0], uv: solid("steel") },
        { origin: [hx - 0.2, 6.8, -8.4], size: [0.4, 1.4, 1.1], uv: solid("steel") },
        { origin: [hx - 0.2, 6.2, -7.4], size: [0.4, 0.9, 1.2], uv: solid("steel") },
        { origin: [hx - 0.2, 6.0, -6.3], size: [0.4, 0.6, 0.9], uv: solid("edge") },
        { origin: [hx - 0.2, 8.0, -8.1], size: [0.4, 1.8, 0.3], uv: solid("edge") },
        { origin: [hx - 0.2, 7.0, -7.4], size: [0.4, 1.2, 0.3], uv: solid("edge") },
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
    // 作業（斧を振る・鎌を振る）。スクリプトの playAnimation で再生する
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
    // ほっそり体型：胴・腕・脚を細くする
    "animation.blockai.human.slim": {
      loop: true,
      bones: {
        torso: { scale: [0.75, 1, 0.8] },
        rightArm: { scale: [0.8, 1, 0.8] },
        leftArm: { scale: [0.8, 1, 0.8] },
        rightLeg: { scale: [0.75, 1, 0.8] },
        leftLeg: { scale: [0.75, 1, 0.8] },
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
        { tool_sickle: `v.outfit == ${OUTFITS.findIndex((o) => o.id === "farmer")} && !v.sleep` },
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
