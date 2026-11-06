#!/usr/bin/env node
// 从预设/候选 patch 文件的 persona 规则段生成一个 --patch overlay：
// 用 system-prompt 的 personaSuffix 覆盖（不是 insert —— persona 插件会与 headless 自带的
// deployment:persona-prefix 冲突，挂载即报错，规则根本不会进 prompt）。
//
//   node scripts/ab-overlay.mjs --from presets/flash-lean-ptc-v3-lite.patch.yml --out /tmp/base.overlay.yml
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const from = opt("from");
const out = opt("out");
if (!from || !out) {
  console.error("用法: node scripts/ab-overlay.mjs --from <patch.yml> --out <overlay.yml>");
  process.exit(2);
}

const text = fs.readFileSync(from, "utf8");
const lines = text.split("\n");
const start = lines.findIndex((l) => /^\s*suffix: \|-/.test(l));
if (start < 0) {
  console.error("✖ " + from + " 里找不到 suffix: |-");
  process.exit(1);
}
const baseIndent = lines[start].match(/^\s*/)[0].length;
const body = [];
let end = start + 1;
for (; end < lines.length; end++) {
  const l = lines[end];
  if (l.trim() === "") { body.push(""); continue; }
  const indent = l.match(/^\s*/)[0].length;
  if (indent <= baseIndent) break;
  body.push(l.slice(baseIndent + 2));
}
while (body.length && body[body.length - 1] === "") body.pop();

const yml = [
  "- id: system-prompt",
  "  name: '@deepseek-ai/dsh-system-prompt'",
  "  config:",
  "    personaSuffix: |-",
  ...body.map((l) => (l ? "      " + l : "")),
].join("\n") + "\n";

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, yml, "utf8");
const rules = (yml.match(/^\s+\d+\. /gm) || []).length;
console.log("✓ " + path.basename(out) + "（" + body.length + " 行规则正文，编号规则 " + rules + " 条）");
