// 村人が畑でジャンプして、畑の土を普通の土に戻してしまったら元に戻す
// 統合版には「踏み荒らしを止める」設定が生き物ごとには無いので、村人の足元を見張って直す
import { BlockPermutation, system } from "@minecraft/server";

/** 畑の土だった場所 → 最後に畑の土だと確認した tick */
/** @type {Map<string, number>} */
const seen = new Map();
/** 畑の土だと確認してから、これ以内に土になったら「踏み荒らし」とみなす（2秒） */
const WINDOW = 40;

/**
 * 村人の足元（周り5×5。ジャンプで少し先に着地しても見逃さないように）を見張る。0.5秒ごとに呼ぶ
 * @param {import("@minecraft/server").Entity} e
 */
export function guardFarmland(e) {
  const now = system.currentTick;
  const dim = e.dimension;
  const l = e.location;
  const bx = Math.floor(l.x);
  const by = Math.floor(l.y);
  const bz = Math.floor(l.z);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      // 畑の土は15/16の高さなので、立っていると足の高さのブロックになる
      for (const y of [by, by - 1]) {
        const p = { x: bx + dx, y, z: bz + dz };
        let b;
        try {
          b = dim.getBlock(p);
        } catch (err) {
          continue;
        }
        if (!b) continue;
        const k = `${p.x},${p.y},${p.z}`;
        if (b.typeId === "minecraft:farmland") {
          seen.set(k, now);
        } else if (b.typeId === "minecraft:dirt") {
          const t = seen.get(k);
          if (t !== undefined && now - t <= WINDOW) {
            b.setPermutation(BlockPermutation.resolve("minecraft:farmland", { moisturized_amount: 7 }));
            seen.set(k, now);
          }
        }
      }
    }
  }
  // 古い記録は捨てる
  if (seen.size > 4000) {
    for (const [k, t] of seen) if (now - t > WINDOW) seen.delete(k);
  }
}
