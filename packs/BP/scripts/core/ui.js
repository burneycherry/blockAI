import { system } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { LEVEL_XP, MAX_VILLAGERS, VERSION, VILLAGER_ID, carryCapacity, workInterval } from "./config.js";
import { PLANNED_JOBS, allJobs, getJobDef } from "./registry.js";
import { foundVillage, getVillage, setStorage } from "./village.js";
import { clearAllTasks, ensureStorageMarker } from "./tasks.js";
import {
  carryTotal,
  getAllVillagers,
  getCarry,
  getJob,
  getName,
  getStatus,
  getOption,
  getXp,
  jobHistory,
  setOption,
  initVillager,
  levelOf,
  setJob,
  setName,
} from "./villager.js";

/**
 * @typedef {import("@minecraft/server").Player} Player
 * @typedef {import("@minecraft/server").Entity} Entity
 */

const ITEM_NAMES = {
  "minecraft:oak_log": "オークの原木",
  "minecraft:spruce_log": "トウヒの原木",
  "minecraft:birch_log": "シラカバの原木",
  "minecraft:jungle_log": "ジャングルの原木",
  "minecraft:acacia_log": "アカシアの原木",
  "minecraft:dark_oak_log": "ダークオークの原木",
  "minecraft:cherry_log": "サクラの原木",
  "minecraft:mangrove_log": "マングローブの原木",
  "minecraft:pale_oak_log": "ペールオークの原木",
  "minecraft:wheat": "小麦",
  "minecraft:wheat_seeds": "小麦の種",
  "minecraft:carrot": "ニンジン",
  "minecraft:potato": "ジャガイモ",
  "minecraft:beetroot": "ビートルート",
  "minecraft:beetroot_seeds": "ビートルートの種",
};

/** @param {string} id */
function itemName(id) {
  return ITEM_NAMES[/** @type {keyof typeof ITEM_NAMES} */ (id)] ?? id.replace("minecraft:", "");
}

/** @param {Record<string, number>} items */
function itemList(items) {
  const keys = Object.keys(items).filter((k) => items[k] > 0);
  if (keys.length === 0) return "  なし";
  return keys.map((k) => `  ${itemName(k)} × ${items[k]}`).join("\n");
}

/**
 * 村長メニュー
 * @param {Player} player
 */
export async function openMainMenu(player) {
  const village = getVillage();
  if (!village) {
    const res = await new MessageFormData()
      .title("村長の杖")
      .body(
        "まだ村がありません。\n\n今立っている場所を「村の中心」にして、村を作りますか？\n\n村の中心から半径32ブロックが村人の仕事場になります。",
      )
      .button1("やめる")
      .button2("ここに村を作る")
      .show(player);
    if (res.selection === 1) {
      foundVillage(player.dimension.id, player.location, player.name);
      player.sendMessage("§a[blockAI] 村ができました！ 次はチェストを置いて「倉庫を登録」しましょう。");
      player.dimension.playSound("random.levelup", player.location);
    }
    return;
  }

  const villagers = getAllVillagers();
  /** @type {Record<string, number>} */
  const jobCount = {};
  for (const v of villagers) {
    const j = getJob(v).name;
    jobCount[j] = (jobCount[j] || 0) + 1;
  }
  const jobText = Object.keys(jobCount).map((k) => `${k}:${jobCount[k]}`).join(" / ") || "なし";
  const s = village.storage;
  const body = [
    `村長: §e${village.mayor}§r`,
    `村人: ${villagers.length} / ${MAX_VILLAGERS} 人`,
    `  ${jobText}`,
    `中心: ${village.center.x}, ${village.center.y}, ${village.center.z}`,
    `倉庫: ${s ? `${s.x}, ${s.y}, ${s.z}` : "§c未登録§r"}`,
  ].join("\n");

  const form = new ActionFormData()
    .title(`村長メニュー v${VERSION}`)
    .body(body)
    .button("村人を雇う")
    .button("村人の一覧")
    .button("倉庫を登録")
    .button("村の記録")
    .button("村の中心をここに移す")
    .button("遊び方");
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  switch (res.selection) {
    case 0:
      hireVillager(player);
      break;
    case 1:
      await openVillagerList(player);
      break;
    case 2:
      registerStorage(player);
      break;
    case 3:
      await showRecord(player);
      break;
    case 4:
      await moveCenter(player);
      break;
    case 5:
      await showHelp(player);
      break;
  }
}

/** @param {Player} player */
function hireVillager(player) {
  const count = getAllVillagers().length;
  if (count >= MAX_VILLAGERS) {
    player.sendMessage(`§c[blockAI] 村人は最大 ${MAX_VILLAGERS} 人までです。`);
    return;
  }
  const dir = player.getViewDirection();
  const loc = {
    x: player.location.x + dir.x * 2,
    y: player.location.y,
    z: player.location.z + dir.z * 2,
  };
  const e = player.dimension.spawnEntity(VILLAGER_ID, loc);
  initVillager(e);
  player.sendMessage(`§a[blockAI] ${getName(e)} が村にやってきました！ 杖でタップして仕事を与えましょう。`);
}

