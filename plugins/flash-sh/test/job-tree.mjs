#!/usr/bin/env node
// 进程树收尾回归（0.1.2）：Windows 上 Job Object 改为「第一次起子进程前才建」，这里确认 --timeout 和父进程被杀两条路
// 仍然带走整棵树（子进程、后台任务、find -exec / xargs 起的孙进程）。
//   node test/job-tree.mjs [flash-sh 可执行文件]
// 判定：每条用例退出码 124 且 8 s 内返回；Windows 上结束后不许残留本次测试起的 flash-sh 进程。
// 隔离（0.1.6）：先把被测 exe 拷到本次独有的临时目录再跑。flash-sh 起子进程、awk/find 回调都用 current_exe，
// 整棵树的 ExecutablePath 都是这份拷贝，残留只按这条路径数，不会把别的测试或 DSH 里正在跑的 flash-sh 算进来。
// 拿不到路径（没有 PowerShell）时退回按映像名全局计数，并提示此时不能与其他 flash-sh 负载并发。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcBin = process.argv[2] || process.env.FLASH_SH_TEST_BIN || path.join(here, "..", "vendor", "win32-x64", "flash-sh.exe");
if (!fs.existsSync(srcBin)) {
  if (process.env.FLASH_SH_REQUIRE_BIN) {
    console.error("job-tree：找不到 " + srcBin);
    process.exit(1);
  }
  console.log("job-tree：跳过（找不到 " + srcBin + "）");
  process.exit(0);
}
const isWin = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-jt-"));
const binDir = path.join(dir, "bin");
const work = path.join(dir, "work");
fs.mkdirSync(binDir);
fs.mkdirSync(work);
const bin = path.join(binDir, path.basename(srcBin));
fs.copyFileSync(srcBin, bin);
if (!isWin) fs.chmodSync(bin, 0o755);
function psExe() {
  for (const c of ["pwsh", path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")]) {
    const r = spawnSync(c, ["-NoProfile", "-NonInteractive", "-Command", "1"], { encoding: "utf8", windowsHide: true });
    if (r.status === 0) return c;
  }
  return null;
}
const ps = isWin ? psExe() : null;
let scoped = !isWin || !!ps;
// 只数 ExecutablePath 等于本次拷贝的进程
function leftovers() {
  if (!isWin) return 0;
  if (ps) {
    const q = "$p='" + bin.replace(/'/g, "''") + "';" +
      "@(Get-CimInstance Win32_Process -Filter \"Name='" + path.basename(bin) + "'\" | Where-Object { $_.ExecutablePath -eq $p }).Count";
    const r = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", q], { encoding: "utf8", windowsHide: true });
    const n = parseInt((r.stdout || "").trim(), 10);
    if (r.status === 0 && Number.isFinite(n)) return n;
    scoped = false;
  }
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq " + path.basename(bin), "/NH", "/FO", "CSV"], { encoding: "utf8" });
  return (r.stdout || "").split(/\r?\n/).filter((l) => l.toLowerCase().includes(path.basename(bin).toLowerCase())).length;
}
const CASES = [
  ["子进程（applet）", "sleep 30"],
  ["后台任务 + wait", "sleep 30 & sleep 30 & wait"],
  ["子 shell", "( sleep 30 )"],
  // 下面两条在 Linux 构建上收不干净（孙进程里的 applet 自己另开进程组，--timeout 只杀到子进程组；已知差距），
  // 发行目标是 Windows（孙进程继承 Job），所以只在 Windows 上判定。
  ["find -exec 起的孙进程", "find . -maxdepth 0 -exec sleep 30 \\;", "win"],
  ["xargs 起的孙进程", "echo x | xargs -I{} sleep 30", "win"],
  ["先跑纯内建再起子进程", "i=0; while (( i < 1000 )); do i=$((i+1)); done; sleep 30"],
];
let failed = 0;
// 诱饵：用原路径的 exe 在旁边一直跑，模拟「别的 flash-sh 负载」。计数若没隔离好，每条用例都会多出残留而失败。
let decoy = null;
if (isWin && ps) decoy = spawn(srcBin, ["-c", "sleep 120"], { cwd: work, windowsHide: true, stdio: "ignore" });
console.log("job-tree（" + srcBin + "）" + (isWin ? (ps ? "；残留只数本次拷贝 " + bin : "；⚠ 没有 PowerShell，按映像名全局计数，不能与其他 flash-sh 负载并发") : ""));
for (const [label, cmd, only] of CASES) {
  if (only === "win" && !isWin) {
    console.log("  skip " + label + "（仅 Windows 判定）");
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(bin, ["--timeout", "2", "-c", cmd], { cwd: work, encoding: "utf8", timeout: 20000, windowsHide: true });
  const ms = Date.now() - t0;
  await sleep(500);
  const left = leftovers();
  const good = r.status === 124 && ms < 8000 && left === 0;
  if (!good) failed++;
  console.log((good ? "  ok  " : "  FAIL") + " " + label + "：rc=" + r.status + " " + ms + " ms" + (isWin ? " 残留=" + left : ""));
}
// 父进程被强杀（不带 /T）：子进程必须随 Job 关闭一起结束（KILL_ON_JOB_CLOSE）
if (isWin) {
  const p = spawn(bin, ["-c", "sleep 30 & sleep 30; wait"], { cwd: work, windowsHide: true, stdio: "ignore" });
  await sleep(1500);
  const before = leftovers();
  spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/F", "/PID", String(p.pid)], { encoding: "utf8" });
  await sleep(1500);
  const left = leftovers();
  const good = before >= 2 && left === 0;
  if (!good) failed++;
  console.log((good ? "  ok  " : "  FAIL") + " 父进程被 taskkill /F（不带 /T）：杀前 " + before + " 个，杀后残留 " + left);
}
if (decoy) {
  console.log("  （并发诱饵进程 pid " + decoy.pid + " 全程在跑，未计入残留）");
  spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/F", "/T", "/PID", String(decoy.pid)], { encoding: "utf8" });
}
if (isWin && !scoped) console.log("  ⚠ 本轮有计数退回了全局映像名统计；若同时有别的 flash-sh 在跑，残留数可能偏大");
try {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
} catch (e) {
  console.log("  （临时目录没删掉：" + e.message + "）");
}
console.log(failed ? "job-tree：" + failed + " 条失败" : "job-tree：全部通过");
process.exit(failed ? 1 : 0);
