#!/usr/bin/env node
// 发布成功后跑一次：把「已发布版本」同步到仓库里所有对外可见的安装引用。
//
// 为什么需要它：lint-presets.mjs 用 publishedVersion 生成「文档里允许引用的已发布版本」白名单。
// 2026-11-12 的审计（docs/审计-20261112-0.3.1.md 第 C 条）发现旧版只改 publishedVersion，
// 而 verify-versions.mjs 的报错提示却说它会同步 marketplace 的 npm 引用 —— 结果一改就红。
// 现在它真的同步：publishedVersion + marketplace/plugin.json + README 的 npm 安装命令。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(REPO, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const prev = pkg.publishedVersion;

if (pkg.publishedVersion === pkg.version) {
  console.log("✓ publishedVersion 已是 " + pkg.version + "，无需改动");
} else {
  pkg.publishedVersion = pkg.version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("✓ publishedVersion: " + prev + " → " + pkg.version);
}

// 安装引用：只在「旧已发布版本」字面出现时替换，避免误改历史记录里的旧号
const files = ["marketplace/plugin.json", "README.md", "README.en.md", "scripts/install.sh", "scripts/install.ps1"];
let touched = 0;
for (const rel of files) {
  const p = join(REPO, rel);
  let t;
  try {
    t = readFileSync(p, "utf8");
  } catch {
    continue;
  }
  const before = t;
  t = t.replaceAll("dsh-flash-presets@" + prev, "dsh-flash-presets@" + pkg.version);
  if (t !== before) {
    writeFileSync(p, t);
    touched += 1;
    console.log("✓ " + rel + "：npm 安装引用 " + prev + " → " + pkg.version);
  }
}
if (touched === 0) console.log("  （安装引用已经指向 " + pkg.version + "，未改动）");
