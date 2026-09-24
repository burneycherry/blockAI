// 村人のキャラクター（見た目の人物）。転職しても人物はそのままで、衣装だけが変わる
// tools/gen-humans.mjs もこのファイルを読んでテクスチャを作る（ここを変えたら gen-humans を実行する）

/**
 * 体型: 0 = ふつう（腕が太い）、1 = ほっそり（腕が細い）、2 = マッチョ
 * @typedef {{
 *   name: string,
 *   gender: "m" | "f",
 *   build: 0 | 1 | 2,
 *   skin: number[],
 *   hair: number[],
 *   style: "short" | "shaggy" | "spiky" | "buzz" | "bald" | "tied" | "long" | "bob" | "ponytail" | "bun",
 *   eyes: number[],
 *   beard?: "full" | "mustache" | "stubble",
 *   cloth: number[],
 *   face: Face,
 *   note: string
 * }} Character
 *
 * 顔つき（全員が同じ顔にならないように、一人ずつ変える）
 *   eye: round（丸い）/ almond（切れ長）/ sleepy（たれ目・半目）/ happy（にっこり閉じた目）/ wide（ぱっちり）
 *   look: 目線 -1 = 左、0 = まっすぐ、1 = 右
 *   mouth: smile（にっこり）/ grin（歯を見せて笑う）/ calm（ふつう）/ small（小さい口）
 *   brow: flat（まっすぐ）/ arch（弧）/ raised（上がり気味）/ bold（太い）/ kind（下がり眉）
 * @typedef {{ eye: "round" | "almond" | "sleepy" | "happy" | "wide", look: -1 | 0 | 1, mouth: "smile" | "grin" | "calm" | "small", brow: "flat" | "arch" | "raised" | "bold" | "kind" }} Face
 */

const SKIN = {
  light: [245, 210, 175],
  fair: [236, 190, 150],
  tan: [210, 150, 105],
  brown: [165, 108, 72],
  dark: [120, 76, 50],
};
const HAIR = {
  black: [34, 28, 28],
  brown: [96, 60, 34],
  chestnut: [128, 74, 40],
  blond: [222, 182, 96],
  red: [168, 66, 34],
  gray: [150, 148, 145],
  white: [226, 224, 220],
};
const EYES = {
  brown: [92, 58, 30],
  black: [30, 26, 30],
  blue: [52, 110, 190],
  green: [60, 130, 70],
};

