// dsh-flash-sh：Windows x64 上可选的 Bash 兼容 shell 工具（工具名 flash_sh）。
//
// 一份实现，两种装法：
//   · 独立组合包：本包自己的补丁行 id: flash-sh-standalone（cordis.patch.yml）；
//   · dsh-flash-presets 的子功能：presets 把本包声明为 optionalDependencies（os:[win32] cpu:[x64]，
//     非 Windows x64 上 pnpm/npm 直接跳过、不下载 exe），在 flash-presets 那一行的 config.flashSh 下
//     用 createPlugin({ owner: "dsh-flash-presets" }) 挂上。
//   两者同时启用时，经进程级协调器（globalThis[Symbol.for("dsh-flash-sh/coordinator@1")]）只注册一次：
//   presets 子功能优先（优先级 2 ＞ 独立行 1），独立行检测到后跳过并记日志；presets 那边被关掉/卸载时独立行接管。
//   别的插件（第三方）已经注册了 flash_sh 时两边都不抢，等它注销后再补上。
//
// 开关优先级：环境变量 DSH_FLASH_SH=0/1 ＞ config.enabled ＞ 默认 false。
// 只在 Windows x64 注册（DSH_FLASH_SH_ANY_PLATFORM=1 / allowNonWindows 仅供开发验证，需配合 binPath）。
//
// 安全面（2026-11-24 审计修复，见 README「安全」）：
//   · 审批闸失败即关闭：拿不到会话权限模式也要审批；审批服务缺失 / 调用出错一律拒绝执行。
//   · 会话级记忆：同一会话里同一类命令（命令名集合 + 管道/重定向等特征）批准一次后不再问；
//     危险命令（rm -r/-f、写到工作区外、shell 套 shell、内联代码、eval/source、git push/clean/reset --hard …）每次都问。
//   · 子进程环境脱敏 childEnv()：名字含 KEY/PASSWORD/PASSWD/SECRET/TOKEN/CREDENTIAL 的变量与所有 DSH_* 不传给子进程。
//   · 大输出内存有界：只留头尾（UTF-8 字符边界），超出部分流式写到 mkdtemp 目录下的 0600 文件（进程内总量 ≤ 64 MB），
//     结果里给出路径；启动时清理 24 小时前的残留目录。
//   · 超时：exe 的 --timeout 杀整棵进程树并在 stderr 打标记；插件再加 5 秒硬杀。靠标记区分「真超时」与「脚本自己 exit 124」。
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-flash-sh";
export const inject = ["tools"];

export const TOOL_NAME = "flash_sh";
const TAG = "[flash-sh]";
const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BIN = path.join(here, "..", "vendor", "win32-x64", "flash-sh.exe");

export const DEFAULTS = Object.freeze({
  enabled: false,
  timeoutMs: 120000,
  maxTimeoutMs: 600000,
  maxOutputBytes: 30000,
  allowNonWindows: false,
  approval: "sandboxed",
  approvalMemory: "session",
});
const APPROVAL_MODES = ["read-only", "sandboxed", "off"];
const MEMORY_MODES = ["session", "off"];

/** 审批框里命令预览的上限（字符）。 */
export const PREVIEW_MAX_CHARS = 2000;
/** 进程内所有 spill 文件的总量上限。 */
export const SPILL_TOTAL_CAP = 64 * 1024 * 1024;
/** 启动时清理多久以前的 spill 目录。 */
export const SPILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SPILL_PREFIX = "dsh-flash-sh-spill-";
/** exe 在 --timeout 到点时写到 stderr 的标记（native/flash-sh/src/proc.rs start_timeout）。 */
export const TIMEOUT_MARK = /flash-sh: timed out after [0-9.]+s, process tree killed/;
/** 插件在 exe 自带超时之上的硬杀宽限。 */
export const GUARD_GRACE_MS = 5000;

// ── Config：schemastery（DSH 自己用的 schema 库）优先，退回手写 Standard Schema ─────────────────
function buildSchemasteryConfig(Schema) {
  return Schema.object({
    enabled: Schema.boolean().default(DEFAULTS.enabled).description("总开关；也可用环境变量 DSH_FLASH_SH=1 / 0 覆盖"),
    binPath: Schema.string().description("自定义 flash-sh 可执行文件路径（默认用本包 vendor/win32-x64/flash-sh.exe；空字符串 = 未设置）"),
    timeoutMs: Schema.natural().min(1).default(DEFAULTS.timeoutMs).description("单次调用默认超时（毫秒）"),
    maxTimeoutMs: Schema.natural().min(1).default(DEFAULTS.maxTimeoutMs).description("模型可请求的最大超时（毫秒）"),
    maxOutputBytes: Schema.natural().min(1).default(DEFAULTS.maxOutputBytes).description("stdout / stderr 各自回传给模型的最大字节数（保留头尾）"),
    allowNonWindows: Schema.boolean().default(DEFAULTS.allowNonWindows).description("仅供开发验证：允许在非 Windows x64 上注册（需同时给 binPath）"),
    approval: Schema.union(APPROVAL_MODES).default(DEFAULTS.approval).description("何时请求用户审批：sandboxed=会话不是完全访问时（默认）；read-only=仅会话为只读时；off=从不（风险见 README）"),
    approvalMemory: Schema.union(MEMORY_MODES).default(DEFAULTS.approvalMemory).description("session=同一会话里同类命令批准一次后不再问（危险命令除外）；off=每次都问"),
  });
}

const FIELD_TYPES = {
  enabled: "boolean",
  binPath: "string",
  timeoutMs: "count",
  maxTimeoutMs: "count",
  maxOutputBytes: "count",
  allowNonWindows: "boolean",
  approval: "approval",
  approvalMemory: "memory",
};

/** 不依赖任何库的 Standard Schema（v1）实现：cordis 只调用 Config["~standard"].validate。 */
export function validateConfig(input) {
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) return { issues: [{ message: "config must be an object", path: [] }] };
  const issues = [];
  const value = { ...input };
  for (const [key, kind] of Object.entries(FIELD_TYPES)) {
    const v = input[key];
    // binPath 的空字符串 = 未设置（与 schemastery 版 + resolveConfig 的处理一致）
    if (v === undefined || v === null || (kind === "string" && typeof v === "string" && v.trim() === "")) {
      if (key in DEFAULTS) value[key] = DEFAULTS[key];
      else delete value[key];
      continue;
    }
    let ok;
    if (kind === "boolean") ok = typeof v === "boolean";
    else if (kind === "string") ok = typeof v === "string";
    else if (kind === "count") ok = typeof v === "number" && Number.isInteger(v) && v >= 1;
    else if (kind === "approval") ok = APPROVAL_MODES.includes(v);
    else ok = MEMORY_MODES.includes(v);
    if (!ok) {
      const expect = kind === "count" ? "a positive integer"
        : kind === "approval" ? "one of " + APPROVAL_MODES.join(" / ")
        : kind === "memory" ? "one of " + MEMORY_MODES.join(" / ")
        : "a " + kind;
      issues.push({ message: "$." + key + " expected " + expect + " but got " + JSON.stringify(v), path: [key] });
    }
  }
  return issues.length > 0 ? { issues } : { value };
}

