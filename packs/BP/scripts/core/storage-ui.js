// 村の倉庫のメニュー（取り出す・しまう・片付ける）と、倉庫を置く操作
import { EquipmentSlot, ItemStack } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { STAFF_ID, STOREHOUSE_ID } from "./config.js";
import { getVillage } from "./village.js";
import {
  addToStock,
  alignHouse,
  capacitySlots,
  forgetHouses,
  getHouses,
  getStock,
  maxHouses,
  setLid,
  stackSize,
  takeFromStock,
  usedSlots,
} from "./storage.js";
import { itemRaw, raw } from "./ui.js";
import { itemIcon } from "./icons.js";

/**
 * @typedef {import("@minecraft/server").Player} Player
 * @typedef {import("@minecraft/server").Entity} Entity
 */

/** @param {number} n */
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** 重ねられる物だけ倉庫に入る（道具や防具は入らない） @param {ItemStack} item */
const storable = (item) => item.maxAmount > 1 && item.typeId !== STAFF_ID;

/**
 * 村の倉庫を置く（見ているブロックの上、無ければ目の前）
 * @param {Player} player
 */
export function placeStorehouse(player) {
  const v = getVillage();
  if (!v) return;
  const count = getHouses(v).length;
  const max = maxHouses(v);
  if (count >= max) {
    player.sendMessage(`§c[blockAI] 今の村レベルで置ける倉庫は ${max} 個までです。村レベルが上がると増えます。`);
    return;
  }
  if (player.dimension.id !== v.dim) {
    player.sendMessage("§c[blockAI] 村と同じディメンションに置いてください。");
    return;
  }
  let loc;
  try {
    const hit = player.getBlockFromViewDirection({ maxDistance: 6 });
    if (hit) loc = { x: hit.block.x + 0.5, y: hit.block.y + 1, z: hit.block.z + 0.5 };
  } catch (err) {
    // 無視
  }
  if (!loc) {
    const d = player.getViewDirection();
    loc = { x: Math.floor(player.location.x + d.x * 2) + 0.5, y: Math.floor(player.location.y), z: Math.floor(player.location.z + d.z * 2) + 0.5 };
  }
  const house = player.dimension.spawnEntity(STOREHOUSE_ID, loc);
  // 正面をプレイヤーの方へ（東西南北のどれかに真っ直ぐ）
  const yaw = (Math.atan2(-(player.location.x - loc.x), player.location.z - loc.z) * 180) / Math.PI;
  alignHouse(house, yaw);
  forgetHouses();
  player.sendMessage(`§a[blockAI] 村の倉庫を置きました（${count + 1} / ${max}）。タップすると開けます。中身はどの倉庫からでも同じです。`);
}

/**
 * 倉庫のメニュー
 * @param {Player} player
 * @param {Entity} house
 */
export async function openStorehouseMenu(player, house) {
  // 開けている間はふたを開けておく
  setLid(house, true);
  try {
    await storehouseMenu(player, house);
  } finally {
    setLid(house, false);
  }
}

/**
 * @param {Player} player
 * @param {Entity} house
 */
async function storehouseMenu(player, house) {
  const v = getVillage();
  if (!v) {
    player.sendMessage("§e[blockAI] 先に村長の杖で村を作ってください。");
    return;
  }
  const form = new ActionFormData()
    .title("村の倉庫")
    .body(stockSummary(v))
    .button("取り出す")
    .button("手に持っている物をしまう")
    .button("持ち物をまとめてしまう（ホットバー以外）")
    .button("この倉庫を片付ける");
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  switch (res.selection) {
    case 0:
      await takeOut(player);
      break;
    case 1:
      putHand(player);
      break;
    case 2:
      putAll(player);
      break;
    case 3:
      await removeHouse(player, house);
      break;
  }
}

/** 村の倉庫の広さ（大きいチェスト1個 = 54スタック） */
const LARGE_CHEST = 54;

/**
 * 倉庫の中身と広さの説明
 * @param {import("./village.js").VillageData} v
 */
export function stockSummary(v) {
  const stock = getStock();
  const kinds = Object.keys(stock).length;
  let total = 0;
  for (const k of Object.keys(stock)) total += stock[k];
  const used = usedSlots(stock);
  const cap = capacitySlots(v);
  const rate = Math.min(1, used / cap);
  const bar = Math.round(rate * 20);
  const color = rate >= 0.9 ? "§c" : rate >= 0.7 ? "§6" : "§a";
  return [
    `入っている物: §e${fmt(total)} 個§r（${kinds} 種類）`,
    `使っている量: §e${used} / ${cap} スタック§r（空き ${cap - used} スタック）`,
    `${color}${"|".repeat(bar)}§8${"|".repeat(20 - bar)}§r ${Math.round(rate * 100)}%`,
    `§71スタックは、チェストの1マスに入る数です（ふつうは64個。卵・雪玉などは16個）。例：原木320個なら5スタック、321個なら6スタックです。今の広さは大きいチェスト ${cap / LARGE_CHEST} 個分（${cap} スタック）です。§r`,
    "",
    `置いている倉庫: ${getHouses(v).length} / ${maxHouses(v)} 個`,
    "§7中身はどの倉庫からでも同じです。村レベルが上がると、広くなり、置ける数も増えます。§r",
  ].join("\n");
}

