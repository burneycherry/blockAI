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
if (!cfg.includes(`VERSION = "${ver}"`)) fail("config.js の VERSION が manifest と違います");

if (errors > 0) {
  console.error(`${errors} 件の問題があります`);
  process.exit(1);
}
console.log("validate OK");
