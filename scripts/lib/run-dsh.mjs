// Windows 上 `npm i -g @deepseek-ai/dsh` 装出来的是 dsh.cmd（没有 dsh.exe）：
//   execFileSync('dsh', …)     → 不走 shell，不做 PATHEXT 解析 → ENOENT
//   execFileSync('dsh.cmd', …) → 撞上 Node 的 CVE-2024-27980 修复 → EINVAL
// 唯一可行：先按 PATH/PATHEXT 解析出真实 shim，.cmd/.bat 交给 shell 并自己加引号。
// 这是 issue #23 的统一修法：7 处调用点都走这里，不要再各写一遍。
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const IS_WIN = process.platform === 'win32';
const WIN_NAMES = ['dsh.exe', 'dsh.cmd', 'dsh.bat'];

function executableOnPosix(file) {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch { return false; }
}

function pathDirs() {
  return (process.env.PATH || process.env.Path || '').split(delimiter).filter(Boolean);
}

// 解析出要执行的命令形态：
//   POSIX  → PATH 里第一个可执行的 dsh（拿绝对路径，找不到就交给 shell 兜底）
//   Windows→ PATH 里第一个 dsh.exe / dsh.cmd / dsh.bat；.cmd/.bat 必须走 shell（CVE-2024-27980）
export function resolveDsh() {
  const dirs = pathDirs();
  if (!IS_WIN) {
    for (const dir of dirs) {
      const candidate = join(dir, 'dsh');
      if (executableOnPosix(candidate)) return { file: candidate, shell: false, how: 'path' };
    }
    return { file: 'dsh', shell: false, how: 'path-fallback' };
  }
  for (const name of WIN_NAMES) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return { file: candidate, shell: /\.(cmd|bat)$/i.test(name), how: 'pathext' };
    }
  }
  return { file: 'dsh', shell: true, how: 'shell-fallback' };
}

const quoteWin = (value) => {
  const s = String(value);
  return /[\s"&|<>^()]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// 与 execFileSync 同签名（第一个参数是参数数组，不是命令）。
export function runDsh(args, options = {}) {
  const { file, shell } = resolveDsh();
  const opts = { encoding: 'utf8', ...options };
  if (!shell) return execFileSync(file, args, opts);
  const line = [quoteWin(file), ...args.map(quoteWin)].join(' ');
  return execFileSync(line, { ...opts, shell: true });
}

// 需要同时拿到 stdout 和 stderr 时用它（execFileSync 只回 stdout，而 dsh 的
// 「disabling profile plugin row …」告警只写在 stderr 上）。返回 { status, stdout, stderr }，不抛。
export function runDshCapture(args, options = {}) {
  const { file, shell } = resolveDsh();
  const opts = { encoding: 'utf8', ...options };
  if (!shell) return spawnSync(file, args, opts);
  const line = [quoteWin(file), ...args.map(quoteWin)].join(' ');
  return spawnSync(line, { ...opts, shell: true });
}

// 只想知道「CLI 在不在、能不能调起来」时用它：拿不到就返回 null，不抛。
export function tryDshVersion() {
  try {
    return runDsh(['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
