#!/usr/bin/env node
// 把 plugins/plan-mode-ui 打成 dist/dsh-plan-mode-ui-<version>.tgz，供 Release 附件与 --with-plan-mode 使用。
//   node scripts/pack-plugin.mjs             打包到 dist/
//   node scripts/pack-plugin.mjs --dry-run   只打印将要打进包里的文件
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const pluginDir = path.join(root, "plugins", "plan-mode-ui");
const dist = path.join(root, "dist");
const dry = process.argv.includes("--dry-run");

const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
const expected = ["lib", "cordis.patch.yml", "README.md", "LICENSE"];
const missing = expected.filter(f => !fs.existsSync(path.join(pluginDir, f)));
if (missing.length) {
  console.error("✖ 插件缺文件：" + missing.join(", "));
  process.exit(1);
}

fs.mkdirSync(dist, { recursive: true });
const args = ["pack", "--ignore-scripts", "--pack-destination", dist];
if (dry) args.push("--dry-run");
const out = execFileSync("npm", args, { cwd: pluginDir, encoding: "utf8" });
process.stdout.write(out);

if (!dry) {
  const tgz = path.join(dist, "dsh-plan-mode-ui-" + pkg.version + ".tgz");
  if (!fs.existsSync(tgz)) { console.error("✖ 未生成 " + tgz); process.exit(1); }
  const size = fs.statSync(tgz).size;
  console.log("✓ " + path.relative(root, tgz) + "（" + size + " B）");
}