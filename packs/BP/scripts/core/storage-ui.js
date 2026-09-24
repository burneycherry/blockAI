// 村の倉庫のメニュー（取り出す・しまう・片付ける）と、倉庫を置く操作
import { EquipmentSlot, ItemStack } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { STAFF_ID, STOREHOUSE_ID } from "./config.js";
import { getVillage, villageLevel } from "./village.js";
import {
  addToStock,
  capacitySlots,
  chestContainer,
  forgetHouses,
  getHouses,
  getStock,
  maxHouses,
  takeFromStock,
  usedSlots,
} from "./storage.js";
import { itemRaw, raw } from "./ui.js";

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
  house.teleport(loc, { facingLocation: { x: player.location.x, y: loc.y, z: player.location.z } });
  forgetHouses();
  player.sendMessage(`§a[blockAI] 村の倉庫を置きました（${count + 1} / ${max}）。タップすると開けます。中身はどの倉庫からでも同じです。`);
}

/**
 * 倉庫のメニュー
 * @param {Player} player
 * @param {Entity} house
 */
export async function openStorehouseMenu(player, house) {
  const v = getVillage();
  if (!v) {
    player.sendMessage("§e[blockAI] 先に村長の杖で村を作ってください。");
    return;
  }
  const stock = getStock();
  let total = 0;
  for (const k of Object.keys(stock)) total += stock[k];
  const lv = villageLevel(v).level;
  const chest = v.storage ? chestContainer(v, v.storage) : undefined;
  const body = [
    `中身: §e${usedSlots(stock)} / ${capacitySlots(v)} マス§r（${fmt(total)} 個）`,
    `倉庫の数: ${getHouses(v).length} / ${maxHouses(v)} 個（村レベル${lv}）`,
    "§7中身はどの倉庫からでも同じです。村レベルが上がると広くなり、置ける数も増えます。1マス = 64個。§r",
  ].join("\n");
  const form = new ActionFormData()
    .title("村の倉庫")
    .body(body)
    .button("取り出す")
    .button("手に持っている物をしまう")
    .button("持ち物をまとめてしまう（ホットバー以外）")
    .button("この倉庫を片付ける");
  if (chest) form.button("登録したチェストの中身を移す");
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
    case 4:
      moveChest(player);
      break;
  }
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
  for (const id of ids) form.button(raw(itemRaw(id), `\n§8${fmt(stock[id])} 個`));
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
    player.sendMessage("§e[blockAI] 道具や防具など、重ねられない物は倉庫に入りません。");
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

/** 登録したチェスト（旧方式）の中身を、共有の倉庫へ移す @param {Player} player */
function moveChest(player) {
  const v = getVillage();
  const c = v?.storage ? chestContainer(v, v.storage) : undefined;
  if (!v || !c) return;
  let total = 0;
  for (let i = 0; i < c.size; i++) {
    const item = c.getItem(i);
    if (!item || !storable(item)) continue;
    const put = addToStock(v, item.typeId, item.amount);
    total += put;
    if (put >= item.amount) c.setItem(i, undefined);
    else if (put > 0) {
      item.amount -= put;
      c.setItem(i, item);
    }
  }
  player.sendMessage(`§a[blockAI] チェストから ${fmt(total)} 個を倉庫へ移しました。`);
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