export const FallbackConfig = Object.freeze({
  "~standard": Object.freeze({ version: 1, vendor: "dsh-flash-sh", validate: validateConfig }),
});

let schemaSource = "fallback";
let ConfigSchema = FallbackConfig;
if (process.env.DSH_FLASH_SH_NO_SCHEMASTERY !== "1") {
  try {
    const mod = await import("@deepseek-ai/schemastery");
    const Schema = mod.default ?? mod;
    if (typeof Schema.object === "function") {
      ConfigSchema = buildSchemasteryConfig(Schema);
      schemaSource = "schemastery";
    }
  } catch (error) {
    // DSH 没把 schemastery 解析给本包（pnpm 严格布局下未提供可选 peer / 作为 presets 的可选依赖装在别处）：用手写 schema，行为一致
  }
}
export const Config = ConfigSchema;
export const CONFIG_SCHEMA_SOURCE = schemaSource;

// ── 日志 ────────────────────────────────────────────────────────────────────────────────────
function makeLog(ctx, prefix = "") {
  let logger;
  try {
    const l = ctx && typeof ctx.get === "function" ? ctx.logger : undefined;
    if (l && typeof l.info === "function" && typeof l.warn === "function") logger = l;
  } catch (error) {}
  return (level, message) => {
    const line = TAG + " " + prefix + message;
    try {
      if (logger) logger[level]("%s", line);
      else (console[level] ?? console.info)(line);
    } catch (error) {
      try { console.info(line); } catch (e) {}
    }
  };
}

// ── 开关与平台判定 ──────────────────────────────────────────────────────────────────────────
const blank = (v) => typeof v !== "string" || v.trim() === "";

export function resolveConfig(config, env = process.env) {
  const merged = { ...DEFAULTS };
  if (config !== null && typeof config === "object") {
    for (const [k, v] of Object.entries(config)) if (v !== undefined && v !== null) merged[k] = v;
  }
  if (blank(merged.binPath)) delete merged.binPath;
  merged.binSource = merged.binPath === undefined ? "bundled" : "config";
  if (env.DSH_FLASH_SH === "1") merged.enabled = true;
  if (env.DSH_FLASH_SH === "0") merged.enabled = false;
  if (env.DSH_FLASH_SH_ANY_PLATFORM === "1") merged.allowNonWindows = true;
  if (!blank(env.DSH_FLASH_SH_BIN)) {
    merged.binPath = env.DSH_FLASH_SH_BIN;
    merged.binSource = "env";
  }
  if (!APPROVAL_MODES.includes(merged.approval)) merged.approval = DEFAULTS.approval;
  if (!MEMORY_MODES.includes(merged.approvalMemory)) merged.approvalMemory = DEFAULTS.approvalMemory;
  return merged;
}

/** 是否应注册；不注册时给出原因（写日志用） */
export function decide(cfg, platform = process.platform, arch = process.arch) {
  if (cfg.enabled !== true) return { register: false, reason: "disabled (config.enabled=false; set it to true or DSH_FLASH_SH=1)" };
  const winx64 = platform === "win32" && arch === "x64";
  if (!winx64 && cfg.allowNonWindows !== true) return { register: false, reason: "only active on Windows x64 (this is " + platform + "-" + arch + ")" };
  if (!winx64 && blank(cfg.binPath)) return { register: false, reason: "non-Windows test mode needs binPath" };
  const bin = blank(cfg.binPath) ? DEFAULT_BIN : cfg.binPath;
  let ok = false;
  try {
    ok = fs.statSync(bin).isFile();
  } catch (error) {}
  if (!ok) return { register: false, reason: "binary not found: " + bin };
  return { register: true, bin, custom: path.resolve(bin) !== path.resolve(DEFAULT_BIN) };
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// ── 子进程环境脱敏 ───────────────────────────────────────────────────────────────────────────
const SECRET_NAME = /KEY|PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL/i;

/** 传给 flash-sh 的环境：去掉疑似凭据（名字含 KEY/PASSWORD/PASSWD/SECRET/TOKEN/CREDENTIAL，不分大小写）与全部 DSH_*。 */
export function childEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (/^DSH_/i.test(k) || SECRET_NAME.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// ── 审批框预览 ─────────────────────────────────────────────────────────────────────────────
/** 2000 字以内原样；超出截断并写明还剩多少字没显示（按 Unicode 码点计，不切断代理对）。 */
export function commandPreview(command, max = PREVIEW_MAX_CHARS) {
  const chars = Array.from(String(command));
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("") + "\n…[" + (chars.length - max) + " more characters not shown; " + chars.length + " in total]";
}

// ── 命令分类：会话级审批记忆的规则键 ＋ 危险判定 ─────────────────────────────────────────────
const OPERATORS = ["&&", "||", ";;", "|&", "|", ";", "&", "(", ")", "\n"];
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "flash-sh", "flash-sh.exe", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "wsl", "wsl.exe", "busybox"]);
const WRAPPERS = new Set(["sudo", "doas", "runas", "env", "nohup", "xargs", "timeout", "command", "builtin", "exec", "nice", "time", "stdbuf", "watch", "start", "parallel"]);
const EVALS = new Set(["eval", "source", ".", "trap", "alias"]);
const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}", "[[", "]]"]);
const INTERPRETERS = new Set(["node", "node.exe", "python", "python3", "python.exe", "py", "ruby", "perl", "php", "deno", "bun", "lua", "Rscript"]);
const INLINE_CODE_FLAGS = new Set(["-c", "-e", "--eval", "-p", "--print", "-r", "-command", "-Command", "-EncodedCommand", "/c", "/C", "/k", "/K"]);
const WRITE_ALL_ARGS = new Set(["touch", "mkdir", "rm", "rmdir", "tee", "truncate", "chmod", "chown", "chgrp", "unlink", "shred", "del", "rd"]);
const WRITE_LAST_ARG = new Set(["cp", "mv", "ln", "install", "rsync", "scp"]);
const ALWAYS_DANGEROUS = new Set(["dd", "mkfs", "format", "diskpart", "reg", "regedit", "shutdown", "reboot", "halt", "poweroff", "kill", "killall", "pkill", "taskkill", "setx", "schtasks", "sc", "net", "netsh", "icacls", "takeown", "bcdedit", "chsh", "crontab", "systemctl", "launchctl", "curl", "wget", "ssh", "scp", "rsync", "nc", "ncat", "telnet", "ftp"]);