/** @param {Player} player */
async function openVillagerList(player) {
  const villagers = getAllVillagers();
  if (villagers.length === 0) {
    player.sendMessage("§e[blockAI] 村人がいません。「村人を雇う」で呼びましょう。");
    return;
  }
  const form = new ActionFormData().title("村人の一覧");
  for (const v of villagers) {
    const lv = levelOf(getXp(v));
    const status = getStatus(v).replace(/§./g, "");
    form.button(`${getName(v)}  [${getJob(v).name} Lv${lv}]\n${status}`);
  }
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const target = villagers[res.selection];
  if (target && target.isValid) await openVillagerMenu(player, target);
}

/**
 * 村人ごとのメニュー
 * @param {Player} player
 * @param {Entity} v
 */
export async function openVillagerMenu(player, v) {
  const xp = getXp(v);
  const lv = levelOf(xp);
  const next = LEVEL_XP[lv];
  const carry = getCarry(v);
  const job = getJob(v);
  const others = jobHistory(v)
    .filter((h) => h.jobId !== job.id)
    .map((h) => `${getJobDef(h.jobId).name} Lv${levelOf(h.xp)}`);
  const body = [
    `名前: §e${getName(v)}§r`,
    `職業: ${job.name}`,
    `レベル: ${lv}  (経験値 ${xp}${next !== undefined ? ` / ${next}` : " MAX"})`,
    `  作業の速さ ${(workIntervalSec(lv)).toFixed(2)}秒/個・一度に ${carryCapacity(lv)}個 運べる`,
    others.length > 0 ? `ほかの職業の経験: ${others.join(" / ")}` : "",
    `状態: ${getStatus(v) || "-"}`,
    `持ち物 (${carryTotal(carry)} / ${carryCapacity(lv)}):`,
    itemList(carry),
  ]
    .filter((l) => l !== "")
    .join("\n");
  const form = new ActionFormData()
    .title(getName(v))
    .body(body)
    .button("職業を変える")
    .button("名前を変える")
    .button("ここに呼ぶ")
    .button("解雇する");
  if (job.options && job.options.length > 0) form.button(`${job.name}の作業設定`);
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined || !v.isValid) return;
  switch (res.selection) {
    case 4:
      await editOptions(player, v);
      break;
    case 0:
      await chooseJob(player, v);
      break;
    case 1:
      await rename(player, v);
      break;
    case 2:
    {
      // プレイヤーに重ならないよう、目の前2ブロックに呼ぶ
      const dir = player.getViewDirection();
      const to = { x: player.location.x + dir.x * 2, y: player.location.y, z: player.location.z + dir.z * 2 };
      v.teleport(to, { dimension: player.dimension, facingLocation: player.location });
    }
      player.sendMessage(`§a[blockAI] ${getName(v)} を呼びました。`);
      break;
    case 3:
      await dismiss(player, v);
      break;
  }
}

/**
 * 職業ごとの作業設定（例: 木こりの植え直し）
 * @param {Player} player
 * @param {Entity} v
 */
async function editOptions(player, v) {
  const job = getJob(v);
  const opts = job.options ?? [];
  const form = new ModalFormData().title(`${job.name}の作業設定`);
  for (const o of opts) form.toggle(o.label, { defaultValue: getOption(v, job, o.id) });
  const res = await form.show(player);
  if (res.canceled || !res.formValues || !v.isValid) return;
  opts.forEach((o, i) => setOption(v, job, o.id, res.formValues?.[i] === true));
  player.sendMessage(`§a[blockAI] ${getName(v)} の作業設定を変えました。`);
}

/** @param {number} lv */
function workIntervalSec(lv) {
  return workInterval(lv) / 20;
}

/**
 * @param {Player} player
 * @param {Entity} v
 */
async function chooseJob(player, v) {
  const jobs = allJobs();
  const form = new ActionFormData().title("職業を選ぶ").body(`${getName(v)} の新しい職業は？`);
  for (const j of jobs) {
    const tag = j.pack === "基本" ? "" : ` §2[${j.pack}]`;
    const xp = getXp(v, j.id);
    form.button(`${j.name}${xp > 0 ? ` Lv${levelOf(xp)}` : ""}${tag}`);
  }
  // 今後の職業パックの紹介
  for (const p of PLANNED_JOBS) form.button(`§8${p.name}（${p.pack}・近日公開）`);
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined || !v.isValid) return;
  const job = jobs[res.selection];
  if (!job) {
    const planned = PLANNED_JOBS[res.selection - jobs.length];
    if (planned) {
      player.sendMessage(`§e[blockAI] ${planned.name} は「${planned.pack}」で追加予定です。お楽しみに！`);
    }
    return;
  }
  setJob(v, job.id);
  const lv = levelOf(getXp(v, job.id));
  player.sendMessage(`§a[blockAI] ${getName(v)} は ${job.name} Lv${lv} になりました。§7${job.description}`);
  if (job.work && !getVillage()?.storage) {
    player.sendMessage("§e[blockAI] ヒント: 倉庫を登録すると、集めた物をチェストに運んでくれます。");
  }
}

