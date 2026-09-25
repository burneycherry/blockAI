import { ItemStack, system, world } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { LEVEL_XP, MAX_VILLAGERS, VERSION, VILLAGER_ID, carryCapacity, workInterval } from "./config.js";
import { PLANNED_JOBS, allJobs, getJobDef, workingJobs } from "./registry.js";
import { MAX_LEVEL } from "./config.js";
import {
  VILLAGE_LEVELS,
  addProtect,
  foundVillage,
  getVillage,
  removeProtect,
  setJobArea,
  reviveOn,
  setKeepLoaded,
  setRevive,
  setTestMode,
  villageLevel,
  workArea,
} from "./village.js";
import { syncTickingAreas } from "./loading.js";
import { clearAllTasks, clearJobTasks } from "./tasks.js";
import {
  carryTotal,
  getAllVillagers,
  getBag,
  getCarry,
  getCharacter,
  getHp,
  getJob,
  getName,
  getStatus,
  getOption,
  getXp,
  jobHistory,
  setOption,
  initVillager,
  levelOf,
  setCharacter,
  setJob,
  setName,
} from "./villager.js";
import { BUILD_NAMES, CHARACTERS } from "./characters.js";
import { fallenCount, fallenNames, forget } from "./life.js";
import { capacitySlots, getHouses, getStock, hasStorage, maxHouses, usedSlots } from "./storage.js";
import { placeStorehouse } from "./storage-ui.js";

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
  "minecraft:oak_sapling": "オークの苗木",
  "minecraft:spruce_sapling": "トウヒの苗木",
  "minecraft:birch_sapling": "シラカバの苗木",
  "minecraft:jungle_sapling": "ジャングルの苗木",
  "minecraft:acacia_sapling": "アカシアの苗木",
  "minecraft:dark_oak_sapling": "ダークオークの苗木",
  "minecraft:cherry_sapling": "サクラの苗木",
  "minecraft:mangrove_propagule": "マングローブの芽",
  "minecraft:pale_oak_sapling": "ペールオークの苗木",
  "minecraft:stick": "棒",
  "minecraft:apple": "リンゴ",
};

/** @param {string} id */
export function itemName(id) {
  return ITEM_NAMES[/** @type {keyof typeof ITEM_NAMES} */ (id)] ?? id.replace("minecraft:", "");
}

/**
 * アイテム名（ゲームの翻訳を使うので、どのアイテムでもプレイヤーの言語で表示される）
 * @param {string} id
 * @returns {import("@minecraft/server").RawMessage}
 */
export function itemRaw(id) {
  try {
    return { translate: new ItemStack(id, 1).localizationKey };
  } catch (err) {
    return { text: itemName(id) };
  }
}

/**
 * 文字列と翻訳を並べて1つのメッセージにする
 * @param {(string | import("@minecraft/server").RawMessage)[]} parts
 * @returns {import("@minecraft/server").RawMessage}
 */
export function raw(...parts) {
  return { rawtext: parts.map((p) => (typeof p === "string" ? { text: p } : p)) };
}

/**
 * アイテムの一覧（1行に1種類）
 * @param {Record<string, number>} items
 * @returns {import("@minecraft/server").RawMessage}
 */
function itemList(items) {
  const keys = Object.keys(items).filter((k) => items[k] > 0);
  if (keys.length === 0) return { text: "  なし" };
  /** @type {(string | import("@minecraft/server").RawMessage)[]} */
  const parts = [];
  keys.forEach((k, i) => parts.push(`${i > 0 ? "\n" : ""}  `, itemRaw(k), ` × ${items[k]}`));
  return raw(...parts);
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
      await applyLoading(player);
      player.sendMessage("§a[blockAI] 村ができました！ 次は村長メニューの「村の倉庫を置く」で倉庫を置きましょう。");
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
  const fallen = fallenNames();
  const body = [
    `村長: §e${village.mayor}§r`,
    `村人: ${villagers.length} / ${MAX_VILLAGERS} 人${fallen.length > 0 ? `（休養中: ${fallen.join("、")}）` : ""}`,
    `  ${jobText}`,
    (() => {
      const vl = villageLevel(village);
      return `村レベル: ${vl.level} / ${VILLAGE_LEVELS.length}（仕事の範囲 半径${vl.radius}）${
        vl.next !== undefined ? `\n  次のレベルまで 納品 ${vl.total} / ${vl.next}` : ""
      }`;
    })(),
    `中心: ${village.center.x}, ${village.center.y}, ${village.center.z}`,
    getHouses(village).length > 0
      ? `倉庫: ${getHouses(village).length} / ${maxHouses(village)} 個（${usedSlots(getStock())} / ${capacitySlots(village)} スタック使用中）`
      : "倉庫: §c未設置§r（「村の倉庫を置く」で置けます）",
  ].join("\n");

  const form = new ActionFormData()
    .title(`村長メニュー v${VERSION}`)
    .body(body)
    .button("村人を雇う")
    .button("村人の一覧")
    .button(`村の倉庫を置く（${getHouses(village).length} / ${maxHouses(village)}）`)
    .button("仕事場と立ち入り禁止エリア")
    .button("村の記録")
    .button("村の中心をここに移す")
    .button("遊び方")
    .button(village.testMode ? "§6村の設定（テストモード中）" : "村の設定");
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
      await storageMenu(player);
      break;
    case 3:
      await areaMenu(player);
      break;
    case 4:
      await showRecord(player);
      break;
    case 5:
      await moveCenter(player);
      break;
    case 6:
      await showHelp(player);
      break;
    case 7:
      await villageSettings(player);
      break;
  }
}

