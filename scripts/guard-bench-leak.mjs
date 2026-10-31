#!/usr/bin/env node
// 防作弊守卫：公开仓库里一旦出现私有评分资产（真值 / 评分器代码 / 私有材料包），构建直接失败。
//
// 审计后重写（2026-10-31）：旧版遍历目录，有三处盲区 —— 软链接扫不到、`任务目录.csv` 按名字白名单可被真值覆盖、
// 历史提交看不见。新版以「将要进仓库的文件」为准（tracked + untracked-not-ignored），并补了历史扫描与内容校验。
//
// 七道闸：① 哈希黑名单 ② 命名黑名单 ③ 结构性（inputs 之外禁止表格） ④ 输入件不得长成交付件
//         ⑤ 公开基准目录禁 Python ⑥ 任务目录.csv 内容校验 ⑦ 历史提交
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRADING = join(REPO, "benchmarks", "office", "grading", "公开评分标准", "文件校验.json");
const OFFICE = join(REPO, "benchmarks", "office");
const problems = [];

const git = (args, encoding = "utf8") => {
  try {
    const out = execFileSync("git", args, { cwd: REPO, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] });
    return encoding === "binary" ? out.toString("binary") : out.toString("utf8");
  } catch { return null; }
};
const hasGit = existsSync(join(REPO, ".git"));

// ---- ① 黑名单：公开规则文档自证的私有库指纹 ----
const fingerprints = new Map();
if (!existsSync(GRADING)) {
  problems.push("找不到 " + relative(REPO, GRADING) + "：没有它就无法确定私有库指纹，守卫形同虚设");
} else {
  const doc = JSON.parse(readFileSync(GRADING, "utf8"));
  for (const s of doc.source_fingerprints || []) fingerprints.set(s.sha256, s.source);
  if (fingerprints.size === 0) problems.push("文件校验.json 里没有 source_fingerprints：守卫缺少黑名单");
}

// ---- ② 命名黑名单 ----
const NAME_PATTERNS = [
  /(^|\/)reference\//i,
  /(^|\/)(gold|expected|truth|answers?)(\/|$)/i,
  /truth\.json$/i,
  /private[-_]stage/i,
  /评测方私有材料/,
  /(^|\/)(bench|score|score_one|grade_batch|build_suite|oracle_check|selftest)\.py$/i,
];

// ---- 采集：将进仓库的文件集合 ----
let files = [];
let mode = "git";
if (hasGit && git(["rev-parse", "--git-dir"]) !== null) {
  const listed = (git(["ls-files", "-z"]) || "") + (git(["ls-files", "-z", "-o", "--exclude-standard"]) || "");
  files = listed.split("\0").filter(Boolean).map((p) => join(REPO, p));
  const staged = git(["ls-files", "-s", "-z"]) || "";
  for (const entry of staged.split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const meta = entry.slice(0, tab);
    const path = entry.slice(tab + 1);
    if (meta.startsWith("120000") && path.startsWith("benchmarks/")) {
      problems.push("软链接：" + path + "（git 存链接不存内容，会让字节扫描失明）");
    }
  }
} else {
  mode = "walk";
  const skip = new Set([".git", "node_modules"]);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(join(dir, e.name)); }
      else if (e.isFile()) files.push(join(dir, e.name));
    }
  };
  walk(REPO);
  problems.push("未检测到 git：改为遍历目录，软链与历史提交两道闸失效（请在仓库内运行）");
}

// ---- 结构性规则需要的元数据：每题的交付表头 ----
const taskDirs = [];
if (existsSync(OFFICE)) {
  for (const set of readdirSync(OFFICE, { withFileTypes: true })) {
    if (!set.isDirectory()) continue;
    for (const t of readdirSync(join(OFFICE, set.name), { withFileTypes: true })) {
      if (!t.isDirectory() || !/^[OP]\d\d$/.test(t.name)) continue;
      const dir = join(OFFICE, set.name, t.name);
      const tmPath = join(dir, "task_manifest.json");
      if (!existsSync(tmPath)) continue;
      const tm = JSON.parse(readFileSync(tmPath, "utf8"));
      const outHeaders = new Set(Object.values(tm.outputs || {}).map((o) => (o.headers || []).join("|")));
      taskDirs.push({ rel: "benchmarks/office/" + set.name + "/" + t.name, dir, outHeaders });
    }
  }
}
const readHeader = (p) => {
  const buf = readFileSync(p);
  if (buf.length > 4 * 1024 * 1024) return null;
  const line = buf.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/)[0] || "";
  return line.split(",").map((s) => s.trim()).join("|");
};

const TABULAR = /\.(csv|tsv|xlsx?)$/i;
const isTaskInput = (rel) => /^benchmarks\/office\/[^/]+\/[^/]+\/inputs\//.test(rel);
const isCatalogCsv = (rel) => /^benchmarks\/office\/[^/]+\/任务目录\.csv$/.test(rel);

