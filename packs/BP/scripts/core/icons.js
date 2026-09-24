// メニューのボタンに出すアイテムの絵（バニラのテクスチャの場所）
// ゲームにはアイテムの絵を調べる方法が無いので、村で扱う物だけここに書く。無い物は文字だけ

const B = "textures/blocks/";
const I = "textures/items/";

/** @type {Record<string, string>} */
const ICONS = {
  // 原木
  "minecraft:oak_log": `${B}log_oak`,
  "minecraft:spruce_log": `${B}log_spruce`,
  "minecraft:birch_log": `${B}log_birch`,
  "minecraft:jungle_log": `${B}log_jungle`,
  "minecraft:acacia_log": `${B}log_acacia`,
  "minecraft:dark_oak_log": `${B}log_big_oak`,
  "minecraft:cherry_log": `${B}cherry_log_side`,
  "minecraft:mangrove_log": `${B}mangrove_log_side`,
  "minecraft:pale_oak_log": `${B}pale_oak_log_side`,
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
  "minecraft:oak_leaves": `${B}leaves_oak_carried`,
  "minecraft:spruce_leaves": `${B}leaves_spruce_carried`,
  "minecraft:birch_leaves": `${B}leaves_birch_carried`,
  "minecraft:jungle_leaves": `${B}leaves_jungle_carried`,
  "minecraft:acacia_leaves": `${B}leaves_acacia_carried`,
  "minecraft:dark_oak_leaves": `${B}leaves_big_oak_carried`,
  "minecraft:cherry_leaves": `${B}cherry_leaves`,
  "minecraft:mangrove_leaves": `${B}mangrove_leaves_carried`,
  "minecraft:pale_oak_leaves": `${B}pale_oak_leaves`,
  // 作物・種
  "minecraft:wheat": `${I}wheat`,
  "minecraft:wheat_seeds": `${I}seeds_wheat`,
  "minecraft:carrot": `${I}carrot`,
  "minecraft:potato": `${I}potato`,
  "minecraft:beetroot": `${I}beetroot`,
  "minecraft:beetroot_seeds": `${I}seeds_beetroot`,
  // そのほか
  "minecraft:stick": `${I}stick`,
  "minecraft:apple": `${I}apple`,
  "minecraft:snowball": `${I}snowball`,
  "minecraft:dirt": `${B}dirt`,
  "minecraft:cobblestone": `${B}cobblestone`,
  "minecraft:stone": `${B}stone`,
  "minecraft:sand": `${B}sand`,
  "minecraft:gravel": `${B}gravel`,
  "minecraft:oak_planks": `${B}planks_oak`,
  "minecraft:spruce_planks": `${B}planks_spruce`,
  "minecraft:birch_planks": `${B}planks_birch`,
  "minecraft:coal": `${I}coal`,
  "minecraft:iron_ingot": `${I}iron_ingot`,
  "minecraft:gold_ingot": `${I}gold_ingot`,
  "minecraft:diamond": `${I}diamond`,
  "minecraft:emerald": `${I}emerald`,
  "minecraft:bread": `${I}bread`,
  "minecraft:egg": `${I}egg`,
  "minecraft:feather": `${I}feather`,
  "minecraft:leather": `${I}leather`,
  "minecraft:white_wool": `${B}wool_colored_white`,
};

/**
 * アイテムの絵（無ければ undefined）
 * @param {string} id
 */
export function itemIcon(id) {
  return ICONS[id];
}