/** @type {Character[]} */
export const CHARACTERS = [
  // ---- 男性 ----
  { name: "タロウ", gender: "m", build: 0, skin: SKIN.fair, hair: HAIR.black, style: "short", eyes: EYES.brown, cloth: [70, 110, 170], face: { eye: "round", look: 0, mouth: "smile", brow: "flat" }, note: "まじめな働き者" },
  { name: "ゴロウ", gender: "m", build: 2, skin: SKIN.tan, hair: HAIR.brown, style: "buzz", eyes: EYES.brown, beard: "full", cloth: [150, 60, 50], face: { eye: "almond", look: 0, mouth: "grin", brow: "bold" }, note: "力自慢のマッチョ" },
  { name: "ケンタ", gender: "m", build: 0, skin: SKIN.light, hair: HAIR.chestnut, style: "spiky", eyes: EYES.green, cloth: [90, 150, 80], face: { eye: "wide", look: 1, mouth: "grin", brow: "raised" }, note: "元気いっぱい" },
  { name: "ソウタ", gender: "m", build: 0, skin: SKIN.fair, hair: HAIR.black, style: "tied", eyes: EYES.black, cloth: [110, 90, 150], face: { eye: "almond", look: -1, mouth: "calm", brow: "flat" }, note: "物静かな職人肌" },
  { name: "ハルト", gender: "m", build: 0, skin: SKIN.light, hair: HAIR.blond, style: "shaggy", eyes: EYES.blue, cloth: [200, 170, 90], face: { eye: "round", look: 1, mouth: "smile", brow: "arch" }, note: "旅から来た若者" },
  { name: "ダイゴ", gender: "m", build: 2, skin: SKIN.brown, hair: HAIR.black, style: "bald", eyes: EYES.brown, beard: "stubble", cloth: [60, 60, 70], face: { eye: "sleepy", look: 0, mouth: "calm", brow: "bold" }, note: "無口な大男" },
  { name: "ヘイゾウ", gender: "m", build: 0, skin: SKIN.fair, hair: HAIR.gray, style: "short", eyes: EYES.black, beard: "mustache", cloth: [120, 100, 70], face: { eye: "happy", look: 0, mouth: "smile", brow: "kind" }, note: "村いちばんの古株" },
  { name: "リク", gender: "m", build: 0, skin: SKIN.dark, hair: HAIR.black, style: "spiky", eyes: EYES.brown, cloth: [220, 120, 50], face: { eye: "wide", look: -1, mouth: "grin", brow: "raised" }, note: "足の速い若者" },
  { name: "カイト", gender: "m", build: 0, skin: SKIN.tan, hair: HAIR.red, style: "shaggy", eyes: EYES.green, beard: "stubble", cloth: [50, 120, 130], face: { eye: "round", look: 1, mouth: "grin", brow: "bold" }, note: "陽気な力持ち" },
  { name: "ゲンジ", gender: "m", build: 2, skin: SKIN.light, hair: HAIR.white, style: "buzz", eyes: EYES.blue, beard: "full", cloth: [100, 70, 50], face: { eye: "almond", look: 0, mouth: "calm", brow: "bold" }, note: "白ひげの親方" },
  // ---- 女性 ----
  { name: "ハナコ", gender: "f", build: 1, skin: SKIN.fair, hair: HAIR.black, style: "long", eyes: EYES.brown, cloth: [200, 90, 110], face: { eye: "almond", look: 0, mouth: "calm", brow: "arch" }, note: "しっかり者" },
  { name: "サクラ", gender: "f", build: 1, skin: SKIN.light, hair: HAIR.chestnut, style: "ponytail", eyes: EYES.brown, cloth: [240, 160, 180], face: { eye: "round", look: 1, mouth: "smile", brow: "arch" }, note: "明るい看板娘" },
  { name: "ユイ", gender: "f", build: 1, skin: SKIN.light, hair: HAIR.blond, style: "bob", eyes: EYES.blue, cloth: [120, 170, 220], face: { eye: "wide", look: -1, mouth: "small", brow: "raised" }, note: "好奇心おうせい" },
  { name: "ミオ", gender: "f", build: 1, skin: SKIN.tan, hair: HAIR.brown, style: "long", eyes: EYES.green, cloth: [110, 150, 90], face: { eye: "sleepy", look: 0, mouth: "smile", brow: "kind" }, note: "森が好き" },
  { name: "アオイ", gender: "f", build: 1, skin: SKIN.fair, hair: HAIR.black, style: "bob", eyes: EYES.black, cloth: [70, 90, 160], face: { eye: "almond", look: 1, mouth: "small", brow: "flat" }, note: "計算が得意" },
  { name: "メイ", gender: "f", build: 1, skin: SKIN.brown, hair: HAIR.black, style: "bun", eyes: EYES.brown, cloth: [230, 190, 80], face: { eye: "happy", look: 0, mouth: "grin", brow: "kind" }, note: "世話好き" },
  { name: "コハル", gender: "f", build: 1, skin: SKIN.light, hair: HAIR.red, style: "ponytail", eyes: EYES.green, cloth: [150, 100, 170], face: { eye: "round", look: -1, mouth: "smile", brow: "arch" }, note: "歌が上手" },
  { name: "リン", gender: "f", build: 2, skin: SKIN.tan, hair: HAIR.brown, style: "ponytail", eyes: EYES.brown, cloth: [180, 70, 60], face: { eye: "almond", look: 0, mouth: "grin", brow: "bold" }, note: "男顔負けの力持ち" },
  { name: "トメ", gender: "f", build: 1, skin: SKIN.fair, hair: HAIR.gray, style: "bun", eyes: EYES.black, cloth: [130, 110, 90], face: { eye: "happy", look: 0, mouth: "smile", brow: "kind" }, note: "物知りのおばあちゃん" },
  { name: "ツムギ", gender: "f", build: 1, skin: SKIN.dark, hair: HAIR.black, style: "long", eyes: EYES.brown, cloth: [90, 160, 150], face: { eye: "round", look: 0, mouth: "calm", brow: "arch" }, note: "手先が器用" },
];

export const BUILD_NAMES = ["ふつう", "ほっそり", "マッチョ"];
