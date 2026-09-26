// メニューのボタンに出すアイテムの絵（バニラのテクスチャの場所）
// ゲームにはアイテムの絵を調べる方法が無いので、村で扱う物だけここに書く。無い物は文字だけ
// ブロックは持ち物の欄と同じ立体の絵（tools/gen-icons.mjs で作った RP の画像）を使う

const B = "textures/blocks/";
const I = "textures/items/";
const C = "textures/blockai/icons/";

/** @type {Record<string, string>} */
const ICONS = {
  // 原木
  "minecraft:oak_log": `${C}log_oak`,
  "minecraft:spruce_log": `${C}log_spruce`,
  "minecraft:birch_log": `${C}log_birch`,
  "minecraft:jungle_log": `${C}log_jungle`,
  "minecraft:acacia_log": `${C}log_acacia`,
  "minecraft:dark_oak_log": `${C}log_big_oak`,
  "minecraft:cherry_log": `${C}cherry_log`,
  "minecraft:mangrove_log": `${C}mangrove_log`,
  "minecraft:pale_oak_log": `${C}pale_oak_log`,
  // 苗木
  "minecraft:oak_sapling": `${B}sapling_oak`,
  "minecraft:spruce_sapling": `${B}sapling_spruce`,
  "minecraft:birch_sapling": `${B}sapling_birch`,
  "minecraft:jungle_sapling": `${B}sapling_jungle`,
  "minecraft:acacia_sapling": `${B}sapling_acacia`,
  "minecraft:dark_oak_sapling": `${B}sapling_roofed_oak`,
  "minecraft:cherry_sapling": `${B}cherry_sapling`,
  "minecraft:mangrove_propagule": `${B}mangrove_propagule`,
  "minecraft:pale_oak_sapling": `${B}pale_oak_sapling`,
  // 葉
  "minecraft:oak_leaves": `${C}leaves_oak`,
  "minecraft:spruce_leaves": `${C}leaves_spruce`,
  "minecraft:birch_leaves": `${C}leaves_birch`,
  "minecraft:jungle_leaves": `${C}leaves_jungle`,
  "minecraft:acacia_leaves": `${C}leaves_acacia`,
  "minecraft:dark_oak_leaves": `${C}leaves_big_oak`,
  "minecraft:cherry_leaves": `${C}leaves_cherry`,
  "minecraft:mangrove_leaves": `${C}leaves_mangrove`,
  "minecraft:pale_oak_leaves": `${C}leaves_pale_oak`,
  // 作物・種
  "minecraft:wheat": `${I}wheat`,
  "minecraft:wheat_seeds": `${I}seeds_wheat`,
  "minecraft:carrot": `${I}carrot`,
  "minecraft:potato": `${I}potato`,
  "minecraft:beetroot": `${I}beetroot`,
  "minecraft:beetroot_seeds": `${I}seeds_beetroot`,
  "minecraft:pumpkin_seeds": `${I}seeds_pumpkin`,
  "minecraft:melon_seeds": `${I}seeds_melon`,
  "minecraft:pumpkin": `${C}pumpkin`,
  "minecraft:melon_block": `${C}melon`,
  "minecraft:melon_slice": `${I}melon`,
  "minecraft:cactus": `${C}cactus`,
  "minecraft:bamboo": `${I}bamboo`,
  // そのほか
  "minecraft:stick": `${I}stick`,
  "minecraft:apple": `${I}apple`,
  "minecraft:snowball": `${I}snowball`,
  "minecraft:sugar_cane": `${I}reeds`,
  "minecraft:sugar": `${I}sugar`,
  "minecraft:dirt": `${C}dirt`,
  "minecraft:cobblestone": `${C}cobblestone`,
  "minecraft:stone": `${C}stone`,
  "minecraft:sand": `${C}sand`,
  "minecraft:gravel": `${C}gravel`,
  "minecraft:oak_planks": `${C}planks_oak`,
  "minecraft:spruce_planks": `${C}planks_spruce`,
  "minecraft:birch_planks": `${C}planks_birch`,
  "minecraft:coal": `${I}coal`,
  "minecraft:iron_ingot": `${I}iron_ingot`,
  "minecraft:gold_ingot": `${I}gold_ingot`,
  "minecraft:diamond": `${I}diamond`,
  "minecraft:emerald": `${I}emerald`,
  "minecraft:bread": `${I}bread`,
  "minecraft:egg": `${I}egg`,
  "minecraft:feather": `${I}feather`,
  "minecraft:leather": `${I}leather`,
  "minecraft:white_wool": `${C}wool_white`,
};

/**
 * アイテムの絵（無ければ undefined）
 * @param {string} id
 */
export function itemIcon(id) {
  return ICONS[id];
}
