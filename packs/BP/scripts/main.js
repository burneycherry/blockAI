import { EquipmentSlot, ItemStack, Player, system, world } from "@minecraft/server";
import { STAFF_ID, VILLAGER_ID } from "./core/config.js";
import { getVillage } from "./core/village.js";
import { cleanupMarkers, ensureStorageMarker, requestScan } from "./core/tasks.js";
import { getAllVillagers, getJob, initVillager, tickVillagers } from "./core/villager.js";
import { openMainMenu, openSoon, openVillagerMenu } from "./core/ui.js";
// 職業の部品を登録する
import "./jobs/index.js";

/** 同じ操作でメニューが2重に開かないようにする */
/** @type {Map<string, number>} */
const lastOpen = new Map();

/** @param {Player} player */
function canOpen(player) {
  const now = system.currentTick;
  const last = lastOpen.get(player.id) ?? -100;
  if (now - last < 10) return false;
  lastOpen.set(player.id, now);
  return true;
}

/** @param {Player} player */
function holdsStaff(player) {
  try {
    const item = player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    return item?.typeId === STAFF_ID;
  } catch (e) {
    return false;
  }
}

/**
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} villager
 */
function openFor(player, villager) {
  if (!canOpen(player)) return;
  openSoon(() => openVillagerMenu(player, villager));
}

// 杖を使う（長押し / 右クリック）
world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack.typeId !== STAFF_ID) return;
  const player = ev.source;
  // 目の前に村人がいれば、その村人のメニュー
  const hits = player.getEntitiesFromViewDirection({ maxDistance: 6 });
  const hit = hits.find((h) => h.entity.typeId === VILLAGER_ID);
  if (hit) {
    openFor(player, hit.entity);
    return;
  }
  // チェストなどを見ているときは、そちらの操作を優先する
  try {
    const block = player.getBlockFromViewDirection({ maxDistance: 6 })?.block;
    if (block?.getComponent("minecraft:inventory")) return;
  } catch (err) {
    // 無視
  }
  if (!canOpen(player)) return;
  openSoon(() => openMainMenu(player));
});

// 杖で村人をタップ（攻撃ボタン）
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (!(player instanceof Player)) return;
  if (ev.hitEntity.typeId !== VILLAGER_ID) return;
  if (!holdsStaff(player)) return;
  openFor(player, ev.hitEntity);
});

// 杖を持って村人に「使う」
world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target.typeId !== VILLAGER_ID) return;
  if (ev.itemStack?.typeId !== STAFF_ID) return;
  openFor(ev.player, ev.target);
});

// スポーンエッグ等で出てきた村人の初期設定
world.afterEvents.entitySpawn.subscribe((ev) => {
  const e = ev.entity;
  if (!e.isValid || e.typeId !== VILLAGER_ID) return;
  system.run(() => {
    if (e.isValid) initVillager(e);
  });
});

// 初めて来たプレイヤーに村長の杖を渡す
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const player = ev.player;
  if (player.getDynamicProperty("blockai:got_staff") === true) return;
  system.runTimeout(() => {
    if (!player.isValid) return;
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    inv.addItem(new ItemStack(STAFF_ID, 1));
    player.setDynamicProperty("blockai:got_staff", true);
    player.sendMessage("§a[blockAI] 村長の杖を受け取りました！ 使うと村長メニューが開きます。");
  }, 40);
});

// メインループ（0.5秒ごと）
let tick = 0;
system.runInterval(() => {
  tick += 10;
  tickVillagers(tick);

  const village = getVillage();
  if (!village) return;
  if (tick % 40 === 0) {
    ensureStorageMarker(village);
    const active = new Set(getAllVillagers().map((v) => getJob(v).id));
    requestScan(village, active);
  }
  if (tick % 200 === 0) cleanupMarkers();
}, 10);

console.log("[blockAI] loaded");
