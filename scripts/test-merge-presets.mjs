#!/usr/bin/env node
/**
 * merge-presets.mjs 的回归用例（第四轮审计 P0/P1 那一批）。
 *
 *   node scripts/test-merge-presets.mjs
 *
 * 只用 Node 内置模块 + 仓库里的 node scripts/verify-yaml.mjs，不依赖 js-yaml 之外的包：
 * 重复卡片靠「缩进的 id: 行」计数判断，不靠 YAML 解析（CI 里不一定装了 js-yaml）。
 *
 * 覆盖的是真实踩过的坑：
 *   ① 裸行完整条目（199 行）以前被截成 13 行 → 判成「安装器写的」→ 删头留尾、写出坏 YAML；
 *   ② 卸载路径没有兜底 → 半条残留静默落盘；
 *   ③ 包装行带行尾注释 → 同 id 两份，永久两份；
 *   ④ - insert: 数组里混别人的条目 / 注释 → 以前整数组连坐删除；
 *   ⑤ 两条都被用户改过 → 以前写一个空托管块（insert: null）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const MERGE = join(here, "merge-presets.mjs");
const VERIFY = join(here, "verify-yaml.mjs");
const PRESETS = join(REPO, "presets");
const dir = mkdtempSync(join(tmpdir(), "merge-presets-test-"));
let seq = 0;
const rows = [];
const check = (name, cond, extra) => rows.push({ name, ok: !!cond, extra: extra === undefined ? "" : String(extra).slice(0, 120) });

// 同一张卡的重复：config.id 是缩进行，包装行是 "- id: preset-…"，两者都在同一文件里各出现一次
const idCount = (text, id) => [...text.matchAll(new RegExp("^[ \\t]+id: " + id + "$", "gm"))].length;
const managedBlock = (text) => {
  const m = /# >>> dsh-flash-presets[^\n]*\n([\s\S]*?)# <<< dsh-flash-presets/.exec(text);
  return m === null ? null : m[1];
};

function run(text, args = [], label = "case") {
  const file = join(dir, label + "-" + (++seq) + ".yml");
  writeFileSync(file, text);
  let code = 0, err = "";
  try {
    execFileSync(process.execPath, [MERGE, "--patch", file, "--presets-dir", PRESETS, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = e.status === null ? -1 : e.status;
    err = String(e.stderr || "");
  }
  let verifyCode = 0;
  try {
    execFileSync(process.execPath, [VERIFY, file], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    verifyCode = e.status === null ? -1 : e.status;
  }
  return { code, err, verifyCode, after: readFileSync(file, "utf8") };
}

// 造「裸行完整条目」：先让安装器写出标准块，再把 v3 那段搬到顶层（等价于用户手工粘贴原文）
const base = run("[]\n", [], "base");
const blockText = managedBlock(base.after) || "";
const v3 = /(^    - id: preset-flash-lean-ptc-v3\n[\s\S]*?)(?=^    - id: preset-flash-lean-ptc-v3-balance)/m.exec(blockText);
const v3Bare = (v3 === null ? "" : v3[1]).replace(/^    /gm, "");

/* ① 裸行完整条目 */
{
  const r = run(v3Bare, [], "bare");
  check("裸行完整条目：exit 0", r.code === 0, "exit=" + r.code + " " + r.err.trim().slice(0, 60));
  check("裸行完整条目：YAML 合法", r.verifyCode === 0, "verify=" + r.verifyCode);
  check("裸行完整条目：只有一张 v3 卡", idCount(r.after, "flash-lean-ptc-v3") === 1, "count=" + idCount(r.after, "flash-lean-ptc-v3"));
  check("裸行完整条目：托管块里是完整条目", /suffix/.test(managedBlock(r.after) || ""), "");
}

/* ①+② 前面还有用户行；卸载路径同样不许写坏 */
{
  const text = "- id: keep-me\n  name: '@me/keep'\n\n" + v3Bare;
  const r = run(text, [], "bare2");
  check("用户行在前：exit 0", r.code === 0, "exit=" + r.code);
  check("用户行在前：YAML 合法", r.verifyCode === 0, "verify=" + r.verifyCode);
  check("用户行在前：用户行还在", /id: keep-me/.test(r.after), "");
  check("用户行在前：v3 只有一张", idCount(r.after, "flash-lean-ptc-v3") === 1, "count=" + idCount(r.after, "flash-lean-ptc-v3"));
  const rm = run(text, ["--remove"], "remove");
  check("--remove：exit 0", rm.code === 0, "exit=" + rm.code);
  check("--remove：YAML 合法", rm.verifyCode === 0, "verify=" + rm.verifyCode);
  check("--remove：用户行还在", /id: keep-me/.test(rm.after), "");
  check("--remove：v3 残留清掉", !/preset-flash-lean-ptc-v3/.test(rm.after), rm.after.trim().slice(0, 60));
}

/* ③ 包装行带行尾注释 */
{
  const text = "- insert:\n    - id: preset-flash-lean-ptc-v3  # x\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v3\n";
  const r = run(text, [], "cmt");
  check("包装行带注释：exit 0", r.code === 0, "exit=" + r.code);
  check("包装行带注释：v3 只有一张", idCount(r.after, "flash-lean-ptc-v3") === 1, "count=" + idCount(r.after, "flash-lean-ptc-v3"));
}

/* ④ 数组里混别人的条目 + 数组内注释 */
{
  const text = "- insert:\n    # 我的备注\n    - id: preset-flash-lean-ptc-v3\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v3\n    - id: preset-flash-lean-ptc-v3b\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v3b\n";
  const r = run(text, [], "mixed");
  check("混合数组：exit 0", r.code === 0, "exit=" + r.code);
  check("混合数组：YAML 合法", r.verifyCode === 0, "verify=" + r.verifyCode);
  check("混合数组：别人的条目还在", /preset-flash-lean-ptc-v3b/.test(r.after), "");
  check("混合数组：注释还在", /我的备注/.test(r.after), "");
  check("混合数组：v3 是完整卡", /name: "精简·PTC v3（lean-v3）"/.test(r.after), "");
}

/* ⑤ 两条都被改过 → 不写空托管块 */
{
  const text = "- insert:\n    - id: preset-flash-lean-ptc-v3\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v3\n        order: 99\n- insert:\n    - id: preset-flash-lean-ptc-v3-balance\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v3-balance\n        order: 98\n";
  const r = run(text, [], "empty-block");
  check("全被保留：exit 0", r.code === 0, "exit=" + r.code);
  check("全被保留：不写空托管块", !/^- insert:\s*$/m.test(managedBlock(r.after) || ""), "");
  check("全被保留：用户的表还在", /order: 99/.test(r.after), "");
}

/* ⑥ --check 不写盘 */
{
  const file = join(dir, "check.yml");
  writeFileSync(file, "- insert:\n    - id: preset-flash-lean-ptc-v3\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v3\n");
  const before = readFileSync(file, "utf8");
  let code = 0;
  try {
    execFileSync(process.execPath, [MERGE, "--patch", file, "--presets-dir", PRESETS, "--check"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = e.status === null ? -1 : e.status;
  }
  check("--check：exit 0", code === 0, "exit=" + code);
  check("--check：不写盘", readFileSync(file, "utf8") === before, "");
}

const pass = rows.filter((r) => r.ok).length;
console.log("merge-presets 回归：" + pass + "/" + rows.length);
for (const r of rows) console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.extra ? "  [" + r.extra + "]" : ""));
process.exit(pass === rows.length ? 0 : 1);