/**
 * @param {Player} player
 * @param {Entity} v
 */
async function rename(player, v) {
  const res = await new ModalFormData()
    .title("名前を変える")
    .textField("新しい名前", "例: タロウ", { defaultValue: getName(v) })
    .show(player);
  if (res.canceled || !res.formValues || !v.isValid) return;
  const name = String(res.formValues[0] ?? "").trim().slice(0, 16);
  if (name.length === 0) return;
  setName(v, name);
  player.sendMessage(`§a[blockAI] 名前を ${name} に変えました。`);
}

/**
 * @param {Player} player
 * @param {Entity} v
 */
async function dismiss(player, v) {
  const name = getName(v);
  const res = await new MessageFormData()
    .title("解雇する")
    .body(`${name} を解雇しますか？\n（持ち物は失われます）`)
    .button1("やめる")
    .button2("解雇する")
    .show(player);
  if (res.selection !== 1 || !v.isValid) return;
  v.remove();
  player.sendMessage(`§e[blockAI] ${name} は村を去りました。`);
}

/** @param {Player} player */
function registerStorage(player) {
  const village = getVillage();
  if (!village) return;
  const hit = player.getBlockFromViewDirection({ maxDistance: 8 });
  const block = hit?.block;
  const container = block?.getComponent("minecraft:inventory")?.container;
  if (!block || !container) {
    player.sendMessage("§c[blockAI] チェスト（または樽）を見ながら「倉庫を登録」を選んでください。");
    return;
  }
  if (player.dimension.id !== village.dim) {
    player.sendMessage("§c[blockAI] 村と同じディメンションのチェストを選んでください。");
    return;
  }
  setStorage({ x: block.x, y: block.y, z: block.z });
  const v = getVillage();
  if (v) ensureStorageMarker(v);
  player.sendMessage(`§a[blockAI] 倉庫を登録しました (${block.x}, ${block.y}, ${block.z})。村人が集めた物がここに届きます。`);
}

/** @param {Player} player */
async function showRecord(player) {
  const village = getVillage();
  if (!village) return;
  await new ActionFormData()
    .title("村の記録")
    .body(`これまでに倉庫へ届いた物:\n${itemList(village.stats)}`)
    .button("閉じる")
    .show(player);
}

/** @param {Player} player */
async function moveCenter(player) {
  const res = await new MessageFormData()
    .title("村の中心を移す")
    .body("今立っている場所を新しい村の中心にしますか？\n（探していた仕事はリセットされます）")
    .button1("やめる")
    .button2("移す")
    .show(player);
  if (res.selection !== 1) return;
  const old = getVillage();
  foundVillage(player.dimension.id, player.location, old ? old.mayor : player.name);
  clearAllTasks();
  player.sendMessage("§a[blockAI] 村の中心を移しました。");
}

/** @param {Player} player */
async function showHelp(player) {
  await new ActionFormData()
    .title("遊び方")
    .body(
      [
        "§e1. 村を作る§r",
        "村長の杖を使い、村の中心を決めます。",
        "",
        "§e2. 倉庫を登録§r",
        "チェストを置き、それを見ながら「倉庫を登録」。",
        "",
        "§e3. 村人を雇う§r",
        "メニューから雇うか、スポーンエッグで呼びます。",
        "",
        "§e4. 仕事を与える§r",
        "村長の杖で村人をタップ →「職業を変える」。",
        "・木こり: 村の周りの木を切って、苗木を植え直す（作業設定で植え直しをOFFにもできる）",
        "・農家: 実った小麦・ニンジン等を収穫して植え直す",
        "",
        "§e5. 成長§r",
        "働くと経験値が貯まりレベルアップ。作業が速くなり、たくさん運べるようになります。",
        "経験値は職業ごとに記録されます。別の職業に変えても、元の職業に戻せば続きからです。",
        "",
        "§7※ プレイヤーから離れた村人は、移動や作業を省略して素早く仕事をします。",
      ].join("\n"),
    )
    .button("閉じる")
    .show(player);
}

/**
 * フォームは他の画面を閉じた直後だと開けないことがあるので、少し待って開く
 * @param {() => Promise<void>} fn
 */
export function openSoon(fn) {
  system.run(() => {
    fn().catch((err) => console.warn(`[blockAI] form error: ${err}`));
  });
}
