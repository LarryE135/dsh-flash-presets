#!/usr/bin/env node
// 把 package.json 的 publishedVersion 同步成当前 version（发布成功后跑一次）。
//
// 为什么需要它：lint-presets.mjs 用 publishedVersion 生成"文档里允许引用的已发布版本"白名单。
// 发版后忘了同步，文档即使锁到上一个版本也不会被拦（issue #16 第 5 项）。
// 本仓库没有把 npm publish 放进 publish.sh/publish.ps1，所以这一步是独立的显式动作。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(ROOT, "package.json");
const raw = readFileSync(path, "utf8");
const pkg = JSON.parse(raw);
if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+/.test(pkg.version)) {
  console.error("✖ package.json 的 version 不是合法语义版本：" + String(pkg.version));
  process.exit(1);
}
if (pkg.publishedVersion === pkg.version) {
  console.log("✓ publishedVersion 已是 " + pkg.version + "，无需改动");
  process.exit(0);
}
pkg.publishedVersion = pkg.version;
writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
console.log("✓ publishedVersion: " + (pkg.publishedVersion === pkg.version ? "已同步为 " + pkg.version : "未变"));
