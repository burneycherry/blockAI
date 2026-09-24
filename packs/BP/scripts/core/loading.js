// 村の範囲を「常に読み込まれた状態」にする（プレイヤーが遠くにいても村人が働ける）
// Minecraft の仕様では、プレイヤーから離れた場所は読み込まれず、村人も止まってしまう。
// ティッキングエリアを使うと、その範囲だけは動き続ける（ただし端末の負荷は少し増える）。
import { world } from "@minecraft/server";
import { villageLevel } from "./village.js";

const PREFIX = "blockai_";

/**
 * 村と、職業ごとの仕事場を読み込み続けるようにする
 * @param {import("./village.js").VillageData | null} village
 * @returns {Promise<string[]>} 範囲が大きすぎて読み込めなかった場所の名前
 */
export async function syncTickingAreas(village) {
  const mgr = world.tickingAreaManager;
  /** @type {Map<string, import("@minecraft/server").TickingAreaOptions & { label: string }>} */
  const want = new Map();
  if (village && village.keepLoaded) {
    const dim = world.getDimension(village.dim);
    const add = (/** @type {string} */ id, /** @type {string} */ label, /** @type {import("./village.js").Area} */ a) => {
      want.set(`${PREFIX}${id}`, {
        label,
        dimension: dim,
        from: { x: a.x - a.r, y: a.y, z: a.z - a.r },
        to: { x: a.x + a.r, y: a.y, z: a.z + a.r },
      });
    };
    add("village", "村", { ...village.center, r: villageLevel(village).radius });
    for (const [jobId, a] of Object.entries(village.jobAreas ?? {})) add(`job_${jobId}`, `${jobId} の仕事場`, a);
  }

  // いらなくなった範囲・場所が変わった範囲を外す
  for (const area of mgr.getAllTickingAreas()) {
    const w = want.get(area.identifier);
    const same =
      w &&
      area.boundingBox.min.x <= w.from.x &&
      area.boundingBox.min.z <= w.from.z &&
      area.boundingBox.max.x >= w.to.x &&
      area.boundingBox.max.z >= w.to.z &&
      area.boundingBox.max.x - area.boundingBox.min.x <= w.to.x - w.from.x + 32;
    if (same) want.delete(area.identifier);
    else mgr.removeTickingArea(area);
  }

  /** @type {string[]} */
  const failed = [];
  for (const [id, opts] of want) {
    const { label, ...options } = opts;
    if (!mgr.hasCapacity(options)) {
      failed.push(label);
      continue;
    }
    try {
      await mgr.createTickingArea(id, options);
    } catch (err) {
      failed.push(label);
    }
  }
  return failed;
}
