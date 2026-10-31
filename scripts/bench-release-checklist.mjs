#!/usr/bin/env node
// 发布前人工复核：把"人眼要看的东西"自动收集出来，人只负责确认三项。
// 与 guard-bench-leak 的分工：守卫拦可识别的形状；这里只收集证据并做少量硬检查（二进制、submodule、可下载链接）。
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args) => {
  try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
};

const hard = [];
const lines = [];
const say = (s = "") => lines.push(s);

say("办公基准 · 发布前人工复核");
say("=".repeat(46));

// ---- ① 候选：新增文本里"像数据行"的行 ----
// 与守卫同一口径：tracked + untracked-not-ignored。只看 tracked 会漏掉"刚拷进来还没 add"的文件，
// 而那恰恰是手滑搬真值最常见的时刻。
const tracked = (git(["ls-files", "benchmarks/"]) + git(["ls-files", "-o", "--exclude-standard", "benchmarks/"]))
  .split("\n").filter(Boolean);
const textFiles = tracked.filter((p) => /\.(md|txt|json|csv)$/i.test(p));
const suspicious = [];
for (const rel of textFiles) {
  const p = join(REPO, rel);
  if (!existsSync(p) || statSync(p).size > 2 * 1024 * 1024) continue;
  const body = readFileSync(p, "utf8");
  body.split(/\r?\n/).forEach((line, i) => {
    const commas = (line.match(/,/g) || []).length;
    if (commas < 6) return;
    const digits = (line.match(/[0-9]/g) || []).length;
    if (digits < 6) return;
    // 输入件本身就是数据，不算可疑；重点看文档/JSON 里冒出来的数据行
    if (/\/inputs\//.test(rel)) return;
    suspicious.push(rel + ":" + (i + 1) + "  " + line.slice(0, 90));
  });
}
say("[1] 文档/JSON 里的数据行候选：" + suspicious.length + " 条");
for (const s of suspicious.slice(0, 8)) say("    " + s);
if (suspicious.length > 8) say("    …还有 " + (suspicious.length - 8) + " 条");
say("    → 需人眼确认：这些行都不是真实交付数据（真值只能在私有仓库）");
say("");

// ---- ② 二进制与 base64 ----
// 两段判：inputs/ 之外的二进制是硬失败；inputs/ 里的必须是已登记输入件（并交人眼确认"是原材料不是答案截图"）。
// O08 的 9 张扫描小票就是合法输入 —— 一刀切"禁止二进制"会误报。
const BINARY = /\.(zip|gz|tgz|png|jpe?g|gif|webp|ico|pdf|xlsx?|docx?|pptx?)$/i;
const binaries = tracked.filter((p) => BINARY.test(p));
const isInputBinary = (p) => /^benchmarks\/office\/[^/]+\/[^/]+\/inputs\//.test(p);
const outsideInputs = binaries.filter((p) => !isInputBinary(p));
const insideInputs = binaries.filter(isInputBinary);

const registered = new Set();
const officeRoot = join(REPO, "benchmarks", "office");
if (existsSync(officeRoot)) {
  for (const set of readdirSync(officeRoot, { withFileTypes: true })) {
    if (!set.isDirectory()) continue;
    for (const t of readdirSync(join(officeRoot, set.name), { withFileTypes: true })) {
      if (!t.isDirectory() || !/^[OP]\d\d$/.test(t.name)) continue;
      const imPath = join(officeRoot, set.name, t.name, "input_manifest.json");
      if (!existsSync(imPath)) continue;
      for (const f of JSON.parse(readFileSync(imPath, "utf8")).files || []) {
        registered.add("benchmarks/office/" + set.name + "/" + t.name + "/inputs/" + f.path);
      }
    }
  }
}
const unregistered = insideInputs.filter((p) => !registered.has(p));

const base64Hits = [];
for (const rel of textFiles) {
  const p = join(REPO, rel);
  if (!existsSync(p)) continue;
  if (/base64,|data:image\//.test(readFileSync(p, "utf8"))) base64Hits.push(rel);
}
say("[2] 二进制：" + binaries.length + " 个（inputs/ 内 " + insideInputs.length + "，之外 " + outsideInputs.length + "）；" +
  "未登记 " + unregistered.length + "；base64/data-uri 命中 " + base64Hits.length);
for (const b of insideInputs) say("    输入件（需人眼确认是原材料）：" + b);
for (const b of outsideInputs) say("    X inputs 之外的二进制：" + b);
for (const b of unregistered) say("    X 未登记输入件：" + b);
for (const b of base64Hits) say("    X base64：" + b);
if (outsideInputs.length > 0) hard.push("benchmarks/ 的 inputs 之外出现了二进制：" + outsideInputs.slice(0, 3).join(", "));
if (unregistered.length > 0) hard.push("inputs/ 里有未登记的二进制：" + unregistered.slice(0, 3).join(", "));
if (base64Hits.length > 0) hard.push("文档里出现 base64/data-uri：" + base64Hits.slice(0, 3).join(", "));
if (insideInputs.length > 0) say("    -> 需人眼确认：上述输入件是「要处理的材料」，不是「答案截图」");
say("");
// ---- ③ 私有库可达性（硬检查） ----
const hasSubmodule = existsSync(join(REPO, ".gitmodules"));
const linkHits = [];
for (const rel of tracked.filter((p) => /\.(md|txt|json|ya?ml)$/i.test(p))) {
  const p = join(REPO, rel);
  if (!existsSync(p)) continue;
  const body = readFileSync(p, "utf8");
  for (const line of body.split(/\r?\n/)) {
    if (!line.includes("dsh-office-bench-private")) continue;
    if (/(blob|raw|tree|releases)\//.test(line)) linkHits.push(rel + "  " + line.trim().slice(0, 90));
  }
}
say("[3] .gitmodules " + (hasSubmodule ? "存在（应为空）" : "不存在 ✓") + "；指向私有库的可下载链接 " + linkHits.length + " 条");
for (const l of linkHits) say("    " + l);
if (hasSubmodule) hard.push("存在 .gitmodules：不得用 submodule 指向私有库");
if (linkHits.length > 0) hard.push("文档里有指向私有库的可下载链接：" + linkHits[0]);
say("    → 需人眼确认：gh repo view LarryE135/dsh-office-bench-private 仍为 PRIVATE");
say("");

// ---- 结论 ----
say("-".repeat(46));
if (hard.length === 0) {
  say("自动硬检查 3/3 通过；剩余 2 项需人工确认（数据行候选、私有库可见性）。");
  say("完整清单：benchmarks/office/grading/发布前复核清单.md");
  console.log(lines.join("\n"));
} else {
  say("自动硬检查失败：" + hard.length + " 项");
  for (const h of hard) say("   - " + h);
  console.log(lines.join("\n"));
  process.exit(1);
}