// 職業の登録所
//
// 職業は1つ1ファイルの部品（jobs/ フォルダ）として作り、ここに登録する。
// 将来、有料の職業パックに分けるときも、この形の部品を追加するだけで済むようにしている。

/** 目的地マーカーの枠の数（villager.json / wp_task.json の生成数と合わせる） */
export const MAX_SLOTS = 16;

/**
 * @typedef {{x:number,y:number,z:number}} Pos
 * @typedef {import("@minecraft/server").Entity} Entity
 * @typedef {import("@minecraft/server").Block} Block
 * @typedef {import("@minecraft/server").Dimension} Dimension
 *
 * @typedef {{
 *   id: number,
 *   jobId: string,
 *   dim: string,
 *   stand: Pos,
 *   blocks: Pos[],
 *   data: Record<string, any>,
 *   wpId: string | undefined
 * }} Task
 *
 * @typedef {(stand: Pos, blocks: Pos[], data?: Record<string, any>) => void} AddTask
 * @typedef {(p: Pos) => boolean} IsClaimed
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   skin: number,
 *   pack: string,
 *   description: string,
 *   status?: { going: string, working: string, waiting: string },
 *   maxTasks?: number,
 *   scan?: (dim: Dimension, top: Block, addTask: AddTask, isClaimed: IsClaimed) => void,
 *   options?: { id: string, label: string, default: boolean }[],
 *   skills?: Skill[],
 *   work?: (ctx: WorkContext) => number | boolean,
 *   onStorage?: (e: Entity, container: import("@minecraft/server").Container, bag: Record<string, number>, opt: (id: string) => boolean) => void,
 *   needsSupply?: (e: Entity, bag: Record<string, number>, opt: (id: string) => boolean) => boolean,
 *   slot?: number
 * }} JobDef
 *
 * @typedef {{ id: string, level: number, name: string, description: string }} Skill
 *
 * @typedef {{
 *   e: Entity,
 *   task: Task,
 *   carry: Record<string, number>,
 *   bag: Record<string, number>,
 *   watched: boolean,
 *   level: number,
 *   opt: (id: string) => boolean,
 *   skill: (id: string) => boolean,
 *   wait: (ticks: number) => void
 * }} WorkContext
 *
 * status  頭の上に出す状態（向かっている / 作業中 / 仕事待ち）
 * scan    村の周りの1列（一番上のブロック）を見て、仕事があれば addTask で登録する
 * options 村人ごとに切り替えられる作業の設定（例: 苗木を植え直す）
 * skills  レベルで覚える特技（Lv5・8・10 を想定）
 * work    仕事を1単位こなす。こなした数（または true=1）を返す。数だけ経験値が入る
 *         ctx.opt(id) で作業設定、ctx.skill(id) で特技を覚えているか、ctx.wait(tick) で次の作業を遅らせる
 *         ctx.bag は倉庫から持ち出した道具・材料（種など）。倉庫には戻さない
 * onStorage 倉庫に荷物を入れた後に呼ばれる。倉庫から材料を bag に持ち出せる
 * needsSupply 材料が足りず、倉庫へ取りに行きたいときに true
 */

/** @type {Map<string, JobDef>} */
const jobs = new Map();
let nextSlot = 0;

/**
 * 職業を登録する
 * @param {JobDef} def
 */
export function registerJob(def) {
  if (jobs.has(def.id)) return;
  if (def.work) {
    if (nextSlot >= MAX_SLOTS) {
      console.warn(`[blockAI] 職業の枠が足りません: ${def.id}`);
      return;
    }
    def.slot = nextSlot++;
  }
  jobs.set(def.id, def);
}

/** @param {string} id */
export function getJobDef(id) {
  return jobs.get(id) ?? /** @type {JobDef} */ (jobs.get("none"));
}

/** 仕事をする職業（無職を除く） */
export function workingJobs() {
  return [...jobs.values()].filter((j) => j.work);
}

export function allJobs() {
  return [...jobs.values()];
}

/**
 * 特技を覚えるレベル
 * @param {JobDef} job
 * @param {string} skillId
 */
export function skillLevel(job, skillId) {
  return job.skills?.find((s) => s.id === skillId)?.level ?? Infinity;
}

/**
 * 今後の職業パックで追加予定の職業（メニューで紹介する）
 * @type {{ name: string, pack: string }[]}
 */
export const PLANNED_JOBS = [
  { name: "石工", pack: "土木パック" },
  { name: "大工", pack: "土木パック" },
  { name: "鉱夫", pack: "土木パック" },
  { name: "漁師", pack: "農業パック" },
  { name: "養蜂家", pack: "農業パック" },
  { name: "羊飼い", pack: "畜産パック" },
  { name: "牧場主", pack: "畜産パック" },
  { name: "鍛冶屋", pack: "生産パック" },
  { name: "料理人", pack: "生産パック" },
];

/**
 * 無職（仕事をしない）
 */
registerJob({
  id: "none",
  name: "無職",
  skin: 0,
  pack: "基本",
  description: "のんびり村を歩き回ります。",
});
