#!/usr/bin/env node
// 版本号一致性：以 package.json 与 plugins/plan-mode-ui/package.json 为唯一真源，
// 断言仓库里所有「对外可见版本」都与真源一致（README 版本行、marketplace、lock、版本表、dist 文件名）。
// 加进 npm run verify 后，任何一处漂移都会让校验变红。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const read = (p) => readFileSync(join(REPO, p), "utf8");
const json = (p) => JSON.parse(read(p));

const pkg = json("package.json");
const base = pkg.version;
const pub = pkg.publishedVersion;
const plugin = json("plugins/plan-mode-ui/package.json").version;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const check = (ok, label, detail) => {
  if (ok) console.log("  ✓ " + label);
  else problems.push(label + (detail ? "：" + detail : ""));
};

if (!SEMVER.test(base)) problems.push("package.json 的 version 不是合法语义版本：" + base);
if (!SEMVER.test(plugin)) problems.push("插件 package.json 的 version 不是合法语义版本：" + plugin);
console.log("  真源：主包 " + base + "（publishedVersion " + pub + "）· 插件 " + plugin);

// ① lock 文件
if (existsSync(join(REPO, "package-lock.json"))) {
  const lock = json("package-lock.json");
  check(lock.version === base, "package-lock.json 顶层 version = " + base, lock.version);
  const rootPkg = (lock.packages && lock.packages[""]) || {};
  check(rootPkg.version === base, "package-lock.json 根包 version = " + base, rootPkg.version);
}

// ② marketplace
const mp = json("marketplace/plugin.json");
check(mp.version === base, "marketplace/plugin.json version = " + base, mp.version);

// ③ README 版本行（中英各一处，必须同时出现主包与插件版本）
const readmeLine = (file, marker) => {
  const line = read(file).split("\n").find((l) => l.includes(marker));
  return line || "";
};
const cnLine = readmeLine("README.md", "当前版本");
check(cnLine.includes("v" + base), "README.md 版本行含 v" + base, "缺 v" + base);
check(cnLine.includes(plugin), "README.md 版本行含插件版本 " + plugin, "缺 " + plugin);
const enLine = readmeLine("README.en.md", "Current version");
check(enLine.includes(base), "README.en.md 版本行含 " + base, "缺 " + base);
check(enLine.includes(plugin), "README.en.md 版本行含插件版本 " + plugin, "缺 " + plugin);

// ④ 版本与兼容性表：必须有一行以当前版本开头，且标注为当前版本
const vtable = read("docs/版本与兼容性.md").split("\n").filter((l) => l.startsWith("| "));
const curRow = vtable.find((l) => l.split("|")[1] !== undefined && l.split("|")[1].trim() === base);
check(Boolean(curRow), "docs/版本与兼容性.md 有 " + base + " 这一行");
check(Boolean(curRow) && curRow.includes("当前版本"), "docs/版本与兼容性.md 的 " + base + " 行标注「当前版本」");
const staleCurrent = vtable.filter((l) => l.includes("当前版本") && l.split("|")[1] !== undefined && l.split("|")[1].trim() !== base);
check(staleCurrent.length === 0, "只有当前版本那一行标注「当前版本」", "多出 " + staleCurrent.length + " 行");

// ⑤ 插件兼容性文档里的写死版本（若有）必须等于插件真源
const compat = read("plugins/plan-mode-ui/兼容性-rc5.md");
const mentions = [...compat.matchAll(/dsh-plan-mode-ui\s*(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
const wrong = mentions.filter((v) => v !== plugin);
check(wrong.length === 0, "兼容性-rc5.md 引用的插件版本 = " + plugin, "出现旧版本 " + wrong.join(", "));

// ⑥ dist 里的附件文件名：两类附件各有各的版本口径，别互相要求。
//    - 组合包附件（主版本 Release 的那个）按 tag 命名：dsh-flash-presets-v0.2.6.zip
//    - 插件附件（若要单独发）按插件版本命名：dsh-plan-mode-ui-1.0.0.zip
if (existsSync(join(REPO, "dist"))) {
  const zips = readdirSync(join(REPO, "dist")).filter((f) => f.endsWith(".zip"));
  const badPlugin = zips.filter((f) => f.includes("plan-mode-ui") && !f.includes(plugin));
  check(badPlugin.length === 0, "dist/ 插件附件文件名带插件版本 " + plugin, badPlugin.join(", "));
  const badBundle = zips.filter((f) => f.startsWith("dsh-flash-presets-") && !f.includes(base));
  check(badBundle.length === 0, "dist/ 组合包附件文件名带版本 " + base, badBundle.join(", "));
}

// ⑦ 安装器 / marketplace / README 里写死的引用（第三轮审计 R3-4）
//    git tag 引用必须等于当前版本；npm 包号允许是「当前版本」或「已发布版本」——
//    版本号先落地、npm 后发时，文档里的 npm 命令必须指向真正装得到的那个版本。
const tagSources = ["scripts/install.sh", "scripts/install.ps1", "marketplace/plugin.json", "README.md", "README.en.md"];
const npmOk = new Set([base, pub].filter(Boolean));
for (const f of tagSources) {
  if (!existsSync(join(REPO, f))) continue;
  const text = read(f);
  const npmRefs = [...text.matchAll(/dsh-flash-presets@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  const gitRefs = [...text.matchAll(/dsh-flash-presets#v(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  const badNpm = [...new Set(npmRefs.filter((v) => !npmOk.has(v)))];
  const badGit = [...new Set(gitRefs.filter((v) => v !== base))];
  check(badNpm.length === 0, f + " 的 npm 引用 ∈ {" + [...npmOk].join(", ") + "}", "出现 " + badNpm.join(", "));
  check(badGit.length === 0, f + " 的 git tag 引用 = " + base, "出现 " + badGit.join(", "));
}

if (problems.length > 0) {
  console.error("✖ 版本号不一致（" + problems.length + " 处）：");
  for (const p of problems) console.error("  - " + p);
  console.error("  改法：以 package.json（及 plugins/plan-mode-ui/package.json）为真源，逐处手改；");
  console.error("        已发布版本的引用（npm 安装命令、marketplace 的 spec）用 node scripts/sync-published-version.mjs 同步。");
  process.exit(1);
}
console.log("✓ 版本号一致（主包 " + base + " · 插件 " + plugin + "）");