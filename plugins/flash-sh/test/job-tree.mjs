#!/usr/bin/env node
// 进程树收尾回归（0.1.2）：Windows 上 Job Object 改为「第一次起子进程前才建」，这里确认 --timeout 和父进程被杀两条路
// 仍然带走整棵树（子进程、后台任务、find -exec / xargs 起的孙进程）。
//   node test/job-tree.mjs [flash-sh 可执行文件]
// 判定：每条用例退出码 124 且 8 s 内返回；Windows 上结束后不许残留 flash-sh.exe 进程。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = process.argv[2] || process.env.FLASH_SH_TEST_BIN || path.join(here, "..", "vendor", "win32-x64", "flash-sh.exe");
if (!fs.existsSync(bin)) {
  if (process.env.FLASH_SH_REQUIRE_BIN) {
    console.error("job-tree：找不到 " + bin);
    process.exit(1);
  }
  console.log("job-tree：跳过（找不到 " + bin + "）");
  process.exit(0);
}
const isWin = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function leftovers() {
  if (!isWin) return 0;
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq " + path.basename(bin), "/NH", "/FO", "CSV"], { encoding: "utf8" });
  return (r.stdout || "").split(/\r?\n/).filter((l) => l.toLowerCase().includes(path.basename(bin).toLowerCase())).length;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-jt-"));
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
console.log("job-tree（" + bin + "）");
for (const [label, cmd, only] of CASES) {
  if (only === "win" && !isWin) {
    console.log("  skip " + label + "（仅 Windows 判定）");
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(bin, ["--timeout", "2", "-c", cmd], { cwd: dir, encoding: "utf8", timeout: 20000, windowsHide: true });
  const ms = Date.now() - t0;
  await sleep(500);
  const left = leftovers();
  const good = r.status === 124 && ms < 8000 && left === 0;
  if (!good) failed++;
  console.log((good ? "  ok  " : "  FAIL") + " " + label + "：rc=" + r.status + " " + ms + " ms" + (isWin ? " 残留=" + left : ""));
}
// 父进程被强杀（不带 /T）：子进程必须随 Job 关闭一起结束（KILL_ON_JOB_CLOSE）
if (isWin) {
  const p = spawn(bin, ["-c", "sleep 30 & sleep 30; wait"], { cwd: dir, windowsHide: true, stdio: "ignore" });
  await sleep(1500);
  const before = leftovers();
  spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/F", "/PID", String(p.pid)], { encoding: "utf8" });
  await sleep(1500);
  const left = leftovers();
  const good = before >= 2 && left === 0;
  if (!good) failed++;
  console.log((good ? "  ok  " : "  FAIL") + " 父进程被 taskkill /F（不带 /T）：杀前 " + before + " 个，杀后残留 " + left);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? "job-tree：" + failed + " 条失败" : "job-tree：全部通过");
process.exit(failed ? 1 : 0);
