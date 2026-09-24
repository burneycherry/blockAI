// テスト用 zip を作る（iPhone/iPad の development_*_packs フォルダに上書きして使う）
// - フォルダ名は blockAI_BP / blockAI_RP で固定（上書きで入れ替えられるように）
// - パックの版は TEST_VERSION で固定（ワールドへの付け直しが要らないように）
// - UUID は配布版と同じ（村のデータをそのまま使えるように）
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_VERSION = [0, 0, 1];
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const work = join(root, "dist", "test");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

for (const [src, dest, label] of [
  ["BP", "blockAI_BP", "ビヘイビア"],
  ["RP", "blockAI_RP", "リソース"],
]) {
  const out = join(work, dest);
  cpSync(join(root, "packs", src), out, { recursive: true });
  const file = join(out, "manifest.json");
  const m = JSON.parse(readFileSync(file, "utf8"));
  m.header.name = `blockAI 村づくり テスト版 (${label})`;
  m.header.description = `中身は v${version}（テスト用・上書きして使う）`;
  m.header.version = TEST_VERSION;
  for (const mod of m.modules) mod.version = TEST_VERSION;
  for (const dep of m.dependencies ?? []) if (dep.uuid) dep.version = TEST_VERSION;
  writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
}

const zip = `blockAI-test-v${version}.zip`;
execFileSync("zip", ["-qr", join("..", zip), "blockAI_BP", "blockAI_RP", "-x", "*.DS_Store"], { cwd: work });
rmSync(work, { recursive: true, force: true });
console.log(`dist/${zip}`);
