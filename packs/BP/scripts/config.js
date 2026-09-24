// 調整用の定数をまとめたファイル

/** パックのバージョン（manifest.json と合わせる） */
export const VERSION = "0.3.0";

export const VILLAGER_ID = "blockai:villager";
export const STAFF_ID = "blockai:mayor_staff";
export const WP_IDS = {
  tree: "blockai:wp_tree",
  crop: "blockai:wp_crop",
  storage: "blockai:wp_storage",
};

/** 村人の最大人数 */
export const MAX_VILLAGERS = 20;
/** 村の中心から仕事を探す半径（ブロック） */
export const WORK_RADIUS = 32;
/** この距離内にプレイヤーがいれば「見えている」とみなして本物の動きを再現する */
export const VIEW_DISTANCE = 40;
/** 到着とみなす距離 */
export const ARRIVE_DISTANCE = 2.6;
/** この秒数ほとんど動けなければ目的地へワープさせる */
export const STUCK_SECONDS = 12;
/** 同時に用意しておく仕事（木・畑）の上限 */
export const MAX_TREE_TASKS = 6;
export const MAX_CROP_TASKS = 6;

/**
 * 職業の定義
 * skin: 見た目（バニラ村人の職業テクスチャ番号）
 */
export const JOBS = {
  none: { name: "無職", skin: 0, implemented: true },
  lumberjack: { name: "木こり", skin: 4, implemented: true },
  farmer: { name: "農家", skin: 1, implemented: true },
  mason: { name: "石工", skin: 13, implemented: false },
  shepherd: { name: "羊飼い", skin: 3, implemented: false },
  smith: { name: "武器屋", skin: 9, implemented: false },
};

/** レベルごとの必要経験値（index = レベル-1） */
export const LEVEL_XP = [0, 30, 90, 200, 400];

/** レベルに応じた作業間隔（tick） */
export function workInterval(level) {
  return Math.max(6, 22 - level * 3);
}

/** レベルに応じた持てる量 */
export function carryCapacity(level) {
  return 16 + level * 8;
}

export const VILLAGER_NAMES = [
  "タロウ", "ハナコ", "ジロウ", "サクラ", "ケンタ", "ユイ", "ソウタ", "ミオ",
  "ハルト", "アオイ", "リク", "メイ", "ユウマ", "コハル", "ソラ", "ヒナ",
  "カイト", "ツムギ", "レン", "リン", "ゴロウ", "トメ", "ヘイゾウ", "オハツ",
];
