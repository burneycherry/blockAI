// 職業の枠（スロット）ごとの定義を生成する
//   村人: blockai:mode_to_slot_N で、枠 N のマーカーを追いかける
//   マーカー: blockai:slot_N で、枠 N の family を持つ
// 使い方: node tools/gen-entities.mjs        （書き出し）
//         node tools/gen-entities.mjs --check（最新かどうかだけ確認）
import { readFileSync, writeFileSync } from "node:fs";

const SLOTS = 16; // core/registry.js の MAX_SLOTS と合わせる
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
    console.error(`NG: ${path} が古いです。node tools/gen-entities.mjs を実行してください`);
    stale++;
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}

const reg = readFileSync("packs/BP/scripts/core/registry.js", "utf8");
if (!reg.includes(`MAX_SLOTS = ${SLOTS};`)) {
  console.error("NG: registry.js の MAX_SLOTS と tools/gen-entities.mjs の SLOTS が違います");
  process.exit(1);
}

// ---- 村人 ----
const vPath = "packs/BP/entities/villager.json";
const villager = JSON.parse(readFileSync(vPath, "utf8"));
const ent = villager["minecraft:entity"];
// 首を動かす行動は、モードごとの組に入れる（寝ている間に回らないように）
delete ent.components["minecraft:behavior.look_at_player"];
delete ent.components["minecraft:behavior.random_look_around"];
const moveGroups = (family) => ({
  "minecraft:behavior.nearest_attackable_target": {
    priority: 2,
    must_see: false,
    must_reach: false,
    reselect_targets: true,
    within_radius: 64,
    scan_interval: 10,
    entity_types: [{ filters: { test: "is_family", subject: "other", value: family }, max_dist: 64 }],
  },
  "minecraft:behavior.melee_attack": {
    priority: 3,
    speed_multiplier: 1.0,
    track_target: true,
    require_complete_path: false,
  },
});
const groups = {
  "blockai:mode_idle": {
    "minecraft:behavior.random_stroll": { priority: 8, speed_multiplier: 0.6, xz_dist: 6 },
    "minecraft:behavior.random_look_around": { priority: 9 },
    "minecraft:behavior.look_at_player": { priority: 7, look_distance: 6, probability: 0.02 },
  },
  "blockai:mode_to_storage": moveGroups("blockai_wp_storage"),
  "blockai:mode_work": {
    "minecraft:behavior.random_look_around": { priority: 9 },
    "minecraft:behavior.look_at_player": { priority: 7, look_distance: 6, probability: 0.02 },
  },
  // 寝ている間は、首や体を動かす行動を何も持たない
  "blockai:mode_sleep": { "minecraft:variant": { value: 0 } },
};
for (let i = 0; i < SLOTS; i++) groups[`blockai:mode_to_slot_${i}`] = moveGroups(`blockai_wp_slot_${i}`);
// 夜にベッドへ向かう
groups["blockai:mode_to_home"] = moveGroups("blockai_wp_home");
const names = Object.keys(groups);
// 体力（レベルで増える。core/config.js の MAX_HP と同じ値）
const HP = [20, 22, 24, 27, 29, 31, 33, 36, 38, 40];
const hpNames = HP.map((_, i) => `blockai:hp_${i}`);
HP.forEach((hp, i) => {
  groups[hpNames[i]] = { "minecraft:health": { value: hp, max: hp } };
});
ent.component_groups = groups;
// 見た目（キャラクター・体型・寝ているか）
ent.description.properties = {
  "blockai:job": { type: "int", range: [0, 14], default: 0, client_sync: true },
  "blockai:tier": { type: "int", range: [0, 4], default: 0, client_sync: true },
  "blockai:char": { type: "int", range: [0, 19], default: 0, client_sync: true },
  "blockai:build": { type: "int", range: [0, 2], default: 0, client_sync: true },
  "blockai:pose": { type: "int", range: [0, 1], default: 0, client_sync: true },
};
const events = {
  "minecraft:entity_spawned": { add: { component_groups: ["blockai:mode_idle"] } },
};
for (const g of names) {
  events[g] = {
    remove: { component_groups: names.filter((n) => n !== g) },
    add: { component_groups: [g] },
  };
}
for (const g of hpNames) {
  events[g] = { remove: { component_groups: hpNames.filter((n) => n !== g) }, add: { component_groups: [g] } };
}
ent.events = events;
out(vPath, villager);

// ---- 仕事のマーカー ----
const base = JSON.parse(readFileSync("packs/BP/entities/wp_storage.json", "utf8"));
const wp = structuredClone(base);
const w = wp["minecraft:entity"];
w.description.identifier = "blockai:wp_task";
w.components["minecraft:type_family"] = { family: ["blockai_wp"] };
w.component_groups = {};
w.events = {};
for (let i = 0; i < SLOTS; i++) {
  w.component_groups[`blockai:slot_${i}`] = {
    "minecraft:type_family": { family: ["blockai_wp", `blockai_wp_slot_${i}`] },
  };
  w.events[`blockai:slot_${i}`] = { add: { component_groups: [`blockai:slot_${i}`] } };
}
// ベッドの目印
w.component_groups["blockai:home"] = { "minecraft:type_family": { family: ["blockai_wp", "blockai_wp_home"] } };
w.events["blockai:home"] = { add: { component_groups: ["blockai:home"] } };
out("packs/BP/entities/wp_task.json", wp);

const rp = JSON.parse(readFileSync("packs/RP/entity/wp_storage.entity.json", "utf8"));
rp["minecraft:client_entity"].description.identifier = "blockai:wp_task";
out("packs/RP/entity/wp_task.entity.json", rp);

if (stale > 0) process.exit(1);
