// fl-bash：Windows x64 上可选的 Bash 兼容 shell 工具（工具名 fl_bash）。0.1.x 叫 dsh-flash-sh、工具名 flash_sh。
//
// 一份实现，两种装法：
//   · 独立组合包：本包自己的补丁行 id: fl-bash-standalone（cordis.patch.yml）；
//   · dsh-flash-presets 里单独的组件行 id: fl-bash：presets（0.3.4 起）把本文件与 exe 逐字节随包发行
//     （lib/fl-bash.js、vendor/win32-x64/，由 presets 的 scripts/sync-fl-bash.mjs 同步），由 presets 的 lib/fl-bash-row.js
//     用 createPlugin({ owner: "dsh-flash-presets" }) 挂上。
//   底层解释器仍叫 flash-sh（vendor/win32-x64/flash-sh.exe），只是实现细节。
//   两者同时启用时，经进程级协调器（globalThis[Symbol.for("dsh-flash-sh/coordinator@1")]）只注册一次：
//   presets 子功能优先（优先级 2 ＞ 独立行 1），独立行检测到后跳过并记日志；presets 那边被关掉/卸载时独立行接管。
//   别的插件（第三方）已经注册了 fl_bash 时两边都不抢，等它注销后再补上。
//
// 开关优先级：环境变量 DSH_FL_BASH=0/1（旧名 DSH_FLASH_SH 仍认）＞ config.enabled ＞ 默认 false。
// 只在 Windows x64 注册（DSH_FL_BASH_ANY_PLATFORM=1 / allowNonWindows 仅供开发验证，需配合 binPath）。
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

export const name = "fl-bash";
export const inject = ["tools"];

export const TOOL_NAME = "fl_bash";
const TAG = "[fl-bash]";
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
export const SPILL_PREFIX = "fl-bash-spill-";
/** 0.1.x（dsh-flash-sh）的 spill 目录前缀：清理时一并认。 */
export const LEGACY_SPILL_PREFIXES = Object.freeze(["dsh-flash-sh-spill-"]);
const ownSpillName = (n) => n.startsWith(SPILL_PREFIX) || LEGACY_SPILL_PREFIXES.some((p) => n.startsWith(p));
/** exe 在 --timeout 到点时写到 stderr 的标记（native/flash-sh/src/proc.rs start_timeout）。 */
export const TIMEOUT_MARK = /flash-sh: timed out after [0-9.]+s, process tree killed/;
/** 插件在 exe 自带超时之上的硬杀宽限。 */
export const GUARD_GRACE_MS = 5000;

