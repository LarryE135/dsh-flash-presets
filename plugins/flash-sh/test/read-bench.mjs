#!/usr/bin/env node
// 逐行 read 吞吐计时（0.1.2：管道 / here-string / heredoc 改用 peek，不再逐字节读）+ 启动开销拆分。只打印，不判失败。
// 对照：同一个 exe 加 FLASH_SH_READ_BYTES=1（强制逐字节读，即 0.1.1 在管道上的读法）；有 Git Bash 时一并计时。
//   node test/read-bench.mjs [flash-sh 可执行文件] [次数，默认 5]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = process.argv[2] || process.env.FLASH_SH_TEST_BIN || path.join(here, "..", "vendor", "win32-x64", "flash-sh.exe");
const runs = Number(process.argv[3] || 5);
if (!fs.existsSync(bin)) {
  console.log("read 计时：跳过（找不到 " + bin + "）");
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-rb-"));
fs.writeFileSync(path.join(dir, "lines200k.txt"), Array.from({ length: 200000 }, (_, i) => "line" + i).join("\n") + "\n");
const CASES = [
  ["管道 10 万行（seq | while read）", "seq 1 100000 | while read -r l; do :; done"],
  ["管道 100 万行", "seq 1 1000000 | while read -r l; do :; done"],
  ["heredoc 1 万行", "while read -r l; do :; done <<EOF\n$(seq 1 10000)\nEOF"],
  ["here-string 2 万行", "s=$(seq 1 20000); while read -r l; do :; done <<< \"$s\""],
  ["文件重定向 20 万行", "while read -r l; do :; done < lines200k.txt"],
  ["readarray 10 万行（管道）", "seq 1 100000 | { readarray -t a; echo ${#a[@]}; }"],
];
const gitBash = process.platform === "win32" ? ["C:\\Program Files\\Git\\bin\\bash.exe"].find((p) => fs.existsSync(p)) : "/bin/bash";
const shells = [["flash-sh", bin, {}], ["flash-sh 逐字节（=0.1.1 管道读法）", bin, { FLASH_SH_READ_BYTES: "1" }]];
if (gitBash) shells.push([process.platform === "win32" ? "Git Bash" : "bash", gitBash, {}]);
function med(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
console.log("read 吞吐（" + bin + "，每项 " + runs + " 次取中位数，单位 ms）");
console.log(["用例", ...shells.map((s) => s[0])].join(" | "));
for (const [label, script] of CASES) {
  const cells = [];
  for (const [, exe, extra] of shells) {
    const ts = [];
    let rc = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const r = spawnSync(exe, ["-c", script], { cwd: dir, env: { ...process.env, ...extra }, encoding: "utf8", timeout: 300000, windowsHide: true });
      ts.push(performance.now() - t0);
      rc = r.status;
    }
    cells.push(med(ts).toFixed(0) + (rc === 0 ? "" : " (rc" + rc + ")"));
  }
  console.log([label, ...cells].join(" | "));
}
// 启动：同一台机器上「起一个最小的系统程序」是进程创建本身的下限；flash-sh --version 不建 shell，-c : 建 shell 但不跑命令。
const sys32 = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32") : null;
const START = [
  ["系统程序（进程创建下限）", sys32 ? path.join(sys32, "whoami.exe") : "/bin/true", []],
  ["flash-sh --version", bin, ["--version"]],
  ["flash-sh -c :", bin, ["-c", ":"]],
];
if (gitBash) START.push([(process.platform === "win32" ? "Git Bash" : "bash") + " -c :", gitBash, ["-c", ":"]]);
console.log("\n启动（各 21 次取中位数，单位 ms）");
for (const [label, exe, args] of START) {
  if (!fs.existsSync(exe)) continue;
  const ts = [];
  for (let i = 0; i < 21; i++) {
    const t0 = performance.now();
    spawnSync(exe, args, { cwd: dir, encoding: "utf8", windowsHide: true });
    ts.push(performance.now() - t0);
  }
  console.log(label + " | " + med(ts).toFixed(1));
}
fs.rmSync(dir, { recursive: true, force: true });
