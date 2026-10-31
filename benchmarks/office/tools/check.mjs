#!/usr/bin/env node
// 办公基准测试 v1 / 办公追加测试 v1 的结构与完整性校验器（L1 结构分）。
// 判据：必备文件齐、每个输入文件 sha256 复算一致、prompt/input_manifest 哈希复算一致、
//       题面里声明的交付表头 == task_manifest.outputs 的 headers、目录清单哈希一致、
//       inputs 的字节保持策略（.gitattributes -text）存在。
// 用法：node benchmarks/office/tools/check.mjs [--quiet]
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "..", "..");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const shaFile = (p) => sha(readFileSync(p));
const quiet = process.argv.includes("--quiet");

const problems = [];
const notes = [];
const fail = (where, msg) => problems.push(where + ": " + msg);

// 题面里「交付 x.csv：a,b,c。」的列序提取（容忍全角冒号与中英逗号混用）
function declaredHeaders(promptText) {
  const out = {};
  // 动词可能是「交付 / 另交 / 输出 / 写入」；字段表后面常跟「，覆盖…」「source_ref=…」等附加说明，
  // 所以只取开头连续的裸标识符，遇到第一个非标识符就停。
  const re = /(?:交付|另交|输出|写入)\s*([A-Za-z0-9_.\-]+\.csv)\s*[：:]\s*([^。\n]*)/g;
  let m;
  while ((m = re.exec(promptText)) !== null) {
    const cols = [];
    for (const raw of m[2].split(/[,，]/)) {
      const tok = raw.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) break;
      cols.push(tok);
    }
    if (cols.length > 0) out[m[1]] = cols;
  }
  return out;
}

function checkTask(where, dir) {
  const need = ["任务说明.md", "task_manifest.json", "input_manifest.json", "inputs"];
  const have = existsSync(dir) ? readdirSync(dir) : [];
  for (const n of need) if (!have.includes(n)) fail(where, "缺少 " + n);
  if (need.some((n) => !have.includes(n))) return { skipped: true };

  const promptPath = join(dir, "任务说明.md");
  const prompt = readFileSync(promptPath, "utf8");
  const manifest = JSON.parse(readFileSync(join(dir, "task_manifest.json"), "utf8"));
  const inputManifest = JSON.parse(readFileSync(join(dir, "input_manifest.json"), "utf8"));

  // 1) 输入逐文件 sha256
  let inputs = 0;
  let inputBytes = 0;
  for (const f of inputManifest.files || []) {
    const p = join(dir, "inputs", f.path);
    if (!existsSync(p)) { fail(where, "输入缺文件 " + f.path); continue; }
    const buf = readFileSync(p);
    inputs += 1;
    inputBytes += buf.length;
    if (sha(buf) !== f.sha256) fail(where, "输入哈希不符 " + f.path);
    if (typeof f.bytes === "number" && buf.length !== f.bytes) fail(where, "输入字节数不符 " + f.path);
  }
  // 目录里多出来的输入（manifest 未登记）
  const registered = new Set((inputManifest.files || []).map((f) => f.path));
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = relative(join(dir, "inputs"), p).split("\\").join("/");
        if (!registered.has(rel)) fail(where, "输入未登记 " + rel);
      }
    }
  };
  walk(join(dir, "inputs"));

  // 1b) 文本件必须是 LF：git 的 * text=auto eol=lf 会在 clone/checkout 时把 CRLF 改成 LF，
  //     那样这些文件参与计算的 sha256 会漂移（inputs 已用 -text 例外保护，文本件则直接要求 LF）。
  for (const f of ["task_manifest.json", "input_manifest.json", "任务说明.md"]) {
    const p = join(dir, f);
    if (existsSync(p) && readFileSync(p).includes("\r\n")) {
      fail(where, f + " 含 CRLF：git 规范化后会与哈希不符，请先转成 LF 再回写哈希");
    }
  }

  // 2) 题面与 input_manifest 的哈希
  if (manifest.prompt_sha256 && shaFile(promptPath) !== manifest.prompt_sha256) {
    fail(where, "prompt_sha256 与 任务说明.md 不一致（改题面后要回写）");
  }
  if (manifest.input_manifest_sha256 && shaFile(join(dir, "input_manifest.json")) !== manifest.input_manifest_sha256) {
    fail(where, "input_manifest_sha256 与 input_manifest.json 不一致");
  }

  // 3) 题面声明的交付表头 == manifest.headers
  const declared = declaredHeaders(prompt);
  for (const [file, spec] of Object.entries(manifest.outputs || {})) {
    const d = declared[file];
    if (d === undefined) { fail(where, "题面未声明交付表头 " + file); continue; }
    if (d.join(",") !== (spec.headers || []).join(",")) {
      fail(where, file + " 表头不一致：题面[" + d.join(",") + "] vs manifest[" + (spec.headers || []).join(",") + "]");
    }
  }
  for (const file of Object.keys(declared)) {
    if (!(file in (manifest.outputs || {}))) fail(where, "题面声明了 manifest 里没有的交付文件 " + file);
  }

  return { inputs, inputBytes, outputs: Object.keys(manifest.outputs || {}) };
}