/**
 * 村の倉庫を置く
 * @param {Player} player
 */
async function storageMenu(player) {
  const v = getVillage();
  if (!v) return;
  const res = await new ActionFormData()
    .title("村の倉庫")
    .body(
      [
        "§e村の倉庫§r：チェストの形の倉庫を、今見ている場所に置きます。",
        "・村の中にいくつも置けて（村レベルで増える）、中身はどの倉庫でも同じです。村人は一番近い倉庫に運びます。",
        "・広さは村レベルで増えます（大きいチェスト 1 → 2 → 4 → 8 → 16 個分）。",
        "・倉庫をタップすると、取り出す・しまうができます。",
      ].join("\n"),
    )
    .button(`村の倉庫を置く（${getHouses(v).length} / ${maxHouses(v)}）`)
    .show(player);
  if (res.canceled || res.selection === undefined) return;
  placeStorehouse(player);
}

/** @param {Player} player */
function hireVillager(player) {
  const count = getAllVillagers().length + fallenCount();
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
    const job = getJob(v);
    form.button(`${getName(v)}  [${job.name}${job.work ? ` Lv${lv}` : ""}]\n${status}`);
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
  const hp = getHp(v);
  const ch = CHARACTERS[getCharacter(v)];
  const body = [
    `名前: §e${getName(v)}§r  §7(${ch.gender === "m" ? "男性" : "女性"}・${BUILD_NAMES[ch.build]})§r`,
    `職業: ${job.name}`,
    `体力: §c${hp.cur} / ${hp.max}§r  §7(一番高い職業レベルで増える)§r`,
    job.work ? `レベル: ${lv} / ${MAX_LEVEL}  (経験値 ${xp}${next !== undefined ? ` / ${next}` : " MAX"})` : "§7無職なのでレベルはありません。職業を与えると、その職業のレベルが上がります。§r",
    job.work ? `  作業の速さ ${(workIntervalSec(lv)).toFixed(2)}秒/個・一度に ${carryCapacity(lv)}個 運べる` : "",
    others.length > 0 ? `ほかの職業の経験: ${others.join(" / ")}` : "",
    ...(job.skills ?? []).map((sk) => {
      const has = lv >= sk.level || !!getVillage()?.testMode;
      return `${has ? "§a★" : "§8☆"} Lv${sk.level} ${sk.name}§r${has ? "" : "（未習得）"}\n  §7${sk.description}§r`;
    }),
    `状態: ${getStatus(v) || "-"}`,
    `持ち物 (${carryTotal(carry)} / ${carryCapacity(lv)}):`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  const bag = getBag(v);
  const bodyMsg = raw(
    body + "\n",
    itemList(carry),
    ...(carryTotal(bag) > 0 ? ["\n道具袋（倉庫から持ち出した材料）:\n", itemList(bag)] : []),
  );
  const form = new ActionFormData()
    .title(getName(v))
    .body(bodyMsg)
    .button("職業を変える")
    .button("名前を変える")
    .button("ここに呼ぶ")
    .button("解雇する")
    .button("見た目を選ぶ");
  if (job.options && job.options.length > 0) form.button(`${job.name}の作業設定`);
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined || !v.isValid) return;
  switch (res.selection) {
    case 4:
      await chooseLooks(player, v);
      break;
    case 5:
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
 * 見た目（キャラクター）を選ぶ。職業の衣装はそのまま
 * @param {Player} player
 * @param {Entity} v
 */
async function chooseLooks(player, v) {
  /** @type {Map<number, string>} */
  const usedBy = new Map();
  for (const o of getAllVillagers()) if (o.id !== v.id) usedBy.set(getCharacter(o), getName(o));
  const form = new ActionFormData().title("見た目を選ぶ").body(`${getName(v)} の見た目を選んでください。\n転職しても見た目はそのままで、衣装だけが変わります。`);
  CHARACTERS.forEach((c, i) => {
    const who = usedBy.get(i);
    form.button(`${c.gender === "m" ? "§9♂" : "§d♀"}§r ${c.name}（${BUILD_NAMES[c.build]}）${who ? ` §8[${who}]` : ""}\n§7${c.note}`);
  });
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined || !v.isValid) return;
  setCharacter(v, res.selection);
  player.sendMessage(`§a[blockAI] ${getName(v)} の見た目を変えました。`);
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

/**
 * 村の設定（遠くでも村を動かす・テストモード）
 * @param {Player} player
 */
async function villageSettings(player) {
  const v = getVillage();
  if (!v) return;
  const res = await new ModalFormData()
    .title("村の設定")
    .toggle("遠くにいても村を動かす（村と仕事場を常に読み込む。端末の負荷が少し増えます）", {
      defaultValue: v.keepLoaded !== false,
    })
    .toggle("テストモード: 特技をレベルに関係なく全部使えるようにする", { defaultValue: !!v.testMode })
    .toggle("村人が倒れても、翌朝に戻ってくる（OFFにすると、倒れたら二度と戻らない）", { defaultValue: reviveOn(v) })
    .show(player);
  if (res.canceled || !res.formValues) return;
  const keep = res.formValues[0] === true;
  const test = res.formValues[1] === true;
  const revive = res.formValues[2] === true;
  setKeepLoaded(keep);
  setTestMode(test);
  setRevive(revive);
  await applyLoading(player);
  player.sendMessage(
    `§a[blockAI] 設定を保存しました。遠くでも村を動かす: ${keep ? "ON" : "OFF"} / テストモード: ${test ? "ON" : "OFF"} / 翌朝に復活: ${revive ? "ON" : "OFF"}`,
  );
}

/**
 * 読み込み範囲を反映し、入りきらなかった場所があれば知らせる
 * @param {Player} player
 */
async function applyLoading(player) {
  try {
    const failed = await syncTickingAreas(getVillage());
    if (failed.length > 0) {
      player.sendMessage(`§e[blockAI] 範囲が広すぎて、常に読み込めない場所があります: ${failed.join("、")}（プレイヤーが近くにいる間は動きます）`);
    }
  } catch (err) {
    console.warn(`[blockAI] ticking area error: ${err}`);
  }
}

/**
 * 仕事場と立ち入り禁止エリアのメニュー
 * @param {Player} player
 */
async function areaMenu(player) {
  const v = getVillage();
  if (!v) return;
  const jobs = workingJobs();
  const form = new ActionFormData()
    .title("仕事場と立ち入り禁止エリア")
    .body("職業ごとに働く場所を決めたり、村人に触らせたくない場所を登録できます。");
  for (const j of jobs) {
    const a = v.jobAreas?.[j.id];
    form.button(`${j.name}の仕事場\n${a ? `§2(${a.x}, ${a.z}) 半径${a.r}` : "§8村全体"}`);
  }
  form.button(`立ち入り禁止エリア（${(v.protect ?? []).length}か所）`);
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const job = jobs[res.selection];
  if (job) await jobAreaMenu(player, job);
  else await protectMenu(player);
}

/**
 * @param {Player} player
 * @param {import("./registry.js").JobDef} job
 */
async function jobAreaMenu(player, job) {
  const v = getVillage();
  if (!v) return;
  const cur = workArea(v, job.id);
  const res = await new ActionFormData()
    .title(`${job.name}の仕事場`)
    .body(
      `今の仕事場: ${v.jobAreas?.[job.id] ? `(${cur.x}, ${cur.z}) 半径${cur.r}` : `村全体（半径${cur.r}）`}\n\n` +
        `今立っている場所を中心に、${job.name}が働く範囲を決められます。\n` +
        "森や畑など、仕事をしてほしい場所の真ん中に立って選んでください。",
    )
    .button("今いる場所を仕事場にする")
    .button("村全体に戻す")
    .show(player);
  if (res.canceled || res.selection === undefined) return;
  if (res.selection === 1) {
    setJobArea(job.id, undefined);
    clearJobTasks(job.id);
    await applyLoading(player);
    player.sendMessage(`§a[blockAI] ${job.name}は村全体で働きます。`);
    return;
  }
  const r = await new ModalFormData()
    .title(`${job.name}の仕事場`)
    .slider("仕事場の広さ（半径・ブロック）", 8, 32, { valueStep: 4, defaultValue: 16 })
    .show(player);
  if (r.canceled || !r.formValues) return;
  const radius = Number(r.formValues[0] ?? 16);
  setJobArea(job.id, { ...player.location, r: radius });
  clearJobTasks(job.id);
  await applyLoading(player);
  player.sendMessage(`§a[blockAI] ${job.name}の仕事場を、ここから半径${radius}ブロックにしました。`);
}

/**
 * 立ち入り禁止エリア
 * @param {Player} player
 */
async function protectMenu(player) {
  const v = getVillage();
  if (!v) return;
  const list = v.protect ?? [];
  const form = new ActionFormData()
    .title("立ち入り禁止エリア")
    .body("登録した範囲では、村人が木を切ったり作物を刈ったりしません。\n登録済みのエリアを選ぶと削除できます。")
    .button("今いる場所を立ち入り禁止にする");
  for (const a of list) form.button(`${a.name}\n§8(${a.x}, ${a.z}) 半径${a.r}`);
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  if (res.selection === 0) {
    const r = await new ModalFormData()
      .title("立ち入り禁止にする")
      .textField("名前", "例: 家の庭", { defaultValue: `エリア${list.length + 1}` })
      .slider("広さ（半径・ブロック）", 2, 24, { valueStep: 1, defaultValue: 6 })
      .show(player);
    if (r.canceled || !r.formValues) return;
    const name = String(r.formValues[0] ?? "").trim().slice(0, 16) || `エリア${list.length + 1}`;
    const radius = Number(r.formValues[1] ?? 6);
    addProtect(name, { ...player.location, r: radius });
    clearAllTasks();
    player.sendMessage(`§a[blockAI] 「${name}」（半径${radius}）を立ち入り禁止にしました。`);
    return;
  }
  const target = list[res.selection - 1];
  if (!target) return;
  const ok = await new MessageFormData()
    .title("立ち入り禁止エリア")
    .body(`「${target.name}」を削除しますか？`)
    .button1("やめる")
    .button2("削除する")
    .show(player);
  if (ok.selection !== 1) return;
  removeProtect(res.selection - 1);
  player.sendMessage(`§a[blockAI] 「${target.name}」を削除しました。`);
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
  player.sendMessage(`§a[blockAI] ${getName(v)} は ${job.name}${job.work ? ` Lv${lv}` : ""} になりました。§7${job.description}`);
  if (job.work && !hasStorage(getVillage())) {
    player.sendMessage("§e[blockAI] ヒント: 村長メニューで「村の倉庫」を置くと、集めた物を運んでくれます。");
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
  forget(v.id);
  v.remove();
  player.sendMessage(`§e[blockAI] ${name} は村を去りました。`);
}

/** @param {Player} player */
async function showRecord(player) {
  const village = getVillage();
  if (!village) return;
  await new ActionFormData()
    .title("村の記録")
    .body(raw("これまでに倉庫へ届いた物:\n", itemList(village.stats)))
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
  await applyLoading(player);
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
        "§e2. 村の倉庫を置く§r",
        "村長メニューの「村の倉庫を置く」で、見ている場所に倉庫（木張りのチェスト）を置きます。村レベルが上がると、置ける数と広さが増えます（大きいチェスト1個分から16個分まで）。中身はどの倉庫でも同じで、村人は一番近い倉庫へ運びます。倉庫をタップすると、取り出す・しまうができます。",
        "",
        "§e3. 村人を雇う§r",
        "メニューから雇うか、スポーンエッグで呼びます。",
        "",
        "§e4. 仕事を与える§r",
        "村長の杖で村人をタップ →「職業を変える」。",
        "・木こり: 村の周りの木を切って、苗木を植え直す（作業設定で植え直しをOFFにもできる）",
        "・農家: 実った小麦・ニンジン等を収穫して植え直す。空いている畑には倉庫の種をまく（新しく耕すことはしない）",
        "",
        "§e5. 仕事場と立ち入り禁止§r",
        "村長メニューの「仕事場と立ち入り禁止エリア」で、職業ごとに働く場所を決めたり、触らせたくない場所を登録できます。",
        "倉庫への納品が増えると村レベルが上がり、仕事の範囲が広がります（半径32→64）。",
        "",
        "§e6. 成長§r",
        "働くと経験値が貯まりレベルアップ（最大Lv10）。作業が速くなり、たくさん運べるようになります（Lv10で256個）。",
        "Lv5・Lv8・Lv10 で職業ごとの特技を覚えます（村人メニューで確認できます）。",
        "経験値は職業ごとに記録されます。別の職業に変えても、元の職業に戻せば続きからです。",
        "",
        "§e7. 体力と夜§r",
        "体力は一番高い職業レベルで増えます（Lv1: 20 → Lv10: 40）。休んでいる間は少しずつ回復します。",
        "夜になると村に戻り、空いているベッドで寝ます（ベッドが無ければ倉庫の前で休む）。朝には全回復します。",
        "倒れた村人は、翌朝に元気になって戻ってきます（「村の設定」でOFFにすると戻りません）。",
        "",
        "§e8. 見た目§r",
        "村人は男女20人のキャラクターから決まります。村人メニューの「見た目を選ぶ」で変えられます。転職すると衣装だけが変わります。",
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