/** 把命令切成词与运算符（理解引号与反斜杠；只为分类，不做展开）。 */
function lex(command) {
  const tokens = [];
  const flags = { substitution: false, heredoc: false, unbalanced: false, background: false };
  let i = 0;
  const s = command;
  let word = null; // { text, quoted, dollar }
  const flush = () => { if (word !== null) { tokens.push({ type: "word", ...word }); word = null; } };
  const ensure = () => { if (word === null) word = { text: "", quoted: false, dollar: false }; return word; };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] === "\n") { i += 2; continue; }
      ensure().text += s[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) { flags.unbalanced = true; ensure().text += s.slice(i + 1); i = s.length; continue; }
      const w = ensure(); w.text += s.slice(i + 1, end); w.quoted = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      const w = ensure(); w.quoted = true;
      i += 1;
      let closed = false;
      while (i < s.length) {
        const d = s[i];
        if (d === "\\" && i + 1 < s.length) { w.text += s[i + 1]; i += 2; continue; }
        if (d === '"') { closed = true; i += 1; break; }
        if (d === "`" || (d === "$" && s[i + 1] === "(")) flags.substitution = true;
        if (d === "$") w.dollar = true;
        w.text += d;
        i += 1;
      }
      if (!closed) flags.unbalanced = true;
      continue;
    }
    if (c === "`") { flags.substitution = true; ensure().text += c; i += 1; continue; }
    if (c === "$") {
      if (s[i + 1] === "(" ) flags.substitution = true;
      const w = ensure(); w.dollar = true; w.text += c; i += 1;
      continue;
    }
    if (c === "#" && word === null) {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") { flush(); i += 1; continue; }
    // 进程替换 <(…) >(…)
    if ((c === "<" || c === ">") && s[i + 1] === "(") { flags.substitution = true; flush(); tokens.push({ type: "op", text: c + "(" }); i += 2; continue; }
    // 重定向：[n]> [n]>> &> &>> >| < << <<< <& >&（紧贴在词后面的 > 也算：echo hi>out）
    const digitsWord = word !== null && /^\d+$/.test(word.text) && !word.quoted;
    const redir = word === null
      ? /^(\d*|&)(>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/.exec(s.slice(i))
      : /^()(>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/.exec(s.slice(i));
    if (redir) {
      let fd = redir[1];
      if (digitsWord) { fd = word.text; word = null; } else flush();
      tokens.push({ type: "redir", op: redir[2], fd });
      if (redir[2].startsWith("<<") && redir[2] !== "<<<") flags.heredoc = true;
      i += redir[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => s.startsWith(o, i));
    if (op) {
      flush();
      tokens.push({ type: "op", text: op });
      if (op === "&") flags.background = true;
      i += op.length;
      continue;
    }
    ensure().text += c;
    i += 1;
  }
  flush();
  return { tokens, flags };
}

const isMsysDrive = (p) => /^\/[a-zA-Z](\/|$)/.test(p);

/** 写目标是否落在工作区外（或无法判定）。/dev/null 等与临时目录（/tmp、os.tmpdir()）不算外部。 */
export function isOutsideWorkspace(target, { cwd, workspace, platform = process.platform, tmpdir = os.tmpdir() } = {}) {
  if (typeof target !== "string" || target === "") return true;
  if (/^\/dev\/(null|stdout|stderr|tty)$/.test(target) || /^nul$/i.test(target)) return false;
  if (/[$`]/.test(target) || target.startsWith("~")) return true; // 展开后才知道 → 按外部算
  if (workspace === undefined || cwd === undefined) return true;
  const P = platform === "win32" ? path.win32 : path.posix;
  let t = target;
  if (platform === "win32" && isMsysDrive(t)) t = t[1] + ":" + (t.slice(2) || "\\");
  if (t === "/tmp" || t.startsWith("/tmp/")) return false;
  const abs = P.resolve(cwd, t.replace(/[*?[].*$/, "") || ".");
  const inside = (root) => {
    const rel = P.relative(P.resolve(root), abs);
    return rel === "" || (!rel.startsWith("..") && !P.isAbsolute(rel));
  };
  if (inside(tmpdir)) return false;
  return !inside(workspace);
}

/**
 * 给一条命令归类：
 *   key        会话级记忆的规则键：命令名集合（排序去重）＋特征（| 管道，> 写文件，& 后台）
 *   cacheable  可否「批准一次、本会话不再问」
 *   reasons    不可记忆的原因（危险 / 无法可靠分析）
 */
export function classifyCommand(command, ctx = {}) {
  const reasons = [];
  const { tokens, flags } = lex(String(command));
  if (flags.substitution) reasons.push("command substitution $(...) / `...` / <(...)");
  if (flags.heredoc) reasons.push("here-document");
  if (flags.unbalanced) reasons.push("unbalanced quotes");
  const heads = new Set();
  const features = new Set();
  if (flags.background) features.add("&");
  // 切段
  const segments = [];
  let cur = [];
  for (const t of tokens) {
    if (t.type === "op") {
      if (t.text === "|" || t.text === "|&") features.add("|");
      if (t.text === "(" || t.text === ")" || t.text === ";;") { if (t.text === ";;") reasons.push("case statement"); }
      segments.push(cur);
      cur = [];
    } else cur.push(t);
  }
  segments.push(cur);
  const writeTargets = [];
  let funcDef = /(^|[\s;&|({])function\s+[A-Za-z_]/.test(command) || /(^|[\s;&|({])[A-Za-z_][\w.:-]*\s*\(\s*\)/.test(command);
  for (const seg of segments) {
    // 先收重定向目标
    const words = [];
    for (let k = 0; k < seg.length; k++) {
      const t = seg[k];
      if (t.type === "redir") {
        const target = seg[k + 1];
        if (target && target.type === "word") k += 1;
        if (t.op === ">&" || t.op === "<&") { if (target && !/^\d+$|^-$/.test(target.text)) writeTargets.push(target.text); continue; }
        if (t.op.startsWith(">") || t.op === "<>") {
          if (target) {
            if (!/^\/dev\/null$|^nul$/i.test(target.text)) features.add(">");
            writeTargets.push(target.dollar ? "$" + target.text : target.text);
          }
        }
        continue;
      }
      words.push(t);
    }
    let w = 0;
    while (w < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[w].text) && !words[w].quoted) w += 1; // 前置赋值
    while (w < words.length && KEYWORDS.has(words[w].text) && !words[w].quoted) w += 1;
    if (w >= words.length) continue;
    const head0 = words[w].text;
    if (head0 === "for" || head0 === "select") continue; // for x in …：后面的词不是命令
    if (head0 === "case") { reasons.push("case statement"); continue; }
    if (head0 === "function" || (words[w + 1] && words[w + 1].text === "()") || /\(\)$/.test(head0)) { funcDef = true; continue; }
    const head = head0; // 原样作为键（带路径的写法与裸命令名是不同的键）
    const base = path.posix.basename(head.replace(/\\/g, "/"));
    const lc = base.toLowerCase();
    heads.add(head);
    const args = words.slice(w + 1).map((x) => x.text);
    const argsRaw = words.slice(w + 1);
    if (words[w].dollar) reasons.push("command name comes from a variable");
    if (SHELLS.has(lc)) reasons.push("runs another shell (" + base + ")");
    if (WRAPPERS.has(lc)) reasons.push("wrapper command (" + base + ") runs an arbitrary command");
    if (EVALS.has(lc)) reasons.push(base + " executes dynamic code");
    if (ALWAYS_DANGEROUS.has(lc)) reasons.push(base + " is always confirmed");
    if (INTERPRETERS.has(lc) && args.some((a) => INLINE_CODE_FLAGS.has(a))) reasons.push(base + " with inline code");
    if (lc === "rm" || lc === "del" || lc === "rd" || lc === "rmdir") {
      if (args.some((a) => /^-[a-zA-Z]*[rRf]/.test(a) || a === "--recursive" || a === "--force" || /^\/[sSqQ]$/.test(a))) reasons.push("recursive/forced delete (" + base + " " + args.filter((a) => a.startsWith("-") || a.startsWith("/")).join(" ") + ")");
    }
    if (lc === "find" && args.some((a) => a === "-delete" || a === "-exec" || a === "-execdir" || a === "-ok")) reasons.push("find -delete/-exec");
    if (lc === "git") {
      const sub = args.find((a) => !a.startsWith("-"));
      if (sub === "push" || sub === "clean" || (sub === "reset" && args.includes("--hard")) || (sub === "checkout" && args.includes("--")) || (sub === "branch" && args.some((a) => /^-[dD]$/.test(a)))) reasons.push("git " + sub + " (destructive or remote)");
    }
    if (lc === "chmod" && args.some((a) => /^-[a-zA-Z]*R/.test(a))) reasons.push("recursive chmod");
    // 写文件参数
    const plain = argsRaw.filter((a) => !(a.text.startsWith("-") && !a.quoted));
    const pathOf = (a) => (a.dollar ? "$" : "") + a.text;
    if (WRITE_ALL_ARGS.has(lc)) {
      for (const a of plain) writeTargets.push(pathOf(a));
      if (plain.length > 0) features.add(">");
    } else if (WRITE_LAST_ARG.has(lc)) {
      const tIdx = args.findIndex((a) => a === "-t" || a === "--target-directory");
      if (tIdx >= 0 && args[tIdx + 1] !== undefined) writeTargets.push(args[tIdx + 1]);
      else if (plain.length > 0) writeTargets.push(pathOf(plain[plain.length - 1]));
      if (plain.length > 0) features.add(">");
    } else if (lc === "sed" && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) {
      const hasScriptFlag = args.some((a) => a === "-e" || a === "-f" || a.startsWith("--expression") || a.startsWith("--file"));
      const files = hasScriptFlag ? plain : plain.slice(1);
      for (const a of files) writeTargets.push(pathOf(a));
      features.add(">");
    } else if (lc === "dd") {
      for (const a of args) if (a.startsWith("of=")) writeTargets.push(a.slice(3));
    }
  }
  if (funcDef) reasons.push("defines a function");
  const outside = writeTargets.filter((t) => isOutsideWorkspace(t, ctx));
  if (outside.length > 0) reasons.push("writes outside the workspace (" + outside.slice(0, 3).join(", ") + (outside.length > 3 ? ", …" : "") + ")");
  if (ctx.cwd !== undefined && ctx.workspace !== undefined && isOutsideWorkspace(ctx.cwd, { ...ctx, cwd: ctx.workspace })) reasons.push("working directory is outside the workspace");
  if (heads.size === 0 && reasons.length === 0) reasons.push("no command recognised");
  const key = [...heads].sort().join("+") + (features.size ? " [" + [...features].sort().join("") + "]" : "");
  return { key, heads: [...heads].sort(), features: [...features].sort(), cacheable: reasons.length === 0, reasons };
}

// ── 会话级审批记忆 ─────────────────────────────────────────────────────────────────────────
const MAX_SESSIONS = 256;
const MAX_RULES_PER_SESSION = 128;

export class SessionApprovals {
  constructor() {
    this.byObject = new WeakMap();
    this.byId = new Map();
  }
  rulesOf(session, create) {
    if (session === null || typeof session !== "object") return undefined;
    const id = typeof session.id === "string" ? session.id : (session.header && typeof session.header.id === "string" ? session.header.id : undefined);
    if (id !== undefined) {
      let set = this.byId.get(id);
      if (!set && create) {
        if (this.byId.size >= MAX_SESSIONS) this.byId.delete(this.byId.keys().next().value);
        set = new Set();
        this.byId.set(id, set);
      }
      return set;
    }
    let set = this.byObject.get(session);
    if (!set && create) { set = new Set(); this.byObject.set(session, set); }
    return set;
  }
  has(session, key) {
    const set = this.rulesOf(session, false);
    return set !== undefined && set.has(key);
  }
  add(session, key) {
    const set = this.rulesOf(session, true);
    if (set === undefined) return false;
    if (set.size >= MAX_RULES_PER_SESSION) set.delete(set.values().next().value);
    set.add(key);
    return true;
  }
}

// ── 工具定义 ────────────────────────────────────────────────────────────────────────────────
export const DESCRIPTION = [
  "Run a Bash-syntax command or script on Windows (flash-sh, a built-in Bash-compatible shell; no Git Bash/WSL needed).",
  "Supports: quotes/escapes, $var ${var:-x} ${#v} ${v%x} ${v//a/b} ${v:1:2}, $(...) `...` $((...)), globs, {a,b} {1..5},",
  "| && || ; &, redirects > >> < 2> 2>&1 &> <<EOF <<'EOF' <<<, <(cmd), if/elif/else, for/while/until/case, functions, local,",
  "arrays (indexed/assoc), [[ ]] incl =~, test/[ ], read, printf, set -euo pipefail, trap EXIT, source.",
  "Built-in commands: ls cat head tail wc sort uniq cut tr grep(-E -F -r -n -o -i -v -l -c -A/-B) sed awk(POSIX + common gawk; no gensub/strftime/asort) diff(normal/-u/-q/-r; no -c/-y)",
  "find(-name -type -exec) xargs mkdir rm cp mv touch basename dirname seq tee env date sleep realpath mktemp tac paste comm nl du base64 md5sum.",
  "Not available: interactive job control (fg/bg). Windows programs (git, node, python, npm...) run from PATH.",
  "Paths: use / ; C:\\x and /c/x both work; ~ is the user profile; /tmp is the temp dir; pwd prints /c/... style.",
  "Each call is a fresh non-interactive shell (no stdin) in the session workspace; exit code, stdout and stderr are returned.",
].join(" ");

export const OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["exitCode", "stdout", "stderr", "timedOut", "truncated"],
  properties: {
    exitCode: { type: "integer" },
    stdout: { type: "string" },
    stderr: { type: "string" },
    timedOut: { type: "boolean" },
    truncated: { type: "boolean" },
    spillPath: { type: "string" },
    stderrSpillPath: { type: "string" },
    error: { type: "string" },
  },
});

export function renderResult(v) {
  let body = v.stdout ?? "";
  if (v.stderr) {
    if (body.length > 0 && !body.endsWith("\n")) body += "\n";
    body += "[stderr]\n" + v.stderr;
  }
  if (body.length === 0) body = "(no output)";
  const marks = [];
  if (v.truncated) {
    const files = [v.spillPath, v.stderrSpillPath].filter(Boolean);
    marks.push("[output truncated (head and tail kept); full output: " + (files.length ? files.join(" , ") : "(unavailable)") + "]");
  }
  if (v.error) marks.push("[error: " + v.error + "]");
  if (v.timedOut) marks.push("[timed out; process tree killed]");
  if (v.exitCode !== 0) marks.push("[exit code: " + v.exitCode + "]");
  return [body, ...marks].join("\n");
}

function serviceOf(ctx, exec, svc) {
  // 先看调用方 agent 的作用域（预设可能把服务挂在 agent 平面），再看本插件所在的 profile 根
  const candidates = [exec && exec.agent && exec.agent.ctx, ctx];
  for (const c of candidates) {
    try {
      const s = c && typeof c.get === "function" ? c.get(svc) : undefined;
      if (s !== undefined && s !== null) return s;
    } catch (error) {}
  }
  return undefined;
}

function cwdOf(agent) {
  const s = agent && agent.session;
  const c = (s && (s.cwd || s.workspace || (s.header && s.header.cwd))) || (agent && agent.cwd);
  return typeof c === "string" && c.length > 0 ? c : undefined;
}

async function resolveCwd(ctx, exec) {
  if (exec && exec.agent !== undefined) {
    const service = serviceOf(ctx, exec, "workingDirectory");
    if (service !== undefined && typeof service.ensure === "function") {
      try {
        const dir = await service.ensure(exec.agent, exec.signal);
        if (typeof dir === "string" && dir.length > 0) return dir;
      } catch (error) {}
    }
  }
  return cwdOf(exec && exec.agent);
}

/** 会话当前的沙箱模式（read-only / workspace-write / danger-full-access）；拿不到时 undefined。 */
function sandboxModeOf(ctx, exec) {
  if (!exec || exec.agent === undefined) return undefined;
  const policy = serviceOf(ctx, exec, "sandboxPolicy");
  if (policy === undefined || typeof policy.resolve !== "function") return undefined;
  try {
    const r = policy.resolve({ session: exec.agent.session });
    return r && typeof r.mode === "string" ? r.mode : undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * 这次调用要不要审批。失败即关闭：approval 不是 off 时，拿不到会话模式（undefined）一律要审批。
 *   sandboxed（默认）：会话不是 danger-full-access 就审批；read-only：只在只读会话审批；off：从不。
 */
export function needsApproval(approval, mode) {
  if (approval === "off") return false;
  if (mode === undefined || mode === null || mode === "") return true;
  if (approval === "read-only") return mode === "read-only";
  return mode !== "danger-full-access";
}

function errorText(error) {
  return String((error && error.message) || error).split("\n")[0];
}

/** 审批闸：返回时表示可以执行；任何异常路径都抛错（＝不执行）。 */
export async function gate(ctx, cfg, exec, command, where, memory, log) {
  const mode = sandboxModeOf(ctx, exec);
  if (!needsApproval(cfg.approval, mode)) return { asked: false, mode };
  const modeText = mode === undefined ? "unknown (could not read the session permission mode)" : mode;
  const cls = classifyCommand(command, where);
  const session = exec && exec.agent ? exec.agent.session : undefined;
  const remember = cfg.approvalMemory === "session" && cls.cacheable && session !== undefined;
  if (remember && memory.has(session, cls.key)) return { asked: false, mode, remembered: cls.key };
  const approval = serviceOf(ctx, exec, "approval");
  if (approval === undefined || typeof approval.request !== "function" || !exec || exec.agent === undefined) {
    throw new Error("flash_sh: not run — this call needs user approval (session mode: " + modeText + "; flash_sh is not sandboxed) but no approval channel is available");
  }
  const scopeNote = remember
    ? "Approving also allows commands of the same kind (" + cls.key + ") for the rest of this session."
    : "This command will be confirmed every time" + (cls.reasons.length ? ": " + cls.reasons.join("; ") : "") + ".";
  let outcome;
  try {
    outcome = await approval.request({
      agent: exec.agent,
      toolName: TOOL_NAME,
      ...(exec.callId !== undefined ? { callId: exec.callId } : {}),
      reason: "flash_sh runs outside the DSH sandbox (session mode: " + modeText + "). " + scopeNote + "\nCommand:\n" + commandPreview(command),
      ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
    });
  } catch (error) {
    throw new Error("flash_sh: not run — the approval request failed (" + errorText(error) + "); flash_sh refuses to run without an explicit approval");
  }
  if (outcome !== "allowed-once") {
    throw new Error("flash_sh: not run — approval " + String(outcome) + " (session mode: " + modeText + "; flash_sh is not sandboxed)");
  }
  if (remember && memory.add(session, cls.key) && log) log("info", "session approval remembered for: " + cls.key);
  return { asked: true, mode, remembered: remember ? cls.key : undefined };
}

// ── 输出捕获：头尾有界 ＋ 磁盘溢出 ────────────────────────────────────────────────────────────
const spillState = { dir: undefined, dirError: undefined, used: 0, seq: 0 };

/** 测试用：重置 spill 状态（目录 / 总量计数）。 */
export function _resetSpill(opts = {}) {
  spillState.dir = opts.dir;
  spillState.dirError = undefined;
  spillState.used = opts.used ?? 0;
}
export function spillUsage() {
  return { dir: spillState.dir, used: spillState.used, cap: SPILL_TOTAL_CAP };
}

function spillDir() {
  if (spillState.dir !== undefined) return spillState.dir;
  if (spillState.dirError !== undefined) throw spillState.dirError;
  try {
    spillState.dir = fs.mkdtempSync(path.join(os.tmpdir(), SPILL_PREFIX));
    try { fs.chmodSync(spillState.dir, 0o700); } catch (error) {}
    return spillState.dir;
  } catch (error) {
    spillState.dirError = error;
    throw error;
  }
}

/** 删掉 root 下名字以 SPILL_PREFIX 开头、修改时间早于 maxAgeMs 的目录；返回删掉的路径。 */
export function cleanupStaleSpills(root = os.tmpdir(), maxAgeMs = SPILL_MAX_AGE_MS, now = Date.now()) {
  const removed = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { return removed; }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(SPILL_PREFIX)) continue;
    const p = path.join(root, e.name);
    if (p === spillState.dir) continue;
    try {
      const st = fs.statSync(p);
      if (now - st.mtimeMs > maxAgeMs) {
        fs.rmSync(p, { recursive: true, force: true });
        removed.push(p);
      }
    } catch (error) {}
  }
  return removed;
}

/** 从 buf 的 end 往回退到 UTF-8 字符边界（不把多字节字符切开）。 */
export function utf8HeadEnd(buf, end) {
  if (end >= buf.length) return buf.length;
  let i = end;
  while (i > 0 && (buf[i] & 0xc0) === 0x80) i -= 1; // buf[i] 是续字节 → 字符从更前面开始
  return i;
}
/** 从 start 往后跳到下一个字符开头。 */
export function utf8TailStart(buf, start) {
  let i = Math.max(0, start);
  while (i < buf.length && (buf[i] & 0xc0) === 0x80) i += 1;
  return i;
}

export class Capture {
  constructor(limit, label) {
    this.limit = Math.max(2, limit);
    this.label = label;
    this.pre = [];        // 头 limit 个字节（未超限时就是全部）
    this.preSize = 0;
    this.tail = [];       // 最近的字节（环形，≤ limit/2 ＋ 一个块）
    this.tailSize = 0;
    this.total = 0;
    this.fd = undefined;
    this.file = undefined;
    this.spillError = undefined;
    this.spillCapped = false;
    this.lastBytes = Buffer.alloc(0); // 最后 512 字节，用来找超时标记
  }
  get truncated() { return this.total > this.limit; }
  openSpill() {
    try {
      const dir = spillDir();
      spillState.seq += 1;
      this.file = path.join(dir, process.pid + "-" + Date.now() + "-" + spillState.seq + "-" + crypto.randomBytes(3).toString("hex") + "." + this.label + ".log");
      this.fd = fs.openSync(this.file, "wx", 0o600);
      const head = Buffer.concat(this.pre);
      this.write(head);
    } catch (error) {
      this.spillError = errorText(error);
      this.fd = undefined;
      this.file = undefined;
    }
  }
  write(buf) {
    if (this.fd === undefined || buf.length === 0) return;
    const room = SPILL_TOTAL_CAP - spillState.used;
    if (room <= 0) { this.capSpill(); return; }
    const part = buf.length > room ? buf.subarray(0, room) : buf;
    try {
      fs.writeSync(this.fd, part);
      spillState.used += part.length;
    } catch (error) {
      this.spillError = errorText(error);
      this.closeSpill();
      return;
    }
    if (part.length < buf.length) this.capSpill();
  }
  capSpill() {
    if (this.fd === undefined) return;
    try { fs.writeSync(this.fd, Buffer.from("\n[flash-sh: spill stopped at the " + (SPILL_TOTAL_CAP >> 20) + " MB cap]\n")); } catch (error) {}
    this.spillCapped = true;
    this.closeSpill();
  }
  closeSpill() {
    if (this.fd === undefined) return;
    try { fs.closeSync(this.fd); } catch (error) {}
    this.fd = undefined;
  }
  push(buf) {
    const before = this.total;
    this.total += buf.length;
    // 最后 512 字节
    this.lastBytes = Buffer.concat([this.lastBytes, buf.length > 512 ? buf.subarray(buf.length - 512) : buf]);
    if (this.lastBytes.length > 512) this.lastBytes = this.lastBytes.subarray(this.lastBytes.length - 512);
    // 头
    if (this.preSize < this.limit) {
      const take = buf.subarray(0, this.limit - this.preSize);
      this.pre.push(take);
      this.preSize += take.length;
    }
    // 尾
    this.tail.push(buf);
    this.tailSize += buf.length;
    const keep = Math.ceil(this.limit / 2);
    while (this.tail.length > 1 && this.tailSize - this.tail[0].length >= keep) this.tailSize -= this.tail.shift().length;
    // 溢出到磁盘
    if (before <= this.limit && this.total > this.limit) {
      if (this.fd === undefined && this.file === undefined && this.spillError === undefined) this.openSpill();
      // pre 已经写入；本块超出 pre 的部分补上
      const inPre = Math.max(0, this.limit - before);
      this.write(buf.subarray(inPre));
    } else if (this.total > this.limit) {
      this.write(buf);
    }
  }
  finish() { this.closeSpill(); }
  text() {
    const pre = Buffer.concat(this.pre);
    if (!this.truncated) return pre.toString("utf8");
    const headBudget = Math.floor(this.limit / 2);
    const tailBudget = this.limit - headBudget;
    const head = pre.subarray(0, utf8HeadEnd(pre, headBudget));
    const all = Buffer.concat(this.tail);
    const tailBuf = all.subarray(utf8TailStart(all, all.length - tailBudget));
    const omitted = this.total - head.length - tailBuf.length;
    return head.toString("utf8") + "\n…[" + omitted + " bytes omitted]…\n" + tailBuf.toString("utf8");
  }
  endsWithTimeoutMark() {
    return TIMEOUT_MARK.test(this.lastBytes.toString("utf8"));
  }
}

function killTree(child, how) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && typeof child.pid === "number") {
    try {
      const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      k.on("error", () => { try { child.kill(); } catch (e) {} });
      return;
    } catch (error) {}
  }
  try { child.kill(how); } catch (error) {}
}

/** 运行一次 flash-sh；与宿主无关，便于单测。 */
export function runFlashSh(bin, { command, cwd, timeoutMs, maxOutputBytes, signal, env, graceMs = GUARD_GRACE_MS }) {
  return new Promise((resolve) => {
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    let child;
    try {
      child = spawn(bin, ["--timeout", String(secs), "-c", command], {
        cwd,
        env: env ?? childEnv(process.env),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ exitCode: 127, stdout: "", stderr: "", timedOut: false, truncated: false, error: errorText(error) });
      return;
    }
    const out = new Capture(maxOutputBytes, "stdout");
    const err = new Capture(maxOutputBytes, "stderr");
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    let killedBy = null;
    // 兜底：exe 自己会在 --timeout 到点时杀树并以 124 退出；这里多给 graceMs 宽限再硬杀
    const guard = setTimeout(() => {
      killedBy = "guard";
      killTree(child, "SIGKILL");
    }, secs * 1000 + graceMs);
    const onAbort = () => {
      killedBy = "abort";
      killTree(child, "SIGTERM");
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    let spawnError;
    child.on("error", (e) => { spawnError = e; });
    child.on("close", (code, sig) => {
      clearTimeout(guard);
      if (signal) signal.removeEventListener("abort", onAbort);
      out.finish();
      err.finish();
      const exitCode = typeof code === "number" ? code : (killedBy === "abort" ? 130 : spawnError ? 127 : 124);
      const truncated = out.truncated || err.truncated;
      const result = {
        exitCode,
        stdout: out.text(),
        stderr: err.text(),
        // 真超时：插件硬杀，或 exe 以 124 退出且 stderr 末尾有它的超时标记；脚本自己 exit 124 不算
        timedOut: killedBy === "guard" || (exitCode === 124 && killedBy === null && !spawnError && err.endsWithTimeoutMark()),
        truncated,
      };
      if (truncated) {
        if (out.truncated && out.file) result.spillPath = out.file;
        if (err.truncated && err.file) {
          if (result.spillPath === undefined) result.spillPath = err.file;
          else result.stderrSpillPath = err.file;
        }
      }
      const problems = [];
      if (spawnError) problems.push(errorText(spawnError));
      else if (killedBy === "abort") problems.push("cancelled");
      else if (killedBy === "guard") problems.push("flash-sh did not stop at its own timeout; killed by the plugin after a " + graceMs + " ms grace");
      else if (sig) problems.push("terminated by " + sig);
      for (const c of [out, err]) {
        if (c.truncated && c.spillError) problems.push("could not save the full " + c.label + " (" + c.spillError + ")");
        else if (c.truncated && c.spillCapped) problems.push("full " + c.label + " saved only up to the " + (SPILL_TOTAL_CAP >> 20) + " MB spill cap");
        else if (c.truncated && !c.file) problems.push("full " + c.label + " not saved (spill cap reached)");
      }
      if (problems.length) result.error = problems.join("; ");
      resolve(result);
    });
  });
}

export function toolDefinition(ctx, cfg, bin, opts = {}) {
  const known = ["command", "workdir", "timeoutMs", "description"];
  const memory = opts.memory ?? new SessionApprovals();
  const log = opts.log;
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command or multi-line script to run." },
        workdir: { type: "string", description: "Working directory (absolute, or relative to the session workspace). Defaults to the workspace." },
        timeoutMs: { type: "number", description: "Timeout in ms (default " + cfg.timeoutMs + ", max " + cfg.maxTimeoutMs + "); the whole process tree is killed on expiry." },
        description: { type: "string", description: "Optional short human-readable description." },
      },
      required: ["command"],
      additionalProperties: false,
    },
    // 宿主侧协作式上限（dsh-tool-call-timeout-policy 读它）：比模型可请求的最大超时多 10 秒，正常情况下 exe 先到点
    timeoutMs: cfg.maxTimeoutMs + 10000,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: renderResult(value) }],
    },
    async execute(args, exec = {}) {
      const a = args !== null && typeof args === "object" ? args : {};
      const extra = Object.keys(a).filter((k) => !known.includes(k));
      if (extra.length > 0) throw new Error("flash_sh: unknown argument(s) " + extra.join(", ") + "; accepted: " + known.join(", "));
      if (typeof a.command !== "string" || a.command.trim() === "") throw new Error("flash_sh: command must be a non-empty string");
      let timeoutMs = a.timeoutMs === undefined ? cfg.timeoutMs : a.timeoutMs;
      if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("flash_sh: timeoutMs must be a positive number");
      timeoutMs = Math.min(timeoutMs, cfg.maxTimeoutMs);
      const workspace = await resolveCwd(ctx, exec);
      const base = workspace ?? process.cwd();
      let cwd = base;
      if (typeof a.workdir === "string" && a.workdir.trim() !== "") {
        cwd = path.isAbsolute(a.workdir) ? a.workdir : path.resolve(base, a.workdir);
      }
      let isDir = false;
      try { isDir = fs.statSync(cwd).isDirectory(); } catch (error) {}
      if (!isDir) throw new Error("flash_sh: workdir is not an existing directory: " + cwd);
      await gate(ctx, cfg, exec, a.command, { cwd, workspace }, memory, log);
      return runFlashSh(bin, { command: a.command, cwd, timeoutMs, maxOutputBytes: cfg.maxOutputBytes, signal: exec.signal, env: childEnv(process.env) });
    },
  };
}

function lookup(registry, toolName) {
  try {
    return typeof registry.get === "function" ? registry.get(toolName) : undefined;
  } catch (error) {
    return undefined;
  }
}

// ── 进程级协调：两种装法同时启用时只注册一个 flash_sh ─────────────────────────────────────────
export const OWNERS = Object.freeze({
  "dsh-flash-presets": { priority: 2, label: "dsh-flash-presets（flash-presets 行的 flashSh 子功能）" },
  "dsh-flash-sh": { priority: 1, label: "dsh-flash-sh（flash-sh-standalone 行）" },
});
const COORD_KEY = Symbol.for("dsh-flash-sh/coordinator@1");

export function coordinator() {
  let c = globalThis[COORD_KEY];
  if (!c || !Array.isArray(c.claims)) {
    c = { claims: [], seq: 0, ours: new WeakSet() };
    globalThis[COORD_KEY] = c;
  }
  return c;
}

/**
 * 工具注册表的身份。cordis 的 ctx.get("tools") 给每个插件上下文返回一个绑定了调用方的代理，
 * 代理对象各不相同；底层 ToolsService 的实例字段（layers）经代理读出来是同一个对象，用它判同。
 */
export function registryKey(registry) {
  try {
    const layers = registry && registry.layers;
    if (layers !== null && (typeof layers === "object" || typeof layers === "function")) return layers;
  } catch (error) {}
  return registry;
}

/** 在同一个工具注册表上的候选里选出应持有 flash_sh 的那个，并让其余的让位。 */
function elect(key) {
  const c = coordinator();
  const mine = c.claims.filter((x) => x.key === key);
  if (mine.length === 0) return;
  const winner = mine.slice().sort((a, b) => b.priority - a.priority || a.seq - b.seq)[0];
  for (const x of mine) if (x !== winner && x.active) x.deactivate(winner);
  for (const x of mine) if (x !== winner) x.yieldTo(winner);
  winner.activate();
}

/** 供测试 / doctor：当前各候选的状态。 */
export function claimsSnapshot(registry) {
  const key = registry === undefined ? undefined : registryKey(registry);
  return coordinator().claims.filter((x) => key === undefined || x.key === key).map((x) => ({ owner: x.owner, priority: x.priority, active: x.active, waiting: x.waiting }));
}

/**
 * 生成一个插件对象。owner 决定日志前缀与协调优先级：
 *   "dsh-flash-sh"（默认，独立包那一行） / "dsh-flash-presets"（presets 的 flashSh 子功能，优先）。
 */
export function createPlugin({ owner = "dsh-flash-sh" } = {}) {
  const meta = OWNERS[owner] ?? { priority: 0, label: owner };
  const prefix = owner === "dsh-flash-sh" ? "" : "(" + owner + ") ";
  function applyPlugin(ctx, config) {
    const log = makeLog(ctx, prefix);
    const cfg = resolveConfig(config);
    const d = decide(cfg);
    if (!d.register) {
      log("info", "flash_sh not registered: " + d.reason);
      return;
    }
    if (cfg.binSource === "env") log("info", "binPath taken from the environment variable DSH_FLASH_SH_BIN=" + cfg.binPath);
    if (d.custom) {
      let digest = "(unreadable)";
      try { digest = sha256File(d.bin); } catch (error) {}
      log("warn", "using a non-bundled flash-sh executable: " + d.bin + " sha256=" + digest + " — make sure you trust it");
    }
    try {
      const removed = cleanupStaleSpills();
      if (removed.length) log("info", "removed " + removed.length + " stale spill director" + (removed.length === 1 ? "y" : "ies") + " older than 24h");
    } catch (error) {}
    const registry = typeof ctx.get === "function" ? ctx.get("tools") : undefined;
    if (registry === undefined || typeof registry.register !== "function") {
      log("warn", "no tool registry; flash_sh not registered");
      return;
    }
    if (cfg.approval === "off") log("warn", "approval is off: flash_sh runs every command without asking, outside the DSH sandbox");
    const definition = toolDefinition(ctx, cfg, d.bin, { log });
    const c = coordinator();
    c.seq += 1;
    let dispose;
    let yieldedTo;
    const claim = {
      owner,
      priority: meta.priority,
      seq: c.seq,
      registry,
      key: registryKey(registry),
      active: false,
      waiting: false,
      activate() {
        if (claim.active) return;
        yieldedTo = undefined;
        const existing = lookup(registry, TOOL_NAME);
        if (existing !== undefined) {
          if (!claim.waiting) log("info", "flash_sh already registered by another plugin (not dsh-flash-sh / dsh-flash-presets); skipping, will take over if it goes away");
          claim.waiting = true;
          return;
        }
        try {
          dispose = registry.register(definition);
          c.ours.add(definition);
          claim.active = true;
          log("info", "flash_sh registered (" + d.bin + ")" + (claim.waiting ? " (took over after the other flash_sh went away)" : ""));
          claim.waiting = false;
        } catch (error) {
          claim.waiting = true;
          // 撞名（对方与本插件同时注册）或 schema 被拒：只报告，不让插件激活失败
          log("warn", "flash_sh could not be registered: " + errorText(error));
        }
      },
      deactivate(winner) {
        if (!claim.active) return;
        claim.active = false;
        try { if (typeof dispose === "function") dispose(); } catch (error) {}
        dispose = undefined;
        log("info", "flash_sh handed over to " + winner.label + "; this row stays idle");
      },
      yieldTo(winner) {
        if (yieldedTo === winner) return;
        yieldedTo = winner;
        log("info", "flash_sh is provided by " + winner.label + "; " + meta.label + " skips registering it");
      },
      label: meta.label,
    };
    c.claims.push(claim);
    const release = () => {
      const i = c.claims.indexOf(claim);
      if (i >= 0) c.claims.splice(i, 1);
      if (claim.active) {
        claim.active = false;
        try { if (typeof dispose === "function") dispose(); } catch (error) {}
      }
      // 让剩下的候选接手（宿主自己也会因为注册随 ctx 释放而发 tools/change）
      try { elect(claim.key); } catch (error) {}
    };
    let bound = false;
    try {
      if (typeof ctx.effect === "function") { ctx.effect(() => release, "flash-sh claim"); bound = true; }
    } catch (error) {}
    if (!bound) {
      try { if (typeof ctx.on === "function") ctx.on("dispose", release); } catch (error) {}
    }
    elect(claim.key);
    if (typeof ctx.on === "function") {
      // 第三方的 flash_sh 被注销后补上
      try {
        ctx.on("tools/change", () => {
          if (c.claims.includes(claim) && claim.waiting && !claim.active && lookup(registry, TOOL_NAME) === undefined) elect(claim.key);
        });
      } catch (error) {}
    }
  }
  return { name, inject, Config, apply: applyPlugin };
}

const standalone = createPlugin({ owner: "dsh-flash-sh" });
export const apply = standalone.apply;
export default standalone;
