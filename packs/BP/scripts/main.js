import { EquipmentSlot, ItemStack, Player, system, world } from "@minecraft/server";
import { STAFF_ID, STOREHOUSE_BLOCK_ID, STOREHOUSE_ID, VILLAGER_ID } from "./core/config.js";
import { getVillage } from "./core/village.js";
import { cleanupMarkers, requestScan } from "./core/tasks.js";
import { getAllVillagers, getJob, getOption, initVillager, noteHurt, tickAssist, tickVillagers } from "./core/villager.js";
import { onVillagerDie, reviveFallen, saveRoster } from "./core/life.js";
import { openMainMenu, openSoon, openVillagerMenu } from "./core/ui.js";
import { openStorehouseMenu } from "./core/storage-ui.js";
import { syncTickingAreas } from "./core/loading.js";
import { alignHouse, getHouses, houseAt } from "./core/storage.js";
// 職業の部品を登録する
import "./jobs/index.js";

/** メインループの時計（0.5秒ごとに10ずつ進む） */
let tick = 0;

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
  const hit = hits.find((h) => h.entity.typeId === VILLAGER_ID || h.entity.typeId === STOREHOUSE_ID);
  if (hit) {
    if (hit.entity.typeId === STOREHOUSE_ID) openHouse(player, hit.entity);
    else openFor(player, hit.entity);
    return;
  }
  // チェストなどを見ているときは、そちらの操作を優先する
  try {
    const block = player.getBlockFromViewDirection({ maxDistance: 6 })?.block;
    if (block?.typeId === STOREHOUSE_BLOCK_ID) {
      openHouseBlock(player, block);
      return;
    }
    if (block?.getComponent("minecraft:inventory")) return;
  } catch (err) {
    // 無視
  }
  if (!canOpen(player)) return;
  openSoon(() => openMainMenu(player));
});

/**
 * @param {Player} player
 * @param {import("@minecraft/server").Entity} house
 */
function openHouse(player, house) {
  if (!canOpen(player)) return;
  openSoon(() => openStorehouseMenu(player, house));
}

/**
 * 倉庫のブロック（当たり判定）をタップしたとき
 * @param {Player} player
 * @param {import("@minecraft/server").Block} block
 */
function openHouseBlock(player, block) {
  const house = houseAt(block);
  if (house) {
    openHouse(player, house);
    return;
  }
  // 倉庫が無くなって残ったブロックは片付ける
  system.run(() => {
    if (block.isValid && block.typeId === STOREHOUSE_BLOCK_ID) block.setType("minecraft:air");
  });
}

// 倉庫のブロックをタップ・使う・叩く
world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  if (ev.block.typeId === STOREHOUSE_BLOCK_ID) openHouseBlock(ev.player, ev.block);
});
world.afterEvents.entityHitBlock.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (player instanceof Player && ev.hitBlock.typeId === STOREHOUSE_BLOCK_ID) openHouseBlock(player, ev.hitBlock);
});
// クリエイティブでも壊れないようにする
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (ev.block.typeId === STOREHOUSE_BLOCK_ID) ev.cancel = true;
});

// 村の倉庫をタップ・使う（何を持っていても開く）
world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target.typeId === STOREHOUSE_ID) openHouse(ev.player, ev.target);
});

// 杖で村人をタップ（攻撃ボタン）
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (!(player instanceof Player)) return;
  if (ev.hitEntity.typeId === STOREHOUSE_ID) {
    openHouse(player, ev.hitEntity);
    return;
  }
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

// 村人がダメージを受けた・倒れた
world.afterEvents.entityHurt.subscribe(
  (ev) => {
    const e = ev.hurtEntity;
    if (!e.isValid) return;
    // 村長の杖で叩いたとき（メニューを開く操作）のダメージは無かったことにする
    const src = ev.damageSource.damagingEntity;
    if (src instanceof Player && holdsStaff(src)) {
      const h = e.getComponent("minecraft:health");
      if (h && h.currentValue > 0) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + ev.damage));
      return;
    }
    noteHurt(e, tick);
  },
  { entityTypes: [VILLAGER_ID] },
);
world.afterEvents.entityDie.subscribe(
  (ev) => {
    onVillagerDie(ev.deadEntity);
  },
  { entityTypes: [VILLAGER_ID] },
);

// 村の倉庫は壊れない。ダメージは打ち消し、万一壊れたらその場に置き直す
world.afterEvents.entityHurt.subscribe(
  (ev) => {
    const h = ev.hurtEntity.isValid ? ev.hurtEntity.getComponent("minecraft:health") : undefined;
    if (h && h.currentValue > 0) h.resetToMaxValue();
  },
  { entityTypes: [STOREHOUSE_ID] },
);
world.afterEvents.entityDie.subscribe(
  (ev) => {
    const e = ev.deadEntity;
    try {
      const loc = e.location;
      const rot = e.getRotation();
      const dim = e.dimension;
      system.run(() => {
        const house = dim.spawnEntity(STOREHOUSE_ID, loc);
        alignHouse(house, rot.y);
      });
    } catch (err) {
      // 無視
    }
  },
  { entityTypes: [STOREHOUSE_ID] },
);

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
system.runInterval(() => {
  tick += 10;
  tickVillagers(tick);

  const village = getVillage();
  if (!village) return;
  if (tick % 40 === 0) {
    // 倉庫が押されたり回ったりしていたら、マスの真ん中・真っ直ぐに戻す
    for (const house of getHouses(village)) alignHouse(house);
    // 職業ごとに「誰かが作業設定をONにしているか」をまとめる（農家の作物の選択など）
    /** @type {Map<string, ((id: string) => boolean)[]>} */
    const byJob = new Map();
    for (const v of getAllVillagers()) {
      const job = getJob(v);
      const list = byJob.get(job.id) ?? [];
      list.push((id) => getOption(v, job, id));
      byJob.set(job.id, list);
    }
    /** @type {Map<string, (id: string) => boolean>} */
    const active = new Map();
    for (const [id, list] of byJob) active.set(id, (opt) => list.some((f) => f(opt)));
    requestScan(village, active);
  }
  if (tick % 200 === 0) {
    cleanupMarkers();
    saveRoster();
    reviveFallen();
  }
  // 村の範囲（村レベルで広がる）を読み込み続ける設定を反映
  if (tick % 1200 === 100) syncTickingAreas(village).catch((err) => console.warn(`[blockAI] ticking area: ${err}`));
}, 10);

// 自力で歩けない村人の手引き（毎tick）
system.runInterval(tickAssist, 1);

console.log("[blockAI] loaded");