/**
 * 個数とスタック数（例: 「1,703個 / 27スタック」「19個 / 2スタック（16個で1スタック）」）
 * @param {string} id
 * @param {number} n
 */
function stackText(id, n) {
  const size = stackSize(id);
  const text = `${fmt(n)}個 / ${Math.ceil(n / size)}スタック`;
  return size === 64 ? text : `${text}（${size}個で1スタック）`;
}

/** @param {Player} player */
async function takeOut(player) {
  const stock = getStock();
  const ids = Object.keys(stock).sort((a, b) => stock[b] - stock[a]);
  if (ids.length === 0) {
    player.sendMessage("§e[blockAI] 倉庫は空っぽです。");
    return;
  }
  const form = new ActionFormData().title("取り出す").body("取り出す物を選んでください。");
  for (const id of ids) form.button(raw(itemRaw(id), `\n§8${stackText(id, stock[id])}`), itemIcon(id));
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return;
  const id = ids[res.selection];
  const have = getStock()[id] ?? 0;
  if (!id || have <= 0) return;
  const amounts = [1, 16, 32, 64, 128, 256, 576].filter((n) => n < have);
  const labels = [...amounts.map((n) => `${n} 個`), `全部（${fmt(have)} 個・持てるだけ）`];
  const r = await new ModalFormData()
    .title(itemRaw(id))
    .dropdown("いくつ取り出す？", labels, { defaultValueIndex: Math.min(3, labels.length - 1) })
    .show(player);
  if (r.canceled || !r.formValues) return;
  const idx = Number(r.formValues[0] ?? 0);
  const want = amounts[idx] ?? have;
  give(player, id, want);
}

/**
 * 在庫から取り出してプレイヤーに渡す（入りきらない分は倉庫に戻す）
 * @param {Player} player
 * @param {string} id
 * @param {number} want
 */
function give(player, id, want) {
  const v = getVillage();
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!v || !inv) return;
  let left = takeFromStock(id, want);
  const took = left;
  const max = new ItemStack(id, 1).maxAmount;
  while (left > 0) {
    const n = Math.min(max, left);
    const rest = inv.addItem(new ItemStack(id, n));
    left -= n - (rest ? rest.amount : 0);
    if (rest) break;
  }
  if (left > 0) addToStock(v, id, left);
  const got = took - left;
  player.sendMessage(got > 0 ? raw("§a[blockAI] ", itemRaw(id), ` を ${fmt(got)} 個取り出しました。`) : "§c[blockAI] 持ち物がいっぱいです。");
}

/** @param {Player} player */
function putHand(player) {
  const v = getVillage();
  const eq = player.getComponent("minecraft:equippable");
  const item = eq?.getEquipment(EquipmentSlot.Mainhand);
  if (!v || !eq || !item) {
    player.sendMessage("§e[blockAI] しまう物を手に持ってください。");
    return;
  }
  if (!storable(item)) {
    player.sendMessage("§e[blockAI] 道具・防具・ベッドなど、重ねられない物は倉庫に入りません。");
    return;
  }
  const put = addToStock(v, item.typeId, item.amount);
  if (put <= 0) {
    player.sendMessage("§c[blockAI] 倉庫がいっぱいです。");
    return;
  }
  if (put >= item.amount) eq.setEquipment(EquipmentSlot.Mainhand, undefined);
  else {
    item.amount -= put;
    eq.setEquipment(EquipmentSlot.Mainhand, item);
  }
  player.sendMessage(raw("§a[blockAI] ", itemRaw(item.typeId), ` を ${fmt(put)} 個しまいました。`));
}

/** @param {Player} player */
function putAll(player) {
  const v = getVillage();
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!v || !inv) return;
  let total = 0;
  let full = false;
  for (let i = 9; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (!item || !storable(item)) continue;
    const put = addToStock(v, item.typeId, item.amount);
    total += put;
    if (put >= item.amount) inv.setItem(i, undefined);
    else {
      full = true;
      if (put > 0) {
        item.amount -= put;
        inv.setItem(i, item);
      }
    }
  }
  player.sendMessage(`§a[blockAI] ${fmt(total)} 個しまいました。${full ? "§c倉庫がいっぱいで、入りきらない物がありました。" : ""}`);
}

/**
 * @param {Player} player
 * @param {Entity} house
 */
async function removeHouse(player, house) {
  const v = getVillage();
  if (!v) return;
  const last = getHouses(v).length <= 1;
  const res = await new MessageFormData()
    .title("倉庫を片付ける")
    .body(
      last
        ? "最後の倉庫です。片付けても中身は村に残り、また倉庫を置けば取り出せます。\n片付けますか？"
        : "この倉庫を片付けますか？（中身はほかの倉庫から取り出せます）",
    )
    .button1("やめる")
    .button2("片付ける")
    .show(player);
  if (res.selection !== 1 || !house.isValid) return;
  house.remove();
  forgetHouses();
  player.sendMessage("§e[blockAI] 倉庫を片付けました。");
}