// ---- 基准套 ----
const baseRoot = join(ROOT, "base-v1");
if (!existsSync(baseRoot)) fail("base-v1", "目录不存在");
else {
  const catalog = JSON.parse(readFileSync(join(baseRoot, "任务目录.json"), "utf8"));
  for (const t of catalog) {
    const where = "base-v1/" + t.task_id;
    const dir = join(baseRoot, t.task_id);
    const r = checkTask(where, dir);
    if (r.skipped) continue;
    if (t.manifest_sha256 && shaFile(join(dir, "task_manifest.json")) !== t.manifest_sha256) {
      fail(where, "任务目录.json 的 manifest_sha256 与 task_manifest.json 不一致");
    }
    if (typeof t.input_files === "number" && t.input_files !== r.inputs) {
      fail(where, "任务目录 input_files=" + t.input_files + " 实际 " + r.inputs);
    }
    if (typeof t.input_bytes === "number" && t.input_bytes !== r.inputBytes) {
      fail(where, "任务目录 input_bytes=" + t.input_bytes + " 实际 " + r.inputBytes);
    }
    if (!quiet) console.log("  · " + t.task_id + " 输入 " + r.inputs + " 个 / " + r.inputBytes + " B，交付 " + r.outputs.join(","));
  }
  notes.push("base-v1 题目数 " + catalog.length);
}

// ---- 追加套 ----
const addRoot = join(ROOT, "addendum-v1");
if (!existsSync(addRoot)) fail("addendum-v1", "目录不存在");
else {
  const ids = readdirSync(addRoot).filter((n) => /^[A-Z]\d+$/.test(n)).sort();
  if (ids.length === 0) fail("addendum-v1", "没有题目目录");
  for (const id of ids) {
    const where = "addendum-v1/" + id;
    const r = checkTask(where, join(addRoot, id));
    if (r.skipped) continue;
    if (!quiet) console.log("  · " + id + " 输入 " + r.inputs + " 个 / " + r.inputBytes + " B，交付 " + r.outputs.join(","));
  }
  notes.push("addendum-v1 题目数 " + ids.length);
}

// ---- 字节保持策略：inputs 不能被 git 规范化，否则 sha256 全部失效 ----
const gitattributes = existsSync(join(REPO, ".gitattributes")) ? readFileSync(join(REPO, ".gitattributes"), "utf8") : "";
if (!/benchmarks\/office\/\*\*\/inputs\/\*\*\s+-text/.test(gitattributes)) {
  fail(".gitattributes", "缺少 benchmarks/office/**/inputs/** -text：git 会把 CRLF 规范化成 LF，导致输入 sha256 全部失效");
}

// ---- 公开评分标准：自证哈希 + 私有指纹齐备 ----
const gradePath = existsSync(join(ROOT, "grading", "公开评分标准", "文件校验.json"))
  ? join(ROOT, "grading", "公开评分标准", "文件校验.json")
  : null;
if (gradePath === null) {
  fail("grading", "缺少 grading/公开评分标准/文件校验.json：评分规则没有版本锚点");
} else {
  const doc = JSON.parse(readFileSync(gradePath, "utf8"));
  for (const f of doc.files || []) {
    const p = join(dirname(gradePath), f.name);
    if (!existsSync(p)) { fail("grading", "缺少 " + f.name); continue; }
    const buf = readFileSync(p);
    if (sha(buf) !== f.sha256) fail("grading", f.name + " 内容与 文件校验.json 不符（规则被改动过）");
    if (typeof f.bytes === "number" && buf.length !== f.bytes) fail("grading", f.name + " 字节数不符");
  }
  if ((doc.source_fingerprints || []).length === 0) fail("grading", "文件校验.json 缺少 source_fingerprints（防泄漏守卫没有黑名单）");
  notes.push("评分规则 " + (doc.files || []).length + " 个文件自证一致，私有指纹 " + (doc.source_fingerprints || []).length + " 条");
}

// ---- 汇总 ----
for (const n of notes) if (!quiet) console.log("  " + n);
if (problems.length === 0) {
  console.log("\n✓ 办公基准测试校验通过（结构 + 完整性 + 表头一致性）");
  process.exit(0);
} else {
  console.log("\n✗ 发现 " + problems.length + " 个问题：");
  for (const p of problems) console.log("   - " + p);
  process.exit(1);
}