// パックの簡易チェック: JSON の構文、manifest の依存バージョン、スクリプトの構文
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

let errors = 0;
const fail = (msg) => {
  console.error(`NG: ${msg}`);
  errors++;
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk("packs");
for (const f of files.filter((f) => f.endsWith(".json"))) {
  try {
    JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    fail(`${f}: ${e.message}`);
  }
}

for (const f of files.filter((f) => f.endsWith(".js"))) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    fail(`${f}: ${e.stderr}`);
  }
}

// Minecraft がコンテンツログで出したエラーの再発防止
for (const f of files.filter((f) => f.startsWith(join("packs", "RP", "entity")))) {
  const d = JSON.parse(readFileSync(f, "utf8"))["minecraft:client_entity"]?.description;
  if (!d) continue;
  if (d.animation_controllers) fail(`${f}: animation_controllers は使えません（animations + scripts.animate を使う）`);
  if (!Array.isArray(d.render_controllers) || d.render_controllers.length === 0) fail(`${f}: render_controllers が空です`);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const bp = JSON.parse(readFileSync("packs/BP/manifest.json", "utf8"));
const rp = JSON.parse(readFileSync("packs/RP/manifest.json", "utf8"));
for (const dep of bp.dependencies) {
  if (dep.module_name && pkg.devDependencies[dep.module_name] !== dep.version) {
    fail(`manifest の ${dep.module_name} ${dep.version} と package.json が一致しません`);
  }
  if (dep.uuid && dep.uuid !== rp.header.uuid) fail("BP が参照する RP の uuid が違います");
}

// バージョンを上げ忘れると、iPhone で読み込み直しても古いパックのままになる
const ver = bp.header.version.join(".");
if (rp.header.version.join(".") !== ver) fail("BP と RP の version が違います");
if (pkg.version !== ver) fail(`package.json の version (${pkg.version}) と manifest (${ver}) が違います`);
const cfg = readFileSync("packs/BP/scripts/config.js", "utf8");
// 取り込み先のフォルダ名は manifest の name で決まる。版ごとに変えて、古いキャッシュと混ざらないようにする
for (const m of [bp, rp]) {
  if (!m.header.name.includes(`v${ver}`)) fail(`manifest の name (${m.header.name}) に v${ver} が入っていません`);
}
if (!cfg.includes(`VERSION = "${ver}"`)) fail("config.js の VERSION が manifest と違います");
// パック一覧で見分けられるよう、表示名にもバージョンを入れる
for (const f of files.filter((f) => f.endsWith(".lang"))) {
  const line = readFileSync(f, "utf8").split("\n").find((l) => l.startsWith("pack.name="));
  if (line && !line.includes(`v${ver}`)) fail(`${f} の pack.name に v${ver} が入っていません`);
}

if (errors > 0) {
  console.error(`${errors} 件の問題があります`);
  process.exit(1);
}
console.log("validate OK");
