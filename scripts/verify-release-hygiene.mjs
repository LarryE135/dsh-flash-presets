#!/usr/bin/env node
// 发布面卫生检查：插件（dsh-plan-mode-ui）不得单独出现在 Releases / tags 里。
// 约定见 docs/PUBLISHING.md「插件不单独建 Release」：插件 zip 作为主版本 Release 的附件发布。
// 网络或 gh 不可用时不假装通过，打印「未验证」。
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_TAG = /^plan-mode-ui-/;
const problems = [];
const unverified = [];

const run = (cmd, args) => {
  try { return execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
};
const ghBin = () => {
  if (run("gh", ["--version"]) !== null) return "gh";
  const win = "/mnt/c/Program Files/GitHub CLI/gh.exe";
  if (existsSync(win) && run(win, ["--version"]) !== null) return win;
  return null;
};

// ① Releases 里不许有插件条目
const gh = ghBin();
if (gh === null) {
  unverified.push("gh 不可用，Releases 列表未检查");
} else {
  const out = run(gh, ["release", "list", "--limit", "30", "--json", "tagName"]);
  if (out === null) {
    unverified.push("gh release list 失败（未登录或无网络），Releases 列表未检查");
  } else {
    const tags = JSON.parse(out).map((r) => r.tagName);
    const bad = tags.filter((t) => PLUGIN_TAG.test(t));
    if (bad.length > 0) problems.push("Releases 里出现了插件条目：" + bad.join(", ") + "（应改为主版本 Release 的附件）");
    else console.log("  ✓ Releases 无插件条目（共 " + tags.length + " 条主版本）");
  }
}

// ② 远端 tags 里不许有插件 tag
const tagOut = run("git", ["ls-remote", "--tags", "origin"]);
if (tagOut === null) {
  unverified.push("git ls-remote 失败（无网络），远端 tags 未检查");
} else {
  const names = tagOut.split("\n").map((l) => l.split("refs/tags/")[1] || "").filter(Boolean).filter((n) => !n.endsWith("^{}"));
  const bad = names.filter((n) => PLUGIN_TAG.test(n));
  if (bad.length > 0) problems.push("远端 tags 里有插件 tag：" + bad.join(", ") + "（会让 Releases 页多一条并可能抢走 Latest）");
  else console.log("  ✓ 远端 tags 无插件 tag（共 " + names.length + " 个）");
}

// ③ 文档里不许出现插件 Release 的可下载链接
const walk = (dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(md|txt|json|ya?ml)$/i.test(e.name)) acc.push(p);
  }
  return acc;
};
const linkHits = [];
for (const f of walk(REPO)) {
  const body = readFileSync(f, "utf8");
  for (const line of body.split(/\r?\n/)) {
    if (/releases\/(tag|download)\/plan-mode-ui-/.test(line)) linkHits.push(f.replace(REPO + "/", "") + "  " + line.trim().slice(0, 80));
  }
}
if (linkHits.length > 0) problems.push("文档里有指向插件 Release 的链接：" + linkHits[0]);
else console.log("  ✓ 文档里没有插件 Release 链接");

// ④ 约定本身要在文档里写着（防止下一个人不知道又打 tag）
const pub = join(REPO, "docs", "PUBLISHING.md");
if (!existsSync(pub) || !/插件（\x60dsh-plan-mode-ui\x60）不单独建 Release/.test(readFileSync(pub, "utf8"))) {
  problems.push("docs/PUBLISHING.md 缺少「插件不单独建 Release」约定（这条规则会失传）");
} else {
  console.log("  ✓ PUBLISHING.md 记录了该约定");
}

for (const u of unverified) console.log("  ! 未验证：" + u);
if (problems.length === 0) {
  console.log(unverified.length === 0 ? "✓ 发布面卫生检查通过" : "✓ 可检查部分通过（有 " + unverified.length + " 项未验证）");
} else {
  console.log("✗ 发布面卫生检查失败：" + problems.length + " 项");
  for (const p of problems) console.log("   - " + p);
  process.exit(1);
}