// ── Config：schemastery（DSH 自己用的 schema 库）优先，退回手写 Standard Schema ─────────────────
function buildSchemasteryConfig(Schema) {
  return Schema.object({
    enabled: Schema.boolean().default(DEFAULTS.enabled).description("总开关；也可用环境变量 DSH_FL_BASH=1 / 0 覆盖（旧名 DSH_FLASH_SH 仍认）"),
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
  "~standard": Object.freeze({ version: 1, vendor: "fl-bash", validate: validateConfig }),
});

let schemaSource = "fallback";
let ConfigSchema = FallbackConfig;
if (process.env.DSH_FL_BASH_NO_SCHEMASTERY !== "1" && process.env.DSH_FLASH_SH_NO_SCHEMASTERY !== "1") {
  try {
    const mod = await import("@deepseek-ai/schemastery");
    const Schema = mod.default ?? mod;
    if (typeof Schema.object === "function") {
      ConfigSchema = buildSchemasteryConfig(Schema);
      schemaSource = "schemastery";
    }
  } catch (error) {
    // DSH 没把 schemastery 解析给本包（pnpm 严格布局下未提供可选 peer）：用手写 schema，行为一致
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

/** 环境变量：新名 DSH_FL_BASH* 优先，0.1.x 的旧名 DSH_FLASH_SH* 仍认。 */
export function envOf(env, suffix) {
  const v = env["DSH_FL_BASH" + suffix];
  return v !== undefined && v !== "" ? v : env["DSH_FLASH_SH" + suffix];
}

export function resolveConfig(config, env = process.env) {
  const merged = { ...DEFAULTS };
  if (config !== null && typeof config === "object") {
    for (const [k, v] of Object.entries(config)) if (v !== undefined && v !== null) merged[k] = v;
  }
  if (blank(merged.binPath)) delete merged.binPath;
  merged.binSource = merged.binPath === undefined ? "bundled" : "config";
  const flag = envOf(env, "");
  if (flag === "1") merged.enabled = true;
  if (flag === "0") merged.enabled = false;
  if (envOf(env, "_ANY_PLATFORM") === "1") merged.allowNonWindows = true;
  if (!blank(envOf(env, "_BIN"))) {
    merged.binPath = envOf(env, "_BIN");
    merged.binSource = "env";
  }
  if (!APPROVAL_MODES.includes(merged.approval)) merged.approval = DEFAULTS.approval;
  if (!MEMORY_MODES.includes(merged.approvalMemory)) merged.approvalMemory = DEFAULTS.approvalMemory;
  return merged;
}

/** 是否应注册；不注册时给出原因（写日志用） */
export function decide(cfg, platform = process.platform, arch = process.arch) {
  if (cfg.enabled !== true) return { register: false, reason: "disabled (config.enabled=false; set it to true or DSH_FL_BASH=1)" };
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
// 名字里的凭据字样（不分大小写）。_PAT / _AUTH 按「词」匹配：不误伤 *_PATH（NODE_PATH、LD_LIBRARY_PATH）与 GIT_AUTHOR_*。
const SECRET_NAME = /KEY|PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|COOKIE|JWT|(^|_)PAT($|_)|(^|_)AUTH(?!OR(_|$))/i;
// 整个前缀都不传：DSH 自己的、云 / 代码托管 / 包管理的配置（里面常夹带凭据或会改变子进程行为）
const SECRET_PREFIX = /^(DSH_|AWS_|GITHUB_|GH_|NPM_CONFIG_|YARN_NPM_|AZURE_DEVOPS_)/i;
// 值是带账号密码的 URL（postgres://u:p@h、https://u:p@proxy）
const URL_WITH_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;

/** 这个环境变量会不会被 childEnv 剥掉（doctor / 测试用）。 */
export function isSecretEnv(name, value = "") {
  return SECRET_PREFIX.test(name) || SECRET_NAME.test(name) || URL_WITH_CREDENTIALS.test(String(value));
}

/**
 * 传给 flash-sh 的环境：去掉疑似凭据——名字含 KEY/PASSWORD/PASSWD/SECRET/TOKEN/CREDENTIAL/COOKIE/JWT、
 * 以 _PAT / _AUTH 为词（GIT_AUTHOR_* 除外），前缀 DSH_/AWS_/GITHUB_/GH_/NPM_CONFIG_/YARN_NPM_/AZURE_DEVOPS_，
 * 以及值是带账号密码的 URL 的变量。
 */
export function childEnv(env = process.env) {
  const out = {};
  for (const k in env) {
    if (!Object.prototype.hasOwnProperty.call(env, k)) continue;
    const v = env[k];
    if (v === undefined) continue;
    if (isSecretEnv(k, v)) continue;
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
//
// 原则（2026-11-24 第二轮审计）：看不懂的写法一律每次都问。分类器只为「这一类是否已经批准过」服务，
// 不是沙箱：它只在「可记忆」与「每次都问」之间选，判不准时一律选后者。
// 命令名先归一化再比对名单：去掉路径（/usr/bin/rm、C:\…\cmd.exe）、盘符、结尾的点和空格、
// 扩展名（.exe/.com/.bat/.cmd/.ps1…），并转小写（Windows 上 RM.exe = rm）。规则键仍用原样的命令名，
// 所以 /usr/bin/rm、RM.exe 与 rm 是不同的类，彼此不能借用批准。
const OPERATORS = ["&&", "||", ";;", "|&", "|", ";", "&", "(", ")", "\n"];
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "fish", "csh", "tcsh", "ash", "yash", "flash-sh", "cmd", "powershell", "powershell_ise", "pwsh", "wsl", "busybox", "git-bash", "conhost", "wt"]);
const WRAPPERS = new Set(["sudo", "doas", "runas", "su", "runuser", "gosu", "env", "nohup", "xargs", "timeout", "command", "builtin", "exec", "nice", "renice", "time", "stdbuf", "watch", "start", "parallel", "coproc", "setsid", "chroot", "flock", "ionice", "taskset", "chrt", "numactl", "cpulimit", "strace", "ltrace", "gdb", "lldb", "valgrind", "script", "unbuffer", "faketime", "fakeroot", "firejail", "proot", "catchsegv", "entr", "vim", "vi", "nvim", "view", "ex", "ed", "emacs", "call", "npx", "bunx", "pnpx", "uvx", "pipx", "dotnet-script", "cmdkey", "psexec", "wmic", "forfiles", "at"]);
const EVALS = new Set(["eval", "source", ".", "trap", "alias", "enable", "hash", "fc", "bind", "complete", "compgen"]);
const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "!", "{", "}"]);
// 出现在命令位、且下一个词仍在命令位的保留字（parser.rs parse_pipeline 的 time / !，parse_command 的 { if while until，
// 以及 then / else / elif / do 之后的命令列表）
const CMDPOS_KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{", "time"]);
// flash-sh applets/awk.rs KEYWORDS：这些词之后的 / 开始正则；普通名字 / 内建函数 / 数字 / 字符串 / ) ] $ ++ -- 之后的 / 是除号
const AWK_KW = new Set(["BEGIN", "END", "function", "func", "if", "else", "while", "for", "do", "break", "continue", "next", "nextfile", "exit", "return", "delete", "in", "getline", "print", "printf"]);
const AWK_DANGER = /system\s*\(|(^|[^|])\|(?!\|)|\b(print|printf)\b[^;}]*>|@load|@include|ENVIRON\s*\[/;
// 0.1.6 的 sed 判定，作为 sedScriptDangerous 的兜底（任一命中即每次都问）
// 命令原文（含引号内）里的命令替换：变量值在算术上下文里会被 bash 当下标求值
const STORED_SUBST = /\$\(|`/;
const SED_LEGACY_DANGER = /(^|[;\n{}])\s*([0-9$,]+|\/[^/]*\/)?\s*!?\s*[ewWrR](\s|$)|\/[gpiImMe0-9]*[ewW]\s*($|[;}\s])/;
const INTERPRETER_RE = /^(python[\d.]*|pythonw[\d.]*|py|pypy[\d.]*|node|nodejs|deno|bun|ts-node|tsx|ruby[\d.]*|irb|jruby|perl[\d.]*|php[\d.]*|lua[\d.]*|luajit|tclsh[\d.]*|wish[\d.]*|rscript|r|julia|osascript|jshell|groovy|scala|kotlin|kotlinc|swift|csi|jrunscript|cscript|wscript|mshta|awk|gawk|mawk|nawk)$/;
const AWKS = new Set(["awk", "gawk", "mawk", "nawk"]);
// 改变权限 / 链接 / 系统状态 / 网络 / 进程 / 补丁：每次都问
const ALWAYS_DANGEROUS = new Set(["dd", "mkfs", "format", "diskpart", "fdisk", "parted", "mount", "umount", "reg", "regedit", "regsvr32", "rundll32", "msiexec", "certutil", "bitsadmin", "shutdown", "reboot", "halt", "poweroff", "kill", "killall", "pkill", "taskkill", "tskill", "setx", "schtasks", "sc", "net", "netsh", "icacls", "cacls", "takeown", "attrib", "bcdedit", "chsh", "crontab", "systemctl", "service", "launchctl", "curl", "wget", "ssh", "scp", "sftp", "rsync", "nc", "ncat", "netcat", "socat", "telnet", "ftp", "tftp", "chmod", "chown", "chgrp", "chattr", "setfacl", "xattr", "ln", "mklink", "junction", "patch", "mshta", "wscript", "cscript", "explorer", "invoke-expression", "iex", "useradd", "userdel", "usermod", "passwd", "visudo", "apt", "apt-get", "yum", "dnf", "pacman", "brew", "choco", "winget", "scoop", "robocopy", "xcopy"]);
const WRITE_ALL_ARGS = new Set(["touch", "mkdir", "rm", "rmdir", "tee", "truncate", "unlink", "shred", "del", "erase", "rd", "mv", "move", "ren", "rename"]);
const WRITE_LAST_ARG = new Set(["cp", "copy", "install"]);
// 按名字给变量赋值的内建命令：给下面这些变量赋值会改变之后命令的查找 / 执行方式
const ASSIGNING_BUILTINS = new Set(["export", "declare", "typeset", "local", "readonly", "read", "printf", "mapfile", "readarray", "let", "getopts", "unset"]);
const DANGER_VAR = /^(PATH|PATHEXT|COMSPEC|IFS|ENV|BASH_ENV|BASH_LOADABLES_PATH|SHELLOPTS|BASHOPTS|PS4|PROMPT_COMMAND|CDPATH|GLOBIGNORE|HOME|USERPROFILE|TMPDIR|TEMP|TMP|EDITOR|VISUAL|PAGER|MANPAGER|BROWSER|LESSOPEN|LESSCLOSE|LD_\w*|DYLD_\w*|NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|PYTHON\w*|PERL\w*|RUBY\w*|GEM_\w*|GIT_\w*|NPM_CONFIG_\w*|SSH_\w*|BASH_FUNC_\w*)$/i;

/** 把命令切成词与运算符（理解引号与反斜杠；只为分类，不做展开）。 */
function lex(command) {
  const tokens = [];
  const flags = { substitution: false, heredoc: false, unbalanced: false, background: false };
  let i = 0;
  let inCond = false;
  // 命令位：本条简单命令还没出现过普通词（只出现过 if/then/do/!/{ 这类保留字）。和 bash / flash-sh parser.rs 一样，
  // 只有命令位上的 [[ 才是条件块关键字、只有命令位上的 (( 才是算术命令；`echo [[`、`a=1 [[`、`>f [[` 里的 [[ 只是普通参数
  // （bash 实测：a=1 [[ 1 ]] 与 >/dev/null [[ 1 ]] 都是 "[[: command not found"；echo [[ && echo PWN 会执行 PWN）。
  let cmdPos = true;
  let lastWord = null; // 上一个普通词（判断 for (( … )) 用）
  const s = command;
  // text：去掉引号/转义后的字面；bare：未加引号、未转义的字符（判断 glob / 花括号 / ~ 展开用）；raw：原文
  let word = null;
  const flush = () => {
    if (word !== null) {
      const tok = { type: "word", ...word, raw: s.slice(word.start, i) };
      tokens.push(tok);
      if (!inCond && cmdPos && !tok.quoted && tok.text === "[[") { inCond = true; cmdPos = false; }
      else if (inCond && !tok.quoted && tok.text === "]]") inCond = false;
      else if (!inCond) cmdPos = cmdPos && !tok.quoted && CMDPOS_KEYWORDS.has(tok.text);
      lastWord = tok;
      word = null;
    }
  };
  const ensure = () => { if (word === null) word = { text: "", bare: "", quoted: false, dollar: false, start: i }; return word; };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] === "\n") { i += 2; continue; }
      const w = ensure();
      w.text += s[i + 1] ?? "";
      w.bare += "\u0000"; // 占位：转义过的字符不参与展开
      i += 2;
      continue;
    }
    if (c === "$" && s[i + 1] === "'") {
      // ANSI-C 引号 $'...'：支持 \' \\ 等转义，防止 $'\'' 与 bash 词法脱同步
      const w = ensure();
      w.quoted = true;
      w.dollar = true;
      w.bare += "\u0000";
      i += 2;
      let closed = false;
      while (i < s.length) {
        const d = s[i];
        if (d === "\\" && i + 1 < s.length) { w.text += "\\" + s[i + 1]; i += 2; continue; }
        if (d === "'") { closed = true; i += 1; break; }
        w.text += d;
        i += 1;
      }
      if (!closed) flags.unbalanced = true;
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      const w = ensure();
      w.quoted = true;
      if (end < 0) { flags.unbalanced = true; w.text += s.slice(i + 1); i = s.length; continue; }
      w.text += s.slice(i + 1, end);
      w.bare += "\u0000";
      i = end + 1;
      continue;
    }
    if (c === '"') {
      const w = ensure(); w.quoted = true; w.bare += "\u0000";
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
    if (c === "`") { flags.substitution = true; const w = ensure(); w.text += c; w.bare += c; i += 1; continue; }
    if (c === "$") {
      if (s[i + 1] === "(") flags.substitution = true;
      const w = ensure(); w.dollar = true; w.text += c; w.bare += c; i += 1;
      continue;
    }
    if (c === "#" && word === null) {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") { flush(); i += 1; continue; }
    // 算术复合命令 (( ... ))：里面的 > < 不是重定向
    // 照 flash-sh parser.rs try_arith_command / parse_arith_until_close：第一个深度为 1 的 ")" 后面不是 ")" 就不是算术，
    // 而是嵌套子 shell（bash 实测 ((echo hi);(echo there)) 两条都执行）→ 退回普通词法，这个 "(" 按运算符处理。
    const forArith = lastWord !== null && !lastWord.quoted && lastWord.text === "for" && tokens[tokens.length - 1] === lastWord;
    if (word === null && !inCond && (cmdPos || forArith) && c === "(" && s[i + 1] === "(") {
      let j = i + 2;
      let depth = 1;
      let closed = false;
      let nested = false;
      let sub = false;
      while (j < s.length) {
        const ch = s[j];
        if (ch === "`") sub = true;
        else if (ch === "$" && s[j + 1] === "(") sub = true;
        else if (ch === "(") depth += 1;
        else if (ch === ")") {
          if (depth === 1) {
            if (s[j + 1] === ")") { closed = true; j += 2; break; }
            nested = true;
            break;
          }
          depth -= 1;
        }
        j += 1;
      }
      if (!nested) {
        if (sub) flags.substitution = true;
        if (!closed) flags.unbalanced = true;
        tokens.push({ type: "arith", text: s.slice(i + 2, closed ? j - 2 : j) });
        cmdPos = false;
        i = j;
        continue;
      }
      // nested：落到下面的运算符分支
    }
    // 进程替换 <(…) >(…)
    if ((c === "<" || c === ">") && s[i + 1] === "(") { flags.substitution = true; flush(); tokens.push({ type: "op", text: c + "(" }); i += 2; continue; }
    // 重定向：[n]> [n]>> &> &>> >| < << <<< <& >&（紧贴在词后面的 > 也算：echo hi>out；[[ ... ]] 里 < > 是比较符）
    if (!inCond) {
      const digitsWord = word !== null && /^\d+$/.test(word.text) && !word.quoted;
      const redir = word === null
        ? /^(\d*|&)(>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/.exec(s.slice(i))
        : /^()(>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/.exec(s.slice(i));
      if (redir) {
        let fd = redir[1];
        if (digitsWord) { fd = word.text; word = null; } else flush();
        tokens.push({ type: "redir", op: redir[2], fd });
        cmdPos = false;
        if (redir[2].startsWith("<<") && redir[2] !== "<<<") flags.heredoc = true;
        i += redir[0].length;
        continue;
      }
    }
    const op = OPERATORS.find((o) => s.startsWith(o, i));
    if (op) {
      flush();
      if (inCond && (op === "&&" || op === "||" || op === "(" || op === ")")) {
        // [[ a && b ]] 里的逻辑符/分组留在同一条件块里
        tokens.push({ type: "word", text: op, bare: op, quoted: false, dollar: false, raw: op });
      } else {
        // 条件块没遇到 ]] 就被 ; | & 换行截断：bash / flash-sh 都是语法错误，按看不懂处理
        if (inCond) flags.unbalanced = true;
        inCond = false;
        tokens.push({ type: "op", text: op });
        if (op === "&") flags.background = true;
        // ) 之后只能跟运算符 / 重定向；其余运算符之后是新命令的开头
        cmdPos = op !== ")";
      }
      i += op.length;
      continue;
    }
    const w = ensure();
    w.text += c;
    w.bare += c;
    i += 1;
  }
  flush();
  if (inCond) flags.unbalanced = true; // [[ 一直到串尾都没有 ]]
  return { tokens, flags };
}

/** 词里有没有会展开的东西（未加引号的 glob / 花括号 / 开头的 ~ / $）。 */
function expansionOf(word) {
  const b = word.bare ?? "";
  const kinds = [];
  if (word.dollar) kinds.push("$");
  if (/[*?[]/.test(b) || /[@!+*?]\(/.test(b)) kinds.push("glob");
  if (/\{[^}]*(,|\.\.)[^}]*\}/.test(b)) kinds.push("brace");
  if (b.startsWith("~")) kinds.push("~");
  return kinds;
}

/** 命令名归一化（只用于比对名单）：两种读法（反斜杠被 shell 吃掉 / 当作 Windows 路径分隔符）都算。 */
export function commandNames(text, raw = text) {
  const out = new Set();
  for (const candidate of [text, raw]) {
    if (typeof candidate !== "string") continue;
    let n = candidate.replace(/["']/g, "").replace(/\\/g, "/");
    n = n.slice(n.lastIndexOf("/") + 1);
    n = n.replace(/^[a-zA-Z]:/, "").replace(/[.\s]+$/, "").toLowerCase();
    out.add(n);
    out.add(n.replace(/\.(exe|com|bat|cmd|ps1|vbs|vbe|js|wsf|msc|cpl|scr)$/, ""));
  }
  out.delete("");
  return [...out];
}

const isMsysDrive = (p) => /^\/[a-zA-Z](\/|$)/.test(p);
const isUncLike = (p) => /^[\\/]{2}/.test(p);
const WIN_DEVICE = /^(con|prn|aux|com\d|lpt\d|conin\$|conout\$)(\.[^\\/]*)?$/i;

/** 最深的已存在祖先做 realpath，再接上剩下的部分；任何异常返回 undefined（调用方按外部算）。 */
function realpathLoose(abs, P) {
  let cur = abs;
  const rest = [];
  for (let guard = 0; guard < 256; guard++) {
    try {
      const real = (fs.realpathSync.native ?? fs.realpathSync)(cur);
      return rest.length ? P.join(real, ...rest.reverse()) : real;
    } catch (error) {
      if (error && error.code !== "ENOENT" && error.code !== "ENOTDIR") return undefined;
      const parent = P.dirname(cur);
      if (parent === cur) return undefined;
      rest.push(P.basename(cur));
      cur = parent;
    }
  }
  return undefined;
}

/**
 * 写目标是否落在工作区外（或无法判定）。/dev/null、NUL 与临时目录（/tmp、os.tmpdir()）不算外部。
 * UNC（\\server\share、//server/share、\\.\设备）与 CON/COM1 等设备名一律算外部。
 * followLinks（默认：platform 与本机一致时开）：字面上落在工作区 / 临时目录内时，再按真实路径（解开符号链接 / 联接点）
 * 复核一次，必须仍落在某个允许的根里；UNC 路径不做 realpath（避免为了判定而去连网络共享）。
 */
export function isOutsideWorkspace(target, { cwd, workspace, platform = process.platform, tmpdir = os.tmpdir(), followLinks } = {}) {
  if (typeof target !== "string" || target === "") return true;
  if (/^\/dev\/(null|stdout|stderr|tty)$/.test(target) || /^nul$/i.test(target)) return false;
  if (/[$`]/.test(target) || target.startsWith("~")) return true; // 展开后才知道 → 按外部算
  if (workspace === undefined || cwd === undefined) return true;
  const win = platform === "win32";
  const P = win ? path.win32 : path.posix;
  let t = target;
  if (win && isMsysDrive(t)) t = t[1].toUpperCase() + ":" + (t.slice(2) || "\\");
  if (win && (isUncLike(t) || WIN_DEVICE.test(P.basename(t)))) return true;
  if (win && isUncLike(cwd) && !isUncLike(workspace)) return true;
  // flash-sh 在 Windows 上把 /tmp 映射到临时目录
  if (win && (t === "/tmp" || t.startsWith("/tmp/"))) t = P.join(tmpdir, t.slice(4) || ".");
  const abs = P.resolve(cwd, t);
  const roots = [workspace, tmpdir, ...(win ? [] : ["/tmp"])].map((r) => P.resolve(r));
  const inside = (root, p) => {
    const rel = P.relative(root, p);
    return rel === "" || (!rel.startsWith("..") && !P.isAbsolute(rel));
  };
  if (!roots.some((r) => inside(r, abs))) return true;
  const follow = followLinks ?? (platform === process.platform);
  if (!follow || isUncLike(abs)) return false;
  const realAbs = realpathLoose(abs, P);
  if (realAbs === undefined) return true;
  const realRoots = roots.map((r) => realpathLoose(r, P)).filter((r) => r !== undefined);
  return !realRoots.some((r) => inside(r, realAbs));
}

/** 带展开的写目标取「确定的前缀」：花括号 / $ / ~、或 glob 所在的那一段以 . 或 [ 开头（可能匹配 ..）→ undefined（无法判定）。 */
function globTargetPrefix(word) {
  const kinds = expansionOf(word);
  if (kinds.includes("brace") || kinds.includes("$") || kinds.includes("~")) return undefined;
  if (!kinds.includes("glob")) return word.text;
  const parts = word.text.split(/[\\/]/);
  const bareParts = (word.bare ?? "").split(/[\\/]/);
  const out = [];
  for (let k = 0; k < parts.length; k++) {
    const b = bareParts[k] ?? "";
    if (/[*?[]/.test(b) || /[@!+*?]\(/.test(b)) {
      if (/^[.[]/.test(parts[k]) || parts[k] === "") return undefined;
      return out.length ? out.join("/") : ".";
    }
    out.push(parts[k]);
  }
  return word.text;
}

// 以 - 开头（含 '-rf' 这种整体加引号的：bash 去引号后照样当选项传给命令）才算选项
const isFlag = (w) => w.text.startsWith("-") && w.text !== "-" && /^["']?-/.test(w.raw ?? w.text);

const PYTHON_DANGER_MODS = new Set(["timeit", "code", "pdb", "cprofile", "profile", "trace", "runpy", "pip", "http.server", "webbrowser", "ensurepip", "pydoc", "doctest", "smtpd", "ftplib", "zipapp", "idlelib"]);

/**
 * 照 flash-sh applets/awk.rs lex() 把 awk 程序里的字符串换成 ""、/re/ 字面量换成 //、去掉 # 注释，其余原样。
 * 词法错误（未闭合的字符串 / 正则、正则里换行）返回 undefined，调用方改看原文。
 */
function awkStripLiterals(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let operand = false; // 上一个记号之后的 / 是除号（数字、字符串、正则、名字、内建函数、) ] $ ++ --）
  while (i < n) {
    const ch = src[i];
    if (ch === "\\" && src[i + 1] === "\n") { i += 2; continue; }
    if (ch === "\\" && src[i + 1] === "\r" && src[i + 2] === "\n") { i += 3; continue; }
    if (ch === " " || ch === "\t" || ch === "\r") { out += ch; i += 1; continue; }
    if (ch === "#") { while (i < n && src[i] !== "\n") i += 1; continue; }
    if (ch === "\n") { out += ch; operand = false; i += 1; continue; }
    if (ch === '"') {
      i += 1;
      while (i < n && src[i] !== '"') i += src[i] === "\\" && i + 1 < n ? 2 : 1;
      if (i >= n) return undefined;
      i += 1;
      out += '""';
      operand = true;
      continue;
    }
    if (ch === "/" && !operand) {
      i += 1;
      let inBr = false;
      while (i < n && (src[i] !== "/" || inBr)) {
        const c = src[i];
        if (c === "\n") return undefined;
        if (c === "\\" && i + 1 < n) { i += 2; continue; }
        if (c === "[" && !inBr) { inBr = true; i += 1; if (src[i] === "^") i += 1; if (src[i] === "]") i += 1; continue; }
        if (c === "[" && inBr && src[i + 1] === ":") { while (i < n && !(src[i] === "]" && src[i - 1] === ":")) i += 1; if (i < n) i += 1; continue; }
        if (c === "]" && inBr) inBr = false;
        i += 1;
      }
      if (i >= n) return undefined;
      i += 1;
      out += "//";
      operand = true;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      const w = src.slice(i, j);
      out += w;
      i = j;
      operand = !AWK_KW.has(w);
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      while (i < n && /[0-9.]/.test(src[i])) { out += src[i]; i += 1; }
      operand = true;
      continue;
    }
    if (src.startsWith("++", i) || src.startsWith("--", i)) { out += src.slice(i, i + 2); i += 2; operand = true; continue; }
    out += ch;
    i += 1;
    operand = ch === ")" || ch === "]" || ch === "$";
  }
  return out;
}

/** 逐条解析 sed 脚本，识别 e/w/W/r/R 命令以及任意分隔符 s<d>pat<d>rep<d>flags 里的 e/w/W 标志。 */
function sedScriptDangerous(prog) {
  let i = 0;
  const n = prog.length;
  const skipWs = () => { while (i < n && (prog[i] === " " || prog[i] === "\t" || prog[i] === ";" || prog[i] === "\n" || prog[i] === "\r" || prog[i] === "{" || prog[i] === "}")) i += 1; };
  const skipDelim = (delim, allowBracket = true) => {
    let inBracket = false;
    while (i < n) {
      const ch = prog[i];
      if (!inBracket && ch === delim) { i += 1; return true; }
      if (ch === "\\" && i + 1 < n) { i += 2; continue; }
      if (allowBracket && !inBracket && ch === "[") {
        inBracket = true;
        i += 1;
        if (prog[i] === "^" || prog[i] === "!") i += 1;
        if (prog[i] === "]") i += 1; // 开头的 ] 是字面量
        continue;
      }
      if (inBracket) {
        if (ch === "[" && (prog[i + 1] === ":" || prog[i + 1] === "." || prog[i + 1] === "=")) {
          const kind = prog[i + 1];
          i += 2;
          while (i < n) { const cc = prog[i]; i += 1; if (cc === kind && prog[i] === "]") { i += 1; break; } }
          continue;
        }
        if (ch === "]") inBracket = false;
      }
      i += 1;
    }
    return false;
  };
  while (i < n) {
    skipWs();
    if (i >= n) break;
    if (prog[i] === "#") { while (i < n && prog[i] !== "\n") i += 1; continue; }
    // 跳过地址（数字、$、~、+、,、/re/、\c re c）与取反 !
    while (i < n) {
      while (i < n && (prog[i] === " " || prog[i] === "\t")) i += 1;
      if (i >= n) break;
      const ch = prog[i];
      if ((ch >= "0" && ch <= "9") || ch === "$" || ch === "," || ch === "~" || ch === "+" || ch === "!") { i += 1; continue; }
      if (ch === "/") { i += 1; if (!skipDelim("/")) return true; while (i < n && (prog[i] === "I" || prog[i] === "i")) i += 1; continue; }
      if (ch === "\\" && i + 1 < n) { const d = prog[i + 1]; i += 2; if (!skipDelim(d)) return true; while (i < n && (prog[i] === "I" || prog[i] === "i")) i += 1; continue; }
      break;
    }
    if (i >= n) break;
    const cmd = prog[i];
    i += 1;
    if (cmd === "{" || cmd === "}" || cmd === ";" || cmd === "\n") continue;
    if (cmd === "e" || cmd === "w" || cmd === "W" || cmd === "r" || cmd === "R") return true;
    if (cmd === "s" || cmd === "y") {
      if (i >= n) return true;
      const delim = prog[i];
      i += 1;
      if (!skipDelim(delim)) return true;
      if (!skipDelim(delim, false)) return true; // 替换段 / y 的目标集：没有方括号表达式
      if (cmd === "s") {
        while (i < n && prog[i] !== ";" && prog[i] !== "\n" && prog[i] !== "}" && prog[i] !== "#") {
          const fc = prog[i];
          if (fc === "e" || fc === "w" || fc === "W") return true;
          i += 1;
        }
      }
      continue;
    }
    if (cmd === "a" || cmd === "i" || cmd === "c") {
      while (i < n) {
        if (prog[i] === "\\" && prog[i + 1] === "\n") { i += 2; continue; }
        if (prog[i] === "\n") { i += 1; break; }
        i += 1;
      }
      continue;
    }
    while (i < n && prog[i] !== ";" && prog[i] !== "\n" && prog[i] !== "}") i += 1;
  }
  return false;
}

/**
 * 给一条命令归类：
 *   key        会话级记忆的规则键：命令名集合（排序去重，原样）＋特征（| 管道，> 写文件，& 后台）
 *   cacheable  可否「批准一次、本会话不再问」
 *   reasons    不可记忆的原因（危险 / 无法可靠分析）
 */
export function classifyCommand(command, ctx = {}) {
  const reasons = [];
  const why = (r) => { if (!reasons.includes(r)) reasons.push(r); };
  const { tokens, flags } = lex(String(command));
  if (flags.substitution) why("command substitution $(...) / `...` / <(...)");
  if (flags.heredoc) why("here-document");
  if (flags.unbalanced) why("unbalanced quotes");
  const heads = new Set();
  const features = new Set();
  if (flags.background) features.add("&");
  const plat = ctx.platform ?? process.platform;
  const PP = plat === "win32" ? path.win32 : path.posix;
  // 切段
  const segments = [];
  let cur = [];
  for (const t of tokens) {
    if (t.type === "op") {
      if (t.text === "|" || t.text === "|&") features.add("|");
      if (t.text === ";;") why("case statement");
      segments.push(cur);
      cur = [];
    } else cur.push(t);
  }
  segments.push(cur);
  // 写目标：{ w, cwds }；cwds 是这一段可能所在的目录（cd 之后会变；undefined = 不知道）
  const writeTargets = [];
  let cwds = [ctx.cwd];
  const addTarget = (w) => writeTargets.push({ w, cwds: cwds.slice() });
  const addTargetText = (text) => writeTargets.push({ w: { text, bare: text, dollar: /\$/.test(text), quoted: false }, cwds: cwds.slice() });
  const outsideFor = (text, dirs) => dirs.some((d) => isOutsideWorkspace(text, { ...ctx, cwd: d }));
  const valueWord = (text) => ({ text, bare: text, dollar: /\$/.test(text), quoted: false });
  let funcDef = /(^|[\s;&|({])function\s+[A-Za-z_]/.test(command) || /(^|[\s;&|({])[^\s;&|(){}<>'"`$]+\s*\(\s*\)/.test(command);
  let sawArith = false;
  for (const seg of segments) {
    // 先收重定向目标
    const words = [];
    for (let k = 0; k < seg.length; k++) {
      const t = seg[k];
      if (t.type === "arith") {
        // (( PATH=1 )) 等算术赋值碰到危险变量仍需确认
        for (const m of t.text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:[+\-*/%&|^]|<<|>>)?=(?!=)|\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+\+|--)|(?:\+\+|--)\s*([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
          const nm = m[1] || m[2] || m[3];
          if (nm && DANGER_VAR.test(nm)) why("arithmetic assigns " + nm + " (changes how commands are found or run)");
        }
        sawArith = true;
        continue;
      }
      if (t.type === "redir") {
        const target = seg[k + 1] && seg[k + 1].type === "word" ? seg[k + 1] : undefined;
        if (target) k += 1;
        if (t.op === ">&" || t.op === "<&") {
          if (target && !/^\d+-?$|^-$/.test(target.text)) { if (t.op === ">&") features.add(">"); addTarget(target); }
          continue;
        }
        if (t.op.startsWith(">") || t.op === "<>") {
          if (!target) { features.add(">"); why("redirection without a target"); }
          else {
            if (!(target.text === "/dev/null" || /^nul$/i.test(target.text))) features.add(">");
            addTarget(target);
          }
        }
        continue;
      }
      words.push(t);
    }
    let w = 0;
    // 前置赋值：给会改变命令查找 / 执行方式的变量赋值（PATH、LD_PRELOAD、BASH_ENV、IFS、GIT_*、NODE_OPTIONS…）→ 每次都问
    while (w < words.length && /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(words[w].text) && !/^["']/.test(words[w].raw ?? "")) {
      const nm = words[w].text.replace(/(\[.*)?\+?=.*$/s, "");
      if (DANGER_VAR.test(nm)) why("sets " + nm + " (changes how commands are found or run)");
      w += 1;
    }
    while (w < words.length && KEYWORDS.has(words[w].text) && !words[w].quoted) w += 1;
    if (w >= words.length) continue;
    const hw = words[w];
    const head0 = hw.text;
    if ((head0 === "for" || head0 === "select") && !hw.quoted) continue; // for x in …：后面的词不是命令
    if (head0 === "[[" && !hw.quoted) {
      heads.add("[[");
      if (STORED_SUBST.test(command) && words.slice(w + 1).some((x) => /^-(eq|ne|lt|le|gt|ge)$/.test(x.text))) why("[[ arithmetic comparison may evaluate a command substitution stored in a variable");
      continue;
    }
    if (head0 === "case" && !hw.quoted) { why("case statement"); continue; }
    if (head0 === "function" || (words[w + 1] && words[w + 1].text === "()") || /\(\)$/.test(head0)) { funcDef = true; continue; }
    const head = head0; // 原样作为键
    const names = commandNames(head0, hw.raw);
    const is = (set) => names.some((n) => set.has(n));
    const lc = names[names.length - 1] ?? "";
    heads.add(head);
    const argsW = words.slice(w + 1);
    const args = argsW.map((x) => x.text);
    if (plat === "win32" && argsW.some((a) => /^[\\/]{2}[^\\/]/.test(a.text))) why("touches a network share or device path (UNC)");
    const headExp = expansionOf(hw);
    if (hw.dollar) why("command name comes from a variable");
    else if (headExp.length && head0 !== "[") why("command name uses shell expansion (" + headExp.join(", ") + ")");
    if (/[=\u0000-\u001f]/.test(head0)) why("unusual command name");
    if (is(SHELLS)) why("runs another shell (" + lc + ")");
    if (is(WRAPPERS)) why("wrapper command (" + lc + ") runs an arbitrary command");
    if (is(EVALS)) why(lc + " executes dynamic code or changes command lookup");
    if (is(ALWAYS_DANGEROUS)) why(lc + " is always confirmed");
    // 按名字赋值的内建命令碰到危险变量
    if (is(ASSIGNING_BUILTINS)) {
      const assigned = lc === "printf" ? argsW.filter((a, k) => (k > 0 && argsW[k - 1].text === "-v") || /^-v.+/.test(a.text)) : argsW;
      const isNameref = (lc === "declare" || lc === "typeset" || lc === "local") && args.some((a) => /^-[a-zA-Z]*n/.test(a));
      for (const a of assigned) {
        const rawText = lc === "printf" && /^-v.+/.test(a.text) ? a.text.slice(2) : a.text;
        const nm = rawText.replace(/^-+[A-Za-z]*\s*/, "").replace(/(\[.*)?\+?=.*$/s, "");
        if (DANGER_VAR.test(nm)) why(lc + " assigns " + nm + " (changes how commands are found or run)");
        if (isNameref && a.text.includes("=")) {
          const rhs = a.text.slice(a.text.indexOf("=") + 1).replace(/\[.*$/, "");
          if (DANGER_VAR.test(rhs)) why(lc + " -n aliases " + rhs + " (changes how commands are found or run)");
        }
      }
      if ((lc === "mapfile" || lc === "readarray") && args.some((a) => /^-[a-zA-Z]*C/.test(a))) why(lc + " -C runs a callback");
    }
    // 位置参数（-- 之后都是位置参数）
    const positional = [];
    {
      let dd = false;
      for (const a of argsW) {
        if (!dd && !a.quoted && a.text === "--") { dd = true; continue; }
        if (!dd && isFlag(a)) continue;
        positional.push(a);
      }
    }
    // 解释器：只认「解释器 + 脚本文件（+ 参数）」；内联代码、从 stdin 读代码、预加载模块 → 每次都问
    if (names.some((n) => INTERPRETER_RE.test(n)) && !is(SHELLS)) {
      const isAwk = is(AWKS);
      let script;
      let inline = false;
      let sawUnknownValOpt = false;
      for (let k = 0; k < argsW.length; k++) {
        const a = argsW[k];
        const x = a.text;
        if (!a.quoted && x === "--") {
          if (script === undefined && argsW[k + 1]) script = argsW[k + 1];
          break;
        }
        if (isFlag(a)) {
          if (isAwk) {
            if (/^-(f|-file|E|-exec|l|-load|i|-include)/.test(x)) inline = true; // 程序在文件里 / 加载扩展：看不见
            if (/^-[vF]$|^--(assign|field-separator)$/.test(x)) k += 1;
            continue;
          }
          if (/^--?(eval|print|command|exec|require|import|loader|experimental-loader|input-type|interactive|encodedcommand)\b/i.test(x)) { inline = true; break; }
          if (x !== "-m" && /^-[A-Za-z]*[ceEprM]/.test(x)) { inline = true; break; }
          const mm = /^-([A-Za-z]*?)m(.*)$/s.exec(x);
          if (mm && !x.startsWith("--") && /^[bBdEhiIOPqsSuvx]*$/.test(mm[1])) {
            // -m mod、-mmod，以及 python 无参选项簇里的 m：-Im pip、-sm http.server
            const modName = mm[2] === "" ? argsW[k + 1]?.text : mm[2];
            script = mm[2] === "" ? argsW[k + 1] : a;
            const mn = (modName ?? "").toLowerCase();
            if (!modName || PYTHON_DANGER_MODS.has(mn) || [...PYTHON_DANGER_MODS].some((d) => mn.startsWith(d + "."))) inline = true;
            break;
          }
          if (/^-[WXQI]$/.test(x)) { k += 1; continue; }
          if (x.startsWith("--") && !x.includes("=") && !/^--(version|help|check|no-warnings|trace-warnings|inspect|experimental-.*)$/i.test(x)) {
            sawUnknownValOpt = true; // 如 node --title foo -e ...：下一个词可能是选项值，不能提前 break
          }
          continue;
        }
        if (sawUnknownValOpt) {
          sawUnknownValOpt = false;
          if (script === undefined) script = a;
          continue;
        }
        script = a;
        break;
      }
      if (isAwk && !inline && script !== undefined) {
        const prog = script.text;
        const stripped = awkStripLiterals(prog);
        const external = lc !== "awk"; // gawk / mawk / nawk 可能是外部程序，词法细节不保证与 flash-sh 一致
        if (stripped === undefined || external) { if (AWK_DANGER.test(prog) || AWK_DANGER.test(stripped ?? "")) inline = true; }
        else if (AWK_DANGER.test(stripped)) inline = true;
      }
      const onlyInfo = args.length > 0 && args.every((a) => /^(--?version|-V|--help|-h|-v)$/.test(a));
      if (/^(deno|bun)$/.test(lc) && script && /^(eval|repl|x)$/.test(script.text)) inline = true;
      if (inline) why(lc + " with inline code / preloaded modules");
      else if (script === undefined && !onlyInfo) why(lc + " reads its program from stdin or a hidden source");
    }
    if (/^(rm|del|erase|rd|rmdir)$/.test(lc) || names.includes("rm")) {
      if (args.some((a) => /^-[a-zA-Z]*[rRf]/.test(a) || /^--(recursive|force|no-preserve-root)/.test(a) || /^\/[sSqQ]$/.test(a))) why("recursive/forced delete (" + lc + " " + args.filter((a) => a.startsWith("-") || a.startsWith("/")).join(" ") + ")");
    }
    if (lc === "find" && args.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/.test(a))) why("find -delete/-exec/-fprint");
    if (lc === "sed") {
      if (args.some((a) => /^-[a-zA-Z]*f/.test(a) || a.startsWith("--file"))) why("sed program from a file");
      const scripts = [];
      for (let k = 0; k < argsW.length; k++) {
        const ak = args[k];
        if (/^-[a-zA-Z]*e$/.test(ak) || ak === "--expression") { if (argsW[k + 1]) scripts.push(args[k + 1]); k += 1; }
        else if (/^-[a-zA-Z]*e(.+)$/.test(ak)) scripts.push(ak.replace(/^-[a-zA-Z]*e/, ""));
        else if (ak.startsWith("--expression=")) scripts.push(ak.slice(13));
      }
      if (scripts.length === 0 && positional[0]) scripts.push(positional[0].text);
      if (scripts.some((p) => sedScriptDangerous(p) || SED_LEGACY_DANGER.test(p))) why("sed program can run commands or write files (e/w)");
    }
    if (lc === "git") {
      // git 的全局选项：-C <dir>、-c k=v、--git-dir/--work-tree/--exec-path …
      let k = 0;
      const dirs = [];
      while (k < args.length) {
        const a = args[k];
        if (a === "-C") { dirs.push(argsW[k + 1]); k += 2; continue; }
        if (/^-C(.+)$/.test(a)) { dirs.push(valueWord(a.slice(2))); k += 1; continue; }
        if (a === "-c" || /^-c.+/.test(a) || a.startsWith("--config-env")) { why("git -c / --config-env can make git run arbitrary commands"); k += a === "-c" ? 2 : 1; continue; }
        const m = /^--(git-dir|work-tree|exec-path|namespace|super-prefix)(=(.*))?$/.exec(a);
        if (m) {
          const val = m[2] !== undefined ? valueWord(m[3]) : argsW[k + 1];
          if (m[1] === "exec-path" && (m[2] !== undefined || argsW[k + 1])) why("git --exec-path runs helpers from another directory");
          if (m[1] === "git-dir" || m[1] === "work-tree") dirs.push(val);
          k += m[2] !== undefined ? 1 : 2;
          continue;
        }
        if (a.startsWith("-")) { k += 1; continue; }
        break;
      }
      for (const d of dirs) {
        if (d === undefined || outsideFor(globTargetPrefix(d) ?? "$", cwds)) why("git operates on a directory outside the workspace");
      }
      const sub = args[k];
      const rest = args.slice(k + 1);
      const has = (re) => rest.some((a) => re.test(a));
      const danger =
        sub === "push" || sub === "clean" || sub === "filter-branch" || sub === "filter-repo" || sub === "send-email" ||
        sub === "daemon" || sub === "instaweb" || sub === "credential" || sub === "restore" || sub === "prune" ||
        sub === "difftool" || sub === "mergetool" ||
        (sub === "reset" && has(/^--(hard|merge|keep)$/)) ||
        (sub === "checkout" && has(/^(--|\.|-f|--force|-B|--ours|--theirs|-p|--patch)$/)) ||
        (sub === "switch" && has(/^(-f|--force|--discard-changes|-C|--force-create)$/)) ||
        (sub === "stash" && has(/^(drop|clear)$/)) ||
        (sub === "branch" && has(/^(-[a-zA-Z]*[dDMf]|--delete|--force|--move)$/)) ||
        (sub === "tag" && has(/^(-[a-zA-Z]*[df]|--delete|--force)$/)) ||
        (sub === "rm" && has(/^(-[a-zA-Z]*[rf]|--force)$/)) ||
        (sub === "submodule" && has(/^(foreach|deinit)$/)) ||
        (sub === "rebase" && has(/^(-x|--exec(=.*)?|-[a-zA-Z]*x)$/)) ||
        (sub === "bisect" && has(/^run$/)) ||
        (sub === "config" && !has(/^(--get|--get-all|--get-regexp|--list|-l|--show-origin|--show-scope|--name-only|--get-urlmatch)$/)) ||
        (sub === "update-ref" && has(/^(-d|--stdin)$/)) ||
        (sub === "reflog" && has(/^(expire|delete)$/)) ||
        (sub === "gc" && has(/^--prune/)) ||
        (sub === "worktree" && has(/^(remove|prune)$/)) ||
        (sub === "remote" && has(/^(add|set-url|remove|rm|rename)$/)) ||
        (sub === "apply" && has(/^(--unsafe-paths|--directory(=.*)?)$/));
      if (danger) why("git " + sub + " (destructive, remote or runs other programs)");
      const remoteish = /^(clone|fetch|pull|ls-remote|archive|submodule)$/.test(sub ?? "");
      if (has(/^--(upload-pack|receive-pack)(=.*)?$/) || (remoteish && has(/^(-u|--exec)(=.*)?$/)) || ((sub === "clone" || sub === "init") && has(/^(-c|--config|--template)(=.*)?$/)) || rest.some((a) => /^ext::/i.test(a))) why("git option that runs other programs or loads foreign config");
      if (sub === "clone" || sub === "init") {
        const subArgs = argsW.slice(k + 1);
        const pos = [];
        const CLONE_VAL_OPTS = /^(-b|--branch|-o|--origin|-j|--jobs|--depth|--shallow-since|--shallow-exclude|--reference|--reference-if-able|--separate-git-dir|--filter|--server-option|-u|--upload-pack|-c|--config|--template|--initial-branch|--object-format)$/;
        let dd = false;
        for (let m = 0; m < subArgs.length; m++) {
          const sa = subArgs[m];
          if (!dd && !sa.quoted && sa.text === "--") { dd = true; continue; }
          if (!dd && isFlag(sa)) {
            if (CLONE_VAL_OPTS.test(sa.text)) m += 1;
            continue;
          }
          pos.push(sa);
        }
        const target = sub === "clone" ? (pos.length >= 2 ? pos[pos.length - 1] : undefined) : pos[0];
        if (target) { features.add(">"); addTarget(target); }
      }
    }
    // make / npm / pnpm / yarn / cargo / cmake / go 换目录或换入口文件
    const DIR_OPTS = { make: /^(-C|--directory|-f|--file|--makefile)(=(.*))?$/, npm: /^(--prefix|-C|--dir|--cwd)(=(.*))?$/, cargo: /^(--manifest-path|-C)(=(.*))?$/, cmake: /^(-B|-S|-C)(=(.*))?$/, go: /^(-C)(=(.*))?$/ };
    const family = /^(make|gmake|mingw32-make|nmake)$/.test(lc) ? "make" : /^(npm|pnpm|yarn|bun)$/.test(lc) ? "npm" : /^(cargo|cmake|go)$/.test(lc) ? lc : undefined;
    if (family !== undefined) {
      for (let k = 0; k < args.length; k++) {
        const m = DIR_OPTS[family].exec(args[k]);
        if (!m) continue;
        const val = m[2] !== undefined ? valueWord(m[3]) : argsW[k + 1];
        if (val === undefined || outsideFor(globTargetPrefix(val) ?? "$", cwds)) why(lc + " " + m[1] + " points outside the workspace");
      }
      const p0 = positional[0] ? positional[0].text : "";
      if ((lc === "npm" && /^(exec|x)$/.test(p0)) || ((lc === "pnpm" || lc === "yarn") && p0 === "dlx") || (lc === "bun" && p0 === "x")) why(lc + " " + p0 + " downloads and runs a package");
    }
    // 写文件参数
    const pushPositional = (list) => { for (const a of list) addTarget(a); if (list.length > 0) features.add(">"); };
    if (is(WRITE_ALL_ARGS)) {
      pushPositional(positional); // mv 的源也会被删掉，所以 mv 的每个参数都算写
    } else if (is(WRITE_LAST_ARG)) {
      const tIdx = args.findIndex((a) => /^-[a-zA-Z]*t/.test(a) || a === "--target-directory" || a.startsWith("--target-directory="));
      if (tIdx >= 0) {
        const a = args[tIdx];
        if (a.startsWith("--target-directory=")) addTargetText(a.slice(19));
        else if (/^-[a-zA-Z]*t(.+)$/.test(a)) addTargetText(a.replace(/^-[a-zA-Z]*t/, ""));
        else if (argsW[tIdx + 1]) addTarget(argsW[tIdx + 1]);
        else why(lc + " -t without a directory");
        features.add(">");
      } else if (positional.length > 0) pushPositional([positional[positional.length - 1]]);
    } else if (lc === "sed" && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) {
      const hasScriptFlag = args.some((a) => /^-[a-zA-Z]*[ef]/.test(a) || a.startsWith("--expression") || a.startsWith("--file"));
      pushPositional(hasScriptFlag ? positional : positional.slice(1));
      features.add(">");
    } else if (lc === "sort") {
      for (let k = 0; k < args.length; k++) {
        if (args[k] === "-o" || args[k] === "--output") { if (argsW[k + 1]) addTarget(argsW[k + 1]); features.add(">"); }
        else if (/^-o./.test(args[k])) { addTargetText(args[k].slice(2)); features.add(">"); }
        else if (args[k].startsWith("--output=")) { addTargetText(args[k].slice(9)); features.add(">"); }
      }
    } else if (lc === "uniq" && positional.length >= 2) {
      pushPositional([positional[1]]);
    } else if (lc === "tar" || lc === "bsdtar") {
      const cluster = args.find((a) => /^[a-zA-Z]+$/.test(a)) ?? "";
      if (args.some((a) => /^(-P|--absolute-names|--overwrite|--unlink-first|--to-command(=.*)?)$/.test(a))) why("tar option that writes through absolute paths or runs commands");
      let dirSet = false;
      for (let k = 0; k < args.length; k++) {
        if (args[k] === "-C" || args[k] === "--directory") { if (argsW[k + 1]) addTarget(argsW[k + 1]); dirSet = true; }
        else if (/^-C(.+)$/.test(args[k])) { addTargetText(args[k].slice(2)); dirSet = true; }
        else if (args[k].startsWith("--directory=")) { addTargetText(args[k].slice(12)); dirSet = true; }
      }
      const creating = /[cru]/.test(cluster) || args.some((a) => /^-[a-zA-Z]*[cru]/.test(a) || /^--(create|append|update)$/.test(a));
      if (creating) {
        const fIdx = args.findIndex((a) => /^-[a-zA-Z]*f/.test(a) || a === "--file" || a.startsWith("--file="));
        if (fIdx >= 0) {
          const fa = args[fIdx];
          if (fa.startsWith("--file=")) addTargetText(fa.slice(7));
          else if (/^-[a-zA-Z]*f(.+)$/.test(fa)) addTargetText(fa.replace(/^-[a-zA-Z]*f/, ""));
          else if (argsW[fIdx + 1]) addTarget(argsW[fIdx + 1]);
        } else if (/f/.test(cluster)) { const p = positional.find((a) => a.text !== cluster); if (p) addTarget(p); }
      } else if (!dirSet) addTargetText(".");
      features.add(">");
    } else if (lc === "unzip" || lc === "7z" || lc === "7za") {
      for (let k = 0; k < args.length; k++) {
        if (args[k] === "-d") { if (argsW[k + 1]) addTarget(argsW[k + 1]); }
        else if (/^-d(.+)$/.test(args[k])) addTargetText(args[k].slice(2));
        else if (/^-o./.test(args[k])) addTargetText(args[k].slice(2));
      }
      features.add(">");
    } else if (lc === "zip") {
      if (positional[0]) pushPositional([positional[0]]);
    } else if (lc === "cd" || lc === "pushd" || lc === "popd" || lc === "chdir") {
      // 改变之后各段的工作目录
      const dest = lc === "popd" ? undefined : positional[0];
      const destText = dest === undefined ? undefined : globTargetPrefix(dest);
      if (dest === undefined || destText === undefined || destText === "-") {
        cwds = [undefined];
        why(lc + " to a directory that cannot be determined");
      } else {
        const destAbs = plat === "win32" && isMsysDrive(destText) ? destText[1] + ":" + (destText.slice(2) || "\\") : destText;
        const next = cwds.map((d) => (d === undefined ? undefined : PP.resolve(d, destAbs)));
        if (next.some((d) => d === undefined || isOutsideWorkspace(d, { ...ctx, cwd: d }))) why(lc + " to a directory outside the workspace");
        cwds = [...new Set([...cwds, ...next])]; // cd 可能失败：之前的目录也还可能是当前目录
      }
    }
  }
  if (funcDef) why("defines a function");
  const outside = [];
  for (const { w: tw, cwds: dirs } of writeTargets) {
    const text = globTargetPrefix(tw);
    if (text === undefined || outsideFor(text, dirs)) outside.push(tw.text);
  }
  if (outside.length > 0) why("writes outside the workspace (" + outside.slice(0, 3).join(", ") + (outside.length > 3 ? ", …" : "") + ")");
  if (ctx.cwd !== undefined && ctx.workspace !== undefined && isOutsideWorkspace(ctx.cwd, { ...ctx, cwd: ctx.workspace })) why("working directory is outside the workspace");
  // 原文（含单引号内）出现 $( 或反引号时不给："x='a[$(rm -rf ~)]'; (( x ))" 在 bash 里会执行 rm（数组下标求值）
  if (heads.size === 0 && sawArith && !STORED_SUBST.test(command)) heads.add("((");
  if (heads.size === 0 && reasons.length === 0) why("no command recognised");
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
  "Run a Bash-syntax command or script on Windows (flash-sh, a fast built-in Bash-compatible shell; no Git Bash/WSL needed).",
  "Supports: quotes/escapes, $var ${var:-x} ${#v} ${v%x} ${v//a/b} ${v:1:2}, $(...) `...` $((...)), globs, {a,b} {1..5},",
  "| && || ; &, redirects > >> < 2> 2>&1 &> <<EOF <<'EOF' <<<, <(cmd), if/elif/else, for/while/until/case, functions, local,",
  "arrays (indexed/assoc), [[ ]] incl =~, test/[ ], read, printf, set -euo pipefail, trap EXIT, source, BASH_SOURCE, FUNCNAME.",
  "Built-in in-process commands: ls cat head tail wc sort uniq cut tr grep(-E -F -r -n -o -i -v -l -c -A/-B) sed(-E -n -i) awk(POSIX + common gawk; no gensub/strftime/asort) jq diff(-u -q -r) cmp",
  "find(-name -type -exec) xargs mkdir rm cp mv touch basename dirname seq tee env date sleep realpath mktemp tac paste comm nl fold join split shuf du nproc base64 md5sum sha256sum.",
  "Not available: interactive job control (fg/bg). Windows programs (git, node, python, npm...) run from PATH (both ; and : PATH separators work).",
  "Paths: use / ; C:\\x and /c/x both work; ~ is the user profile; /tmp maps to the temp dir (including workdir); pwd/mktemp/realpath print /c/... style.",
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
    throw new Error("fl_bash: not run — this call needs user approval (session mode: " + modeText + "; fl_bash is not sandboxed) but no approval channel is available");
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
      reason: "fl_bash runs outside the DSH sandbox (session mode: " + modeText + "). " + scopeNote + "\nCommand:\n" + commandPreview(command),
      ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
    });
  } catch (error) {
    throw new Error("fl_bash: not run — the approval request failed (" + errorText(error) + "); fl_bash refuses to run without an explicit approval");
  }
  if (outcome !== "allowed-once") {
    throw new Error("fl_bash: not run — approval " + String(outcome) + " (session mode: " + modeText + "; fl_bash is not sandboxed)");
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
    // 宿主进程退出时删掉本进程自己的 spill 目录（只删 spill 日志与空目录；别的 DSH 进程各有各的 mkdtemp 目录，互不影响）。
    // 进程被强杀时来不及删的，下次启动由 cleanupStaleSpills 按 24 小时清掉（0.1.2 实机报告 P3）。
    const own = spillState.dir;
    process.once("exit", () => { try { removeSpillDir(own); } catch (error) {} });
    return spillState.dir;
  } catch (error) {
    spillState.dirError = error;
    throw error;
  }
}

const SPILL_FILE = /^([0-9a-f]{32}|\d+-\d+-\d+-[0-9a-f]{6})\.(stdout|stderr)\.log$/;

/**
 * 删掉一个 spill 目录：名字须以 SPILL_PREFIX 开头、是真目录（不是链接）、里面只有 spill 日志文件；
 * 逐个 unlink 再 rmdir，不递归。混进了别的东西就不动，返回 false。
 */
export function removeSpillDir(dir) {
  if (typeof dir !== "string" || !ownSpillName(path.basename(dir))) return false;
  let st;
  try { st = fs.lstatSync(dir); } catch (error) { return false; }
  if (!st.isDirectory() || st.isSymbolicLink()) return false;
  const inner = fs.readdirSync(dir, { withFileTypes: true });
  if (!inner.every((f) => f.isFile() && SPILL_FILE.test(f.name))) return false;
  for (const f of inner) fs.unlinkSync(path.join(dir, f.name));
  fs.rmdirSync(dir);
  return true;
}

/**
 * 删掉 root 下本插件留下、修改时间早于 maxAgeMs 的 spill 目录；返回删掉的路径。
 * 只删「看起来确实是自己的」：名字以 SPILL_PREFIX 开头的真目录（不是符号链接 / 联接点）、
 * POSIX 上属主是当前用户、里面只有 spill 日志文件（名字符合 SPILL_FILE 的普通文件）；
 * 逐个 unlink 再 rmdir，不做递归删除——目录里混进了别的东西就整个跳过。
 */
export function cleanupStaleSpills(root = os.tmpdir(), maxAgeMs = SPILL_MAX_AGE_MS, now = Date.now()) {
  const removed = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { return removed; }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  for (const e of entries) {
    if (!ownSpillName(e.name)) continue;
    const p = path.join(root, e.name);
    if (p === spillState.dir) continue;
    try {
      const st = fs.lstatSync(p);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (uid !== undefined && st.uid !== uid) continue;
      if (now - st.mtimeMs <= maxAgeMs) continue;
      const inner = fs.readdirSync(p, { withFileTypes: true });
      if (!inner.every((f) => f.isFile() && SPILL_FILE.test(f.name))) continue;
      for (const f of inner) fs.unlinkSync(path.join(p, f.name));
      fs.rmdirSync(p);
      removed.push(p);
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
      // 文件名只含 128 位随机数（不带 pid / 时间 / 序号，猜不到）；目录本身是 mkdtemp 的 0700 目录，文件用 O_EXCL 0600 新建
      this.file = path.join(dir, crypto.randomBytes(16).toString("hex") + "." + this.label + ".log");
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

/**
 * Windows 上杀整棵进程树的命令：用 %SystemRoot%\System32\taskkill.exe 的绝对路径（不走 PATH，防止被同名程序顶替），
 * 参数 /PID <pid> /T（连同子进程）/F（强制）。
 */
export function taskkillCommand(pid, env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR || "C:\\Windows";
  return { file: path.win32.join(root, "System32", "taskkill.exe"), args: ["/PID", String(pid), "/T", "/F"] };
}

function killTree(child, how) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const direct = () => { try { child.kill(how); } catch (error) {} };
  if (process.platform === "win32" && typeof child.pid === "number") {
    const { file, args } = taskkillCommand(child.pid);
    try {
      const k = spawn(file, args, { windowsHide: true, stdio: "ignore" });
      k.on("error", direct);
      // taskkill 失败（拒绝访问等）时退回直接杀；进程已经退出时它返回 128，再 kill 一次也无害
      k.on("exit", (code) => { if (code !== 0) direct(); });
      return;
    } catch (error) {
      direct();
      return;
    }
  }
  // POSIX（仅开发验证模式）：子进程是自己进程组的组长（spawn detached），杀整个组，孙进程一起走
  if (typeof child.pid === "number") {
    try { process.kill(-child.pid, how); return; } catch (error) {}
  }
  direct();
}

/** 杀掉之后最多再等这么久 close；还不来（孙进程攥着管道不放）就强行收尾，保证调用一定返回。 */
export const CLOSE_DEADLINE_MS = 3000;

/** 单预热待命进程空闲回收时限（毫秒）：超时无调用自动退出，不常驻占内存。 */
export const STANDBY_IDLE_MS = 60000;

const ACTIVE_STANDBY_POOLS = new Set();
let standbyExitHooked = false;
function ensureStandbyExitHook() {
  if (standbyExitHooked) return;
  standbyExitHooked = true;
  process.once("exit", () => {
    for (const p of [...ACTIVE_STANDBY_POOLS]) {
      try { p.dispose(); } catch (error) {}
    }
  });
}

/** 将一次调用的参数编码为 FSH1 二进制帧（供 flash-sh --standby 从 stdin 读取）。 */
export function encodeStandbyFrame({ timeoutMs, cwd, command, env }) {
  const cwdBuf = Buffer.from(String(cwd ?? ""), "utf8");
  const cmdBuf = Buffer.from(String(command ?? ""), "utf8");
  const pairs = [];
  let envBytes = 0;
  if (env && typeof env === "object") {
    for (const k in env) {
      if (!Object.prototype.hasOwnProperty.call(env, k)) continue;
      const v = env[k];
      if (v === undefined || !k || k.includes("=") || k.includes("\0")) continue;
      const sv = String(v);
      if (sv.includes("\0")) continue;
      const kb = Buffer.from(k, "utf8");
      const vb = Buffer.from(sv, "utf8");
      pairs.push([kb, vb]);
      envBytes += 8 + kb.length + vb.length;
    }
  }
  const buf = Buffer.allocUnsafe(4 + 8 + 4 + cwdBuf.length + 4 + cmdBuf.length + 4 + envBytes);
  let off = 0;
  buf.write("FSH1", off, "ascii"); off += 4;
  buf.writeBigUInt64LE(BigInt(Math.max(0, Math.round(Number(timeoutMs) || 0))), off); off += 8;
  buf.writeUInt32LE(cwdBuf.length, off); off += 4;
  cwdBuf.copy(buf, off); off += cwdBuf.length;
  buf.writeUInt32LE(cmdBuf.length, off); off += 4;
  cmdBuf.copy(buf, off); off += cmdBuf.length;
  buf.writeUInt32LE(pairs.length, off); off += 4;
  for (const [kb, vb] of pairs) {
    buf.writeUInt32LE(kb.length, off); off += 4;
    kb.copy(buf, off); off += kb.length;
    buf.writeUInt32LE(vb.length, off); off += 4;
    vb.copy(buf, off); off += vb.length;
  }
  return buf;
}

const STANDBY_READY_MAGIC = Buffer.from("FSHR", "ascii");
const STANDBY_READY_TIMEOUT_MS = 5000;

/** 解析 `flash-sh --version` 输出，判断是否支持带 FSHR 就绪握手的 `--standby`（≥ 0.1.9）。 */
export function supportsStandbyVersion(versionText) {
  if (typeof versionText !== "string") return false;
  const m = versionText.match(/flash-sh\s+(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  return major > 0 || minor > 1 || patch >= 9;
}

/**
 * 单预热待命进程池（Phase 3 / 0.1.9 兼容加固）：
 * 每次命令结束后后台提前拉起 1 个干净的 `flash-sh --standby`（在系统临时目录挂起，不锁工作区目录；
 * 全程 unref 不阻塞宿主退出；60s 空闲自动回收）。
 * 兼容与安全约定：
 *   1) 仅对内置 exe（DEFAULT_BIN）直接启用；自定义 binPath / DSH_FL_BASH_BIN 会先异步探测
 *      `--version`，确认 ≥ 0.1.9 后才启用（旧版如 0.1.6 永不启动 --standby）；
 *   2) 待命进程就绪后向 stdout 写出 4 字节魔数 "FSHR"，收到并校验通过前 take() 返回 null，
 *      不会把未就绪或不支持的进程交给调用方；
 *   3) 任何通过 fl_bash 工具发起的调用均为非交互模式，插件从不向命令传 stdin：普通 `-c` 模式
 *      使用 `stdio: ["ignore", "pipe", "pipe"]`，`--standby` 模式在 exe 读完 FSH1 协议帧后
 *      立即把 fd 0 切到 NUL / /dev/null，两者下命令读到的 stdin 始终为 EOF。
 */
export class StandbyPool {
  constructor(bin, opts = {}) {
    this.bin = bin;
    this.idleMs = opts.idleMs ?? STANDBY_IDLE_MS;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? STANDBY_READY_TIMEOUT_MS;
    this.enabled = opts.enabled ?? (process.env.DSH_FL_BASH_NO_STANDBY !== "1" && process.env.DSH_FLASH_SH_NO_STANDBY !== "1");
    this.isBundled = opts.isBundled ?? (typeof bin === "string" && bin.length > 0 && path.resolve(bin) === path.resolve(DEFAULT_BIN));
    this.probeState = this.isBundled ? "ok" : "idle"; // "idle" | "probing" | "ok" | "unsupported"
    this.probeChild = null;
    this.probeTimer = undefined;
    this.slot = null;
    this.warmTimer = undefined;
    this.unsupported = false;
    this.disposed = false;
    this.hits = 0;
    this.misses = 0;
    if (this.enabled) {
      ensureStandbyExitHook();
      ACTIVE_STANDBY_POOLS.add(this);
    }
  }
  probeVersion() {
    if (!this.enabled || this.disposed || this.unsupported || this.probeState !== "idle") return;
    this.probeState = "probing";
    let child;
    try {
      child = spawn(this.bin, ["--version"], {
        cwd: os.tmpdir(),
        env: childEnv(process.env),
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      this.probeState = "unsupported";
      this.unsupported = true;
      return;
    }
    this.probeChild = child;
    let out = "";
    let done = false;
    const finishProbe = (ok) => {
      if (done) return;
      done = true;
      if (this.probeTimer !== undefined) { clearTimeout(this.probeTimer); this.probeTimer = undefined; }
      if (this.probeChild === child) this.probeChild = null;
      if (this.disposed) return;
      if (ok) {
        this.probeState = "ok";
        this.warm();
      } else {
        this.probeState = "unsupported";
        this.unsupported = true;
      }
    };
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        if (out.length < 256) out += chunk.toString("utf8");
      });
      if (typeof child.stdout.unref === "function") child.stdout.unref();
    }
    child.on("error", () => finishProbe(false));
    child.on("close", (code) => finishProbe(code === 0 && supportsStandbyVersion(out)));
    if (typeof child.unref === "function") child.unref();
    this.probeTimer = setTimeout(() => {
      try { if (child.exitCode === null) killTree(child, "SIGTERM"); } catch (error) {}
      finishProbe(false);
    }, this.readyTimeoutMs);
    if (typeof this.probeTimer.unref === "function") this.probeTimer.unref();
  }
  scheduleWarm() {
    if (!this.enabled || this.disposed || this.unsupported || this.slot !== null || this.warmTimer !== undefined) return;
    if (this.probeState === "probing") return;
    this.warmTimer = setTimeout(() => {
      this.warmTimer = undefined;
      if (this.probeState === "idle") this.probeVersion();
      else this.warm();
    }, 1);
    if (typeof this.warmTimer.unref === "function") this.warmTimer.unref();
  }
  warm() {
    if (this.warmTimer !== undefined) { clearTimeout(this.warmTimer); this.warmTimer = undefined; }
    if (!this.enabled || this.disposed || this.unsupported || this.slot !== null) return false;
    if (this.probeState === "idle") {
      this.probeVersion();
      return false;
    }
    if (this.probeState !== "ok") return false;
    let child;
    try {
      child = spawn(this.bin, ["--standby"], {
        cwd: os.tmpdir(),
        env: childEnv(process.env),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      this.unsupported = true;
      return false;
    }
    const entry = {
      child,
      timer: undefined,
      readyTimer: undefined,
      ready: false,
      dead: false,
      onError: null,
      onExit: null,
      onStdinError: null,
      onReadyData: null,
    };
    const detach = () => {
      if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined; }
      if (entry.readyTimer !== undefined) { clearTimeout(entry.readyTimer); entry.readyTimer = undefined; }
      if (entry.onReadyData && child.stdout) child.stdout.removeListener("data", entry.onReadyData);
      if (entry.onError) child.removeListener("error", entry.onError);
      if (entry.onExit) child.removeListener("exit", entry.onExit);
    };
    const drop = (markUnsupported) => {
      if (entry.dead) return;
      entry.dead = true;
      detach();
      if (this.slot === entry) this.slot = null;
      if (markUnsupported) this.unsupported = true;
    };
    let readyBuf = Buffer.alloc(0);
    entry.onReadyData = (chunk) => {
      if (entry.dead || entry.ready) return;
      readyBuf = readyBuf.length === 0 ? chunk : Buffer.concat([readyBuf, chunk]);
      if (readyBuf.length < STANDBY_READY_MAGIC.length) {
        if (STANDBY_READY_MAGIC.subarray(0, readyBuf.length).compare(readyBuf) !== 0) {
          drop(true);
          try { killTree(child, "SIGTERM"); } catch (error) {}
        }
        return;
      }
      if (readyBuf.length === STANDBY_READY_MAGIC.length && readyBuf.compare(STANDBY_READY_MAGIC) === 0) {
        if (entry.readyTimer !== undefined) { clearTimeout(entry.readyTimer); entry.readyTimer = undefined; }
        child.stdout.removeListener("data", entry.onReadyData);
        entry.onReadyData = null;
        child.stdout.pause();
        entry.ready = true;
      } else {
        drop(true);
        try { killTree(child, "SIGTERM"); } catch (error) {}
      }
    };
    entry.onStdinError = () => {};
    entry.onError = () => drop(true);
    entry.onExit = (code) => drop(!entry.ready || (code !== 0 && code !== null));
    child.stdin.on("error", entry.onStdinError);
    child.stdout.on("data", entry.onReadyData);
    child.on("error", entry.onError);
    child.on("exit", entry.onExit);
    if (typeof child.unref === "function") child.unref();
    for (const s of [child.stdin, child.stdout, child.stderr]) {
      if (s && typeof s.unref === "function") s.unref();
    }
    entry.readyTimer = setTimeout(() => {
      if (this.slot !== entry || entry.ready) return;
      drop(true);
      try { child.stdin.end(); } catch (error) {}
      try { if (child.exitCode === null) killTree(child, "SIGTERM"); } catch (error) {}
    }, this.readyTimeoutMs);
    if (typeof entry.readyTimer.unref === "function") entry.readyTimer.unref();
    entry.timer = setTimeout(() => {
      if (this.slot !== entry) return;
      this.evict();
    }, this.idleMs);
    if (typeof entry.timer.unref === "function") entry.timer.unref();
    this.slot = entry;
    return true;
  }
  take() {
    const entry = this.slot;
    // 未就绪（尚未收到 FSHR 握手）时不动槽位、直接回退普通启动，绝不把未确认的进程交给调用方
    if (!entry || !entry.ready) {
      this.misses += 1;
      return null;
    }
    this.slot = null;
    if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined; }
    if (entry.readyTimer !== undefined) { clearTimeout(entry.readyTimer); entry.readyTimer = undefined; }
    const { child } = entry;
    if (entry.onReadyData && child.stdout) child.stdout.removeListener("data", entry.onReadyData);
    if (entry.onError) child.removeListener("error", entry.onError);
    if (entry.onExit) child.removeListener("exit", entry.onExit);
    if (entry.dead || child.exitCode !== null || child.killed || !child.stdin || child.stdin.destroyed) {
      this.misses += 1;
      return null;
    }
    if (typeof child.ref === "function") child.ref();
    for (const s of [child.stdin, child.stdout, child.stderr]) {
      if (s && typeof s.ref === "function") s.ref();
    }
    this.hits += 1;
    return child;
  }
  evict() {
    if (this.warmTimer !== undefined) { clearTimeout(this.warmTimer); this.warmTimer = undefined; }
    if (this.probeTimer !== undefined) { clearTimeout(this.probeTimer); this.probeTimer = undefined; }
    if (this.probeChild) {
      const pc = this.probeChild;
      this.probeChild = null;
      try { if (pc.exitCode === null) killTree(pc, "SIGTERM"); } catch (error) {}
    }
    const entry = this.slot;
    this.slot = null;
    if (!entry) return;
    if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined; }
    if (entry.readyTimer !== undefined) { clearTimeout(entry.readyTimer); entry.readyTimer = undefined; }
    entry.dead = true;
    const { child } = entry;
    if (entry.onReadyData && child.stdout) child.stdout.removeListener("data", entry.onReadyData);
    if (entry.onError) child.removeListener("error", entry.onError);
    if (entry.onExit) child.removeListener("exit", entry.onExit);
    try { child.stdin.end(); } catch (error) {}
    try { if (child.exitCode === null) killTree(child, "SIGTERM"); } catch (error) {}
  }
  dispose() {
    this.disposed = true;
    ACTIVE_STANDBY_POOLS.delete(this);
    this.evict();
  }
}

/** timeoutMs → exe 的 --timeout 参数（秒，最多 3 位小数，至少 0.001）。 */
export function timeoutSeconds(timeoutMs) {
  const ms = Math.max(1, Math.round(Number(timeoutMs) || 0));
  return String(ms / 1000);
}

/**
 * 统一解析子进程退出码：按 spawnError.code 字符串先判 ENOENT(127) / EACCES|EPERM(126)
 * （Node 在 spawn 失败的 close 回调里可能给出负 libuv errno 如 -13，必须先于数值 code 判断），
 * 其余情况保留真实退出码。
 */
export function spawnExitCode(code, spawnError, killedBy = null) {
  if (spawnError?.code === "ENOENT") return 127;
  if (spawnError?.code === "EACCES" || spawnError?.code === "EPERM") return 126;
  if (typeof code === "number") return code;
  if (killedBy === "abort") return 130;
  if (killedBy === "guard") return 124;
  return spawnError ? 1 : 124;
}

/**
 * 运行一次 flash-sh；与宿主无关，便于单测。支持传入 standbyPool 复用预热待命进程。
 * 注：工具调用始终非交互、stdin 关闭（普通模式 stdio[0]="ignore"；--standby 模式在读完 FSH1 帧后
 * 立刻切为 NUL / /dev/null），不向命令传递 stdin。
 */
export function runFlashSh(bin, { command, cwd, timeoutMs, maxOutputBytes, signal, env, graceMs = GUARD_GRACE_MS, closeDeadlineMs = CLOSE_DEADLINE_MS, standbyPool = null }) {
  return new Promise((resolve) => {
    // 按实际毫秒传（1600 ms → "1.6"），不再向上取整成整秒：exe 的提示是 "timed out after 1.6s"（0.1.2 实机报告 P5）
    const secs = timeoutSeconds(timeoutMs);
    const effEnv = env ?? childEnv(process.env);
    let child = standbyPool ? standbyPool.take() : null;
    const viaStandby = child !== null;
    if (!viaStandby) {
      try {
        child = spawn(bin, ["--timeout", String(secs), "-c", command], {
          cwd,
          env: effEnv,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32", // POSIX：独立进程组，超时 / 取消时能连孙进程一起杀
        });
      } catch (error) {
        resolve({ exitCode: spawnExitCode(null, error, null), stdout: "", stderr: "", timedOut: false, truncated: false, error: errorText(error) });
        return;
      }
    }
    const out = new Capture(maxOutputBytes, "stdout");
    const err = new Capture(maxOutputBytes, "stderr");
    let gotOutput = false;
    child.stdout.on("data", (b) => { gotOutput = true; out.push(b); });
    child.stderr.on("data", (b) => { gotOutput = true; err.push(b); });
    let killedBy = null;
    let deadline;
    let settled = false;
    const armDeadline = () => {
      if (deadline !== undefined) return;
      deadline = setTimeout(() => {
        // 杀过了，close 还没来：多半是孙进程继承了 stdout/stderr 还活着。不再等，断开管道强行收尾。
        try { child.stdout.destroy(); } catch (error) {}
        try { child.stderr.destroy(); } catch (error) {}
        finish(null, null, "did not exit within " + closeDeadlineMs + " ms after being killed; output pipes closed by the plugin");
      }, closeDeadlineMs);
      if (typeof deadline.unref === "function") deadline.unref();
    };
    // 兜底：exe 自己会在 --timeout 到点时杀树并以 124 退出；这里多给 graceMs 宽限再硬杀
    const guard = setTimeout(() => {
      killedBy = "guard";
      killTree(child, "SIGKILL");
      armDeadline();
    }, Number(secs) * 1000 + graceMs);
    const onAbort = () => {
      killedBy = "abort";
      killTree(child, process.platform === "win32" ? "SIGTERM" : "SIGKILL");
      armDeadline();
    };
    const retryWithoutStandby = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (deadline !== undefined) clearTimeout(deadline);
      if (signal) signal.removeEventListener("abort", onAbort);
      try { child.stdout.destroy(); } catch (error) {}
      try { child.stderr.destroy(); } catch (error) {}
      try { if (child.exitCode === null) killTree(child, "SIGKILL"); } catch (error) {}
      runFlashSh(bin, { command, cwd, timeoutMs, maxOutputBytes, signal, env: effEnv, graceMs, closeDeadlineMs, standbyPool: null }).then(resolve);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    let spawnError;
    child.on("error", (e) => { spawnError = e; });
    const finish = (code, sig, stuck) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (deadline !== undefined) clearTimeout(deadline);
      if (signal) signal.removeEventListener("abort", onAbort);
      out.finish();
      err.finish();
      // 按 spawnError.code 字符串判断（Node 在 spawn 失败的 close 回调里可能给出负 libuv errno 如 -13，必须先查 code）
      const exitCode = spawnExitCode(code, spawnError, killedBy);
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
      if (stuck) problems.push(stuck);
      for (const c of [out, err]) {
        if (c.truncated && c.spillError) problems.push("could not save the full " + c.label + " (" + c.spillError + ")");
        else if (c.truncated && c.spillCapped) problems.push("full " + c.label + " saved only up to the " + (SPILL_TOTAL_CAP >> 20) + " MB spill cap");
        else if (c.truncated && !c.file) problems.push("full " + c.label + " not saved (spill cap reached)");
      }
      if (problems.length) result.error = problems.join("; ");
      resolve(result);
      // 返回结果后再在下一事件循环 tick 异步预热下一条命令的待命进程（不阻塞本次调用返回）
      if (standbyPool && !spawnError) {
        try { standbyPool.scheduleWarm(); } catch (error) {}
      }
    };
    child.on("close", (code, sig) => finish(code, sig));
    if (viaStandby && !killedBy) {
      if (child.exitCode !== null || child.killed || !child.stdin || child.stdin.destroyed) {
        retryWithoutStandby();
        return;
      }
      child.stdin.on("error", () => {
        if (!settled && !gotOutput && !killedBy) retryWithoutStandby();
      });
      try {
        const frame = encodeStandbyFrame({ timeoutMs: Math.round(Number(secs) * 1000), cwd, command, env: effEnv });
        child.stdin.end(frame);
      } catch (error) {
        if (!gotOutput && !killedBy) {
          retryWithoutStandby();
          return;
        }
        spawnError = error;
        try { killTree(child, "SIGKILL"); } catch (e2) {}
      }
    }
  });
}

/**
 * 解析 workdir（绝对，或相对于会话工作区）。Windows 上把 /d/x 这种 MSYS 写法换成 D:\x（与 flash-sh 的理解一致，
 * 也与审批分类器一致）；UNC / \\.\ 设备路径只在工作区本身就在同一个网络共享下时才允许——
 * 否则连 stat 都不做就拒绝（在 Windows 上，访问 \\host\share 本身就会向对方发起 SMB 认证）。
 */
export function resolveWorkdir(workdir, base, workspace, platform = process.platform, tmpdir = os.tmpdir()) {
  if (typeof workdir !== "string" || workdir.trim() === "") return base;
  const win = platform === "win32";
  const P = win ? path.win32 : path.posix;
  let wd = workdir;
  if (win && isMsysDrive(wd)) wd = wd[1].toUpperCase() + ":" + (wd.slice(2) || "\\");
  if (win && (wd === "/tmp" || wd.startsWith("/tmp/"))) wd = P.join(tmpdir, wd.slice(4) || ".");
  const cwd = P.isAbsolute(wd) && !(win && /^[\\/](?![\\/])/.test(wd)) ? P.resolve(wd) : P.resolve(base, wd);
  if (win && isUncLike(cwd)) {
    const rel = typeof workspace === "string" && isUncLike(workspace) ? P.relative(P.resolve(workspace), cwd) : "..";
    if (rel.startsWith("..") || P.isAbsolute(rel)) throw new Error("fl_bash: workdir on a network share or device path outside the workspace is not allowed: " + cwd);
  }
  return cwd;
}

export function toolDefinition(ctx, cfg, bin, opts = {}) {
  const known = ["command", "workdir", "timeoutMs", "description"];
  const memory = opts.memory ?? new SessionApprovals();
  const log = opts.log;
  const standbyPool = opts.standbyPool ?? null;
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
      if (extra.length > 0) throw new Error("fl_bash: unknown argument(s) " + extra.join(", ") + "; accepted: " + known.join(", "));
      if (typeof a.command !== "string" || a.command.trim() === "") throw new Error("fl_bash: command must be a non-empty string");
      let timeoutMs = a.timeoutMs === undefined ? cfg.timeoutMs : a.timeoutMs;
      if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("fl_bash: timeoutMs must be a positive number");
      timeoutMs = Math.min(timeoutMs, cfg.maxTimeoutMs);
      const workspace = await resolveCwd(ctx, exec);
      const base = workspace ?? process.cwd();
      const cwd = resolveWorkdir(a.workdir, base, workspace);
      let isDir = false;
      try { isDir = (await fs.promises.stat(cwd)).isDirectory(); } catch (error) {}
      if (!isDir) throw new Error("fl_bash: workdir is not an existing directory: " + cwd);
      await gate(ctx, cfg, exec, a.command, { cwd, workspace }, memory, log);
      return runFlashSh(bin, { command: a.command, cwd, timeoutMs, maxOutputBytes: cfg.maxOutputBytes, signal: exec.signal, env: childEnv(process.env), standbyPool });
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

// ── 进程级协调：两种装法同时启用时只注册一个 fl_bash ─────────────────────────────────────────
export const OWNERS = Object.freeze({
  "dsh-flash-presets": { priority: 2, label: "dsh-flash-presets（fl-bash 组件行）" },
  "fl-bash": { priority: 1, label: "fl-bash（单独安装，fl-bash-standalone 行）" },
});
const COORD_KEY = Symbol.for("dsh-flash-sh/coordinator@1");
/**
 * presets 一侧的意向（第二轮审计 T2：消除启动时的短暂双注册）。dsh-flash-presets 的 lib/bundle.js 按同一个 Symbol
 * 直接写这个全局对象（与本文件的 setPresetsIntent 等价）：
 *   pending  presets 的 fl-bash 组件行开始 apply，还没决定要不要提供 fl_bash
 *   loading  presets 的 fl-bash 组件行决定挂上，claim 稍后到
 *   none     不提供（fl-bash 行关 / 平台不对 / 加载失败 / 子功能不注册 / 行被卸载）
 *   claimed  presets 的 claim 已登记（由本文件的 createPlugin 写）
 * 字段：{ state, at, listeners: Set<fn> }；改 state 后逐个调用 listeners。
 */
export const PRESETS_INTENT_KEY = Symbol.for("dsh-flash-sh/presets-intent@1");
export function presetsIntent() {
  let o = globalThis[PRESETS_INTENT_KEY];
  if (!o || typeof o !== "object" || !(o.listeners instanceof Set)) {
    o = { state: undefined, at: undefined, listeners: new Set() };
    globalThis[PRESETS_INTENT_KEY] = o;
  }
  return o;
}
export function setPresetsIntent(state) {
  const o = presetsIntent();
  o.state = state;
  o.at = Date.now();
  for (const fn of [...o.listeners]) { try { fn(state); } catch (error) {} }
}

/** 独立行等 presets 表态的时限：知道 presets 的 fl-bash 行存在 / 已表态 pending 时等得久一些；完全不知道时只等一小会儿。 */
const DEFER = { long: 15000, short: 3000 };
/** 仅测试用：改等待时限。 */
export function _setDeferTimings(t = {}) { if (t.long !== undefined) DEFER.long = t.long; if (t.short !== undefined) DEFER.short = t.short; }

export function coordinator() {
  let c = globalThis[COORD_KEY];
  if (!c || !Array.isArray(c.claims)) {
    c = { claims: [], seq: 0, ours: new WeakSet() };
    globalThis[COORD_KEY] = c;
  }
  if (!(c.watchers instanceof Set)) c.watchers = new Set(); // 旧版协调器对象（同进程里还有旧版 dsh-flash-sh）没有这个字段
  return c;
}

/** 没有 layers 字段时的共同身份：DSH 每个进程只有一个工具注册表（cordis 根上的 ToolsService），各插件拿到的代理指向它。 */
export const SHARED_REGISTRY_KEY = Object.freeze({ toString: () => "[flash-sh shared tool registry]" });

/**
 * 工具注册表的身份。cordis 的 ctx.get("tools") 给每个插件上下文返回一个绑定了调用方的代理，
 * 代理对象各不相同；底层 ToolsService 的实例字段 layers（DSH 0.2.1-rc.5 / 0.2.2-rc.1 / 0.2.2-rc.3 都是
 * `layers = new ScopedLayers(...)`）经代理读出来是同一个对象，用它判同。
 * 字段不在（DSH 改了内部结构）时退回进程内共同的 SHARED_REGISTRY_KEY——仍然只注册一个、presets 仍然优先；
 * 绝不能退回代理对象本身（那样两边各算各的，第二个注册会撞名，谁先谁得）。
 */
export function registryKey(registry) {
  try {
    const layers = registry && registry.layers;
    if (layers !== null && layers !== undefined && (typeof layers === "object" || typeof layers === "function")) return layers;
  } catch (error) {}
  return SHARED_REGISTRY_KEY;
}

/** 在同一个工具注册表上的候选里选出应持有 fl_bash 的那个，并让其余的让位。 */
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
 * 从加载器的配置树里找 flash-presets 那一行（cordis-plugin-loader：ctx.fiber.entry.parent 是所在的 EntryGroup，
 * .data 是同级各行的 options）。返回 present / disabled / absent / unknown（拿不到配置树）。只当提示用，不当真。
 */
export function presetsRowHint(ctx) {
  try {
    let group = ctx && ctx.fiber && ctx.fiber.entry ? ctx.fiber.entry.parent : undefined;
    let seen = false;
    for (let depth = 0; group && depth < 8; depth++) {
      if (Array.isArray(group.data)) {
        seen = true;
        const row = group.data.find((o) => o && (o.id === "fl-bash" || o.name === "dsh-flash-presets/fl-bash"));
        if (row) return row.disabled === true ? "disabled" : "present";
      }
      const up = group.ctx && group.ctx.fiber && group.ctx.fiber.entry;
      group = up ? up.parent : undefined;
    }
    return seen ? "absent" : "unknown";
  } catch (error) {
    return "unknown";
  }
}

const COMPARED_FIELDS = ["approval", "approvalMemory", "timeoutMs", "maxTimeoutMs", "maxOutputBytes", "binPath", "allowNonWindows"];
/** 两边配置不同的字段（让位时写进 warn，告诉用户哪边生效）。 */
export function configDiff(a, b) {
  const out = [];
  for (const k of COMPARED_FIELDS) {
    const x = a ? a[k] : undefined;
    const y = b ? b[k] : undefined;
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(k + " (" + JSON.stringify(x) + " here vs " + JSON.stringify(y) + ")");
  }
  return out;
}

/**
 * 生成一个插件对象。owner 决定日志前缀与协调优先级：
 *   "fl-bash"（默认，独立包那一行） / "dsh-flash-presets"（presets 里的 fl-bash 组件行，优先）。
 * 独立行不会立刻注册：先确认 presets 那边会不会提供（见 PRESETS_INTENT_KEY / presetsRowHint），
 * 这样两包同开时启动阶段也不会出现「独立行先注册、presets 随后接管」的双注册窗口。
 */
export function createPlugin({ owner = "fl-bash" } = {}) {
  const meta = OWNERS[owner] ?? { priority: 0, label: owner };
  const prefix = owner === "fl-bash" ? "" : "(" + owner + ") ";
  const isPresets = owner === "dsh-flash-presets";
  function applyPlugin(ctx, config) {
    const log = makeLog(ctx, prefix);
    const cfg = resolveConfig(config);
    const d = decide(cfg);
    if (!d.register) {
      log("info", "fl_bash not registered: " + d.reason);
      if (isPresets) setPresetsIntent("none");
      return;
    }
    if (cfg.binSource === "env") log("info", "binPath taken from the environment variable DSH_FL_BASH_BIN / DSH_FLASH_SH_BIN=" + cfg.binPath);
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
      log("warn", "no tool registry; fl_bash not registered");
      if (isPresets) setPresetsIntent("none");
      return;
    }
    const standbyPool = new StandbyPool(d.bin);
    const definition = toolDefinition(ctx, cfg, d.bin, { log, standbyPool });
    const c = coordinator();
    const key = registryKey(registry);
    if (key === SHARED_REGISTRY_KEY) log("info", "tool registry has no 'layers' field (DSH internals changed?); coordinating on the process-wide registry instead");
    c.seq += 1;
    let dispose;
    let yieldedTo;
    const claim = {
      owner,
      priority: meta.priority,
      seq: c.seq,
      registry,
      key,
      cfg,
      active: false,
      waiting: false,
      activate() {
        if (claim.active) return;
        yieldedTo = undefined;
        const existing = lookup(registry, TOOL_NAME);
        if (existing !== undefined) {
          if (!claim.waiting) log("info", "fl_bash already registered by another plugin (not fl-bash / dsh-flash-presets); skipping, will take over if it goes away");
          claim.waiting = true;
          return;
        }
        try {
          dispose = registry.register(definition);
          c.ours.add(definition);
          claim.active = true;
          log("info", "fl_bash registered (" + d.bin + ")" + (claim.waiting ? " (took over after the other fl_bash went away)" : ""));
          // 只在真正生效时提醒（让位的那一行配置不生效，提醒它反而误导）
          if (cfg.approval === "off") log("warn", "approval is off: fl_bash runs every command without asking, outside the DSH sandbox");
          claim.waiting = false;
        } catch (error) {
          claim.waiting = true;
          // 撞名（对方与本插件同时注册）或 schema 被拒：只报告，不让插件激活失败
          log("warn", "fl_bash could not be registered: " + errorText(error));
        }
      },
      deactivate(winner) {
        if (!claim.active) return;
        claim.active = false;
        try { standbyPool.evict(); } catch (error) {}
        try { if (typeof dispose === "function") dispose(); } catch (error) {}
        dispose = undefined;
        log("info", "fl_bash handed over to " + winner.label + "; this row stays idle");
      },
      yieldTo(winner) {
        if (yieldedTo === winner) return;
        yieldedTo = winner;
        const diff = configDiff(cfg, winner.cfg);
        if (diff.length) log("warn", "fl_bash is provided by " + winner.label + "; " + meta.label + " skips registering it. Its settings differ and are NOT in effect: " + diff.join(", "));
        else log("info", "fl_bash is provided by " + winner.label + "; " + meta.label + " skips registering it");
      },
      label: meta.label,
    };
    // ── 何时入场 ──
    let joined = false;
    let timer;
    let released = false;
    const intent = presetsIntent();
    const onChange = () => { if (!joined && !released && readyToJoin()) join("presets " + (presetsClaimed() ? "claimed fl_bash" : "will not provide fl_bash")); };
    const presetsClaimed = () => c.claims.some((x) => x.owner === "dsh-flash-presets" && x.key === key);
    const readyToJoin = () => {
      if (isPresets || presetsClaimed()) return true;
      const st = intent.state;
      if (st === "none") return true;
      if (st === "pending" || st === "loading" || st === "claimed") return false;
      const hint = presetsRowHint(ctx);
      return hint === "absent" || hint === "disabled";
    };
    const unwatch = () => {
      intent.listeners.delete(onChange);
      c.watchers.delete(onChange);
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    };
    const join = (why) => {
      if (joined || released) return;
      joined = true;
      unwatch();
      if (!isPresets && why) log("info", "standalone row joins after waiting: " + why);
      c.claims.push(claim);
      if (isPresets) setPresetsIntent("claimed");
      for (const w of [...c.watchers]) { try { w(); } catch (error) {} }
      elect(key);
    };
    const release = () => {
      released = true;
      unwatch();
      try { standbyPool.dispose(); } catch (error) {}
      const i = c.claims.indexOf(claim);
      if (i >= 0) c.claims.splice(i, 1);
      if (claim.active) {
        claim.active = false;
        try { if (typeof dispose === "function") dispose(); } catch (error) {}
      }
      if (isPresets) setPresetsIntent("none");
      // 让剩下的候选接手（宿主自己也会因为注册随 ctx 释放而发 tools/change）
      if (joined) { try { elect(key); } catch (error) {} }
    };
    let bound = false;
    try {
      if (typeof ctx.effect === "function") { ctx.effect(() => release, "fl-bash claim"); bound = true; }
    } catch (error) {}
    if (!bound) {
      try { if (typeof ctx.on === "function") ctx.on("dispose", release); } catch (error) {}
    }
    if (readyToJoin()) join();
    else {
      const st = intent.state;
      const hint = presetsRowHint(ctx);
      const wait = st === "pending" || st === "loading" || st === "claimed" || hint === "present" ? DEFER.long : DEFER.short;
      log("info", "waiting up to " + wait + " ms for dsh-flash-presets to report whether it provides fl_bash (intent=" + (st ?? "none-yet") + ", presets fl-bash row: " + hint + ")");
      intent.listeners.add(onChange);
      c.watchers.add(onChange);
      timer = setTimeout(() => {
        timer = undefined;
        if (joined || released) return;
        log(hint === "present" || st !== undefined ? "warn" : "info", "dsh-flash-presets did not report within " + wait + " ms; the standalone row registers fl_bash (if presets claims it later, it takes over)");
        join();
      }, wait);
      if (typeof timer.unref === "function") timer.unref();
    }
    if (typeof ctx.on === "function") {
      // 第三方的 fl_bash 被注销后补上
      try {
        ctx.on("tools/change", () => {
          if (c.claims.includes(claim) && claim.waiting && !claim.active && lookup(registry, TOOL_NAME) === undefined) elect(key);
        });
      } catch (error) {}
    }
  }
  return { name, inject, Config, apply: applyPlugin };
}

const standalone = createPlugin({ owner: "fl-bash" });
export const apply = standalone.apply;
export default standalone;
