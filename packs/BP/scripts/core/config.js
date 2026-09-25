// 調整用の定数をまとめたファイル

/** パックのバージョン（manifest.json と合わせる） */
export const VERSION = "0.13.5";

export const VILLAGER_ID = "blockai:villager";
export const STAFF_ID = "blockai:mayor_staff";
export const WP_TASK_ID = "blockai:wp_task";
export const WP_STORAGE_ID = "blockai:wp_storage";
export const STOREHOUSE_ID = "blockai:storehouse";

/** 村人の最大人数 */
export const MAX_VILLAGERS = 20;
/** この距離内にプレイヤーがいれば「見えている」とみなして本物の動きを再現する */
export const VIEW_DISTANCE = 40;
/** 到着とみなす距離 */
export const ARRIVE_DISTANCE = 2.6;
/** この秒数ほとんど動けなければ目的地へワープさせる */
export const STUCK_SECONDS = 12;
/** 職業ごとに同時に用意しておく仕事の数（職業側で指定がないとき） */
export const DEFAULT_MAX_TASKS = 6;

/** 最大レベル */
export const MAX_LEVEL = 10;
/** レベルごとの必要経験値（index = レベル-1） */
export const LEVEL_XP = [0, 30, 90, 200, 400, 700, 1100, 1600, 2300, 3200];
/** レベルごとの作業間隔（tick。20tick = 1秒） */
const WORK_TICKS = [20, 18, 16, 14, 12, 10, 9, 8, 7, 6];
/** レベルごとの一度に運べる数（Lv10 で 256） */
const CAPACITY = [32, 48, 64, 80, 96, 128, 160, 192, 224, 256];

/** @param {number} level */
const lvIndex = (level) => Math.min(MAX_LEVEL, Math.max(1, level)) - 1;

/** レベルに応じた作業間隔（tick） @param {number} level */
export function workInterval(level) {
  return WORK_TICKS[lvIndex(level)];
}

/** レベルに応じた持てる量 @param {number} level */
export function carryCapacity(level) {
  return CAPACITY[lvIndex(level)];
}

/** レベルごとの体力の最大値（tools/gen-entities.mjs の HP と同じ） */
export const MAX_HP = [20, 22, 24, 27, 29, 31, 33, 36, 38, 40];

/** @param {number} level */
export function maxHp(level) {
  return MAX_HP[lvIndex(level)];
}

/** 夜（村人が休む時間）。getTimeOfDay の値 */
export const NIGHT_START = 13000;
export const NIGHT_END = 23000;

/** 頭の上のバッジ（石・鉄・金・エメラルド・ダイヤ）。2レベルごとに上がる @param {number} level */
export function badgeTier(level) {
  return Math.min(4, Math.floor((lvIndex(level)) / 2));
}

export const VILLAGER_NAMES = [
  "タロウ", "ハナコ", "ジロウ", "サクラ", "ケンタ", "ユイ", "ソウタ", "ミオ",
  "ハルト", "アオイ", "リク", "メイ", "ユウマ", "コハル", "ソラ", "ヒナ",
  "カイト", "ツムギ", "レン", "リン", "ゴロウ", "トメ", "ヘイゾウ", "オハツ",
];