for (const file of files) {
  const rel = relative(REPO, file).split("\\").join("/");
  let st;
  try { st = statSync(file); } catch { continue; }
  if (!st.isFile()) continue;

  if (fingerprints.size > 0) {
    const h = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (fingerprints.has(h)) {
      problems.push("私有资产泄漏：" + rel + " 与私有库 " + fingerprints.get(h) + " 字节相同（改名也拦得住）");
      continue;
    }
  }
  // 真值 JSON 伪装成别的名字（t.json / notes.md…）：按**结构**判，不按文件名判。
  if (st.size < 8 * 1024 * 1024 && /\.(json|txt|md|csv)$/i.test(rel)) {
    const text = readFileSync(file).toString("utf8").replace(/^\uFEFF/, "").trim();
    if (text.startsWith("{")) {
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === "object" && obj.tables && obj.task_id && Array.isArray(obj.input_files)) {
          problems.push("真值 JSON 被伪装成：" + rel + "（结构含 tables/task_id/input_files）");
          continue;
        }
      } catch { /* 不是 JSON，忽略 */ }
    }
  }
  for (const re of NAME_PATTERNS) {
    if (re.test(rel)) { problems.push("可疑私有资产：" + rel + "（命中命名黑名单 " + String(re) + "）"); break; }
  }
  if (rel.startsWith("benchmarks/office/") && TABULAR.test(rel) && !isTaskInput(rel) && !isCatalogCsv(rel)) {
    problems.push("表格文件出现在 inputs/ 之外：" + rel + "（公开侧只发布输入件；真值/交付答案只能在私有仓库）");
  }
  if (isTaskInput(rel) && /\.csv$/i.test(rel)) {
    const h = readHeader(file);
    for (const t of taskDirs) {
      if (t.outHeaders.has(h)) {
        problems.push("输入件与交付件同构：" + rel + " 表头等于 " + t.rel + " 的交付表头（真值伪装成输入）");
        break;
      }
    }
  }
  if (rel.startsWith("benchmarks/office/") && extname(rel) === ".py") {
    problems.push("benchmarks/office 下不应出现 Python：" + rel + "（公开侧只放 check.mjs）");
  }
  if (isCatalogCsv(rel)) {
    const jsonPath = file.replace(/\.csv$/, ".json");
    const header = readHeader(file);
    if (!header || !header.split("|").includes("task_id")) {
      problems.push("任务目录.csv 表头不像题目清单：" + rel);
    } else if (existsSync(jsonPath)) {
      const rows = readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0).length - 1;
      const expect = JSON.parse(readFileSync(jsonPath, "utf8")).length;
      if (rows !== expect) problems.push("任务目录.csv 行数 " + rows + " ≠ 任务目录.json 题目数 " + expect + "：" + rel);
    }
  }
}

// ---- ⑦ 历史闸：提交过又删掉的私有资产也在仓库里 ----
// 审计发现只按文件名扫历史会被"改成陌生名字再提交"绕过，所以这里连**内容**一起判：
// ① 历史 blob 的 sha256 命中私有指纹；② 历史 blob 是 CSV 且表头等于某题交付表头；
// ③ 历史 blob 是 truth.json 形状（含 task_id + tables + input_files）。
if (hasGit) {
  const objects = git(["rev-list", "--all", "--objects"]);
  if (objects !== null) {
    const paths = new Map();
    for (const line of objects.split("\n")) {
      const sp = line.indexOf(" ");
      if (sp < 0) continue;
      const sha = line.slice(0, sp).trim();
      const path = line.slice(sp + 1).trim();
      if (sha && !paths.has(sha)) paths.set(sha, path);
    }
    let scanned = 0;
    for (const [sha, path] of paths) {
      if (path) {
        for (const re of NAME_PATTERNS) {
          if (re.test(path)) { problems.push("历史提交里出现过私有资产：" + path + "（即使已删除，仍可从历史恢复）"); break; }
        }
      }
      const raw = git(["cat-file", "-p", sha], "binary");
      if (raw === null || raw.length === 0 || !/^[0-9a-f]{40,64}$/.test(sha)) continue;
      scanned += 1;
      const buf = Buffer.from(raw, "binary");
      const h = createHash("sha256").update(buf).digest("hex");
      if (fingerprints.has(h)) {
        problems.push("历史 blob 命中私有指纹：" + (path || sha.slice(0, 8)) + " ← " + fingerprints.get(h));
        continue;
      }
      const text = buf.toString("latin1");
      if (!/\n/.test(text)) continue;
      // latin1 解码后 UTF-8 BOM 变成三个字节字符，必须一起剥掉，否则真值表头比对会因 BOM 首次失配。
      const firstLine = text.replace(/^\uFEFF/, "").replace(/^\u00EF\u00BB\u00BF/, "").split("\n")[0].replace(/\r$/, "");
      if (firstLine.includes(",") && firstLine.length < 4000) {
        const hv = firstLine.split(",").map((s) => s.trim()).join("|");
        for (const t of taskDirs) {
          if (t.outHeaders.has(hv)) {
            problems.push("历史 blob 是交付件形状的表格：" + (path || sha.slice(0, 8)) + " 表头等于 " + t.rel + " 的交付表头");
            break;
          }
        }
      }
      // 真值 JSON：必须真的能解析成对象且带 tables/task_id/input_files 三个键。
      // 只做子串匹配会误伤守卫自己的源码（里面就写着这几个键名）。
      const jtext = text.replace(/^\u00EF\u00BB\u00BF/, "").trim();
      if (jtext.startsWith("{") && jtext.length < 8 * 1024 * 1024) {
        try {
          const obj = JSON.parse(Buffer.from(buf).toString("utf8").replace(/^\uFEFF/, ""));
          if (obj && typeof obj === "object" && obj.tables && obj.task_id && Array.isArray(obj.input_files)) {
            problems.push("历史 blob 是 truth.json 形状：" + (path || sha.slice(0, 8)));
          }
        } catch { /* 不是 JSON，忽略 */ }
      }
    }
    if (problems.length === 0) console.log("  （历史闸：扫了 " + scanned + " 个 blob）");
  }
}

if (problems.length === 0) {
  console.log("✓ 防泄漏守卫通过（" + mode + " 采集 " + files.length + " 个待入库文件，" +
    fingerprints.size + " 条私有指纹，" + taskDirs.length + " 题交付表头基线，0 命中）");
} else {
  const uniq = [...new Set(problems)];
  console.log("✗ 防泄漏守卫失败：" + uniq.length + " 个问题");
  for (const p of uniq) console.log("   - " + p);
  process.exit(1);
}