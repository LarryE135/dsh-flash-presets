#!/usr/bin/env node
// 防作弊守卫：公开仓库里一旦出现私有评分资产（真值 / 评分器代码 / 私有材料包），构建直接失败。
// 三道闸：① 哈希黑名单（改文件名也拦得住）② 命名黑名单 ③ 公开基准目录不得出现 .py
// 黑名单来源：benchmarks/office/grading/公开评分标准/文件校验.json 的 source_fingerprints —— 公开规则
// 文档自己声明的私有库指纹，天然构成「这批文件不许公开」的白纸黑字。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRADING = join(REPO, "benchmarks", "office", "grading", "公开评分标准", "文件校验.json");
const SKIP_DIRS = new Set([".git", "node_modules", ".dsh", "dist", "coverage"]);

const problems = [];

// ---- 黑名单：指纹来自公开规则文档自证的私有库版本 ----
const fingerprints = new Map();
if (!existsSync(GRADING)) {
  problems.push("找不到 " + relative(REPO, GRADING) + "：没有它就无法确定私有库指纹，守卫形同虚设");
} else {
  const doc = JSON.parse(readFileSync(GRADING, "utf8"));
  for (const s of doc.source_fingerprints || []) fingerprints.set(s.sha256, s.source);
  if (fingerprints.size === 0) problems.push("文件校验.json 里没有 source_fingerprints：守卫缺少黑名单");
}

// ---- 命名黑名单 ----
const NAME_PATTERNS = [
  /(^|\/)reference\//i,
  /(^|\/)(gold|expected|truth|answers?)(\/|$)/i,
  /private[-_]stage/i,
  /评测方私有材料/,
  /(^|\/)(bench|score|grade_batch|build_suite|oracle_check|selftest)\.py$/i,
  /truth\.json$/i,
];

// ---- 结构性不变式：公开侧除了 inputs/ 里的输入件，不允许出现任何表格数据 ----
// 真值 CSV 一旦混进来（直接拷、改名、放进题目录），它就是"满分答案"。
// 这条规则比哈希闸更硬：它不依赖"我知道每份真值的哈希"，只依赖"公开侧不该有交付答案"。
const TABULAR = /\.(csv|tsv|xlsx?)$/i;
const isTaskInput = (rel) => /^benchmarks\/office\/[^/]+\/[^/]+\/inputs\//.test(rel);
// 套件根目录的 任务目录.csv 是题目清单（元数据），不是交付答案，属正当例外。
const isCatalog = (rel) => /^benchmarks\/office\/[^/]+\/任务目录\.csv$/.test(rel);

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
    } else if (e.isFile()) {
      files.push(join(dir, e.name));
    }
  }
};
walk(REPO);

for (const file of files) {
  const rel = relative(REPO, file).split("\\").join("/");
  // ① 哈希闸
  if (fingerprints.size > 0) {
    const h = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (fingerprints.has(h)) {
      problems.push("私有资产泄漏：" + rel + " 与私有库 " + fingerprints.get(h) + " 字节相同（改名也拦得住）");
      continue;
    }
  }
  // ② 命名闸
  for (const re of NAME_PATTERNS) {
    if (re.test(rel)) { problems.push("可疑私有资产：" + rel + "（命中命名黑名单 " + String(re) + "）"); break; }
  }
  // ③ 公开基准目录不得有 .py
  if (rel.startsWith("benchmarks/office/") && extname(rel) === ".py") {
    problems.push("benchmarks/office 下不应出现 Python：" + rel + "（公开侧只放 check.mjs）");
  }
  // ④ 结构性不变式：inputs/ 之外不得有任何表格文件
  if (rel.startsWith("benchmarks/office/") && TABULAR.test(rel) && !isTaskInput(rel) && !isCatalog(rel)) {
    problems.push("表格文件出现在 inputs/ 之外：" + rel +
      "（公开侧只应发布输入件；真值/交付答案只能在私有仓库）");
  }
}

if (problems.length === 0) {
  console.log("✓ 防泄漏守卫通过（扫描 " + files.length + " 个文件，" + fingerprints.size + " 条私有指纹，0 命中）");
} else {
  console.log("✗ 防泄漏守卫失败：" + problems.length + " 个问题");
  for (const p of problems) console.log("   - " + p);
  process.exit(1);
}