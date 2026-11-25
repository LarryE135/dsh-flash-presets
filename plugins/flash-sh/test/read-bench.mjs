#!/usr/bin/env node
// 逐行 read 吞吐计时 + 启动开销拆分。只打印，不判失败。
// 0.1.3：本 shell 自建、没交给别的进程/并发任务的管道和文件，read 不再每行都向系统取一次（延迟交还）。
// 对照：同一个 exe 加 FLASH_SH_READ_BYTES=1（强制逐字节读，即 0.1.1 在管道上的读法）；有 Git Bash 时一并计时。
// 每个 shell 每项先跑一次计数版（循环体 n=$((n+1))），行数不对标 BAD：计时用的 `do :; done` 不数行，
// 只读了一部分行的实现也会显得很快（下游测 0.1.0 的管道数字就是这样来的）。
//   node test/read-bench.mjs [flash-sh 可执行文件] [次数，默认 5] [--ref 另一个 exe（只计数+计时，如 0.1.0）] [--json 输出文件]
// --json（0.1.6）：另写一份机器可读结果（每项全部样本、中位数、行数是否正确、exe 版本与 sha256、平台），便于 CI 与基线自动比对。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const ri = argv.indexOf("--ref");
const ref = ri >= 0 ? argv.splice(ri, 2)[1] : null;
const ji = argv.indexOf("--json");
const jsonOut = ji >= 0 ? argv.splice(ji, 2)[1] : null;
const bin = argv[0] || process.env.FLASH_SH_TEST_BIN || path.join(here, "..", "vendor", "win32-x64", "flash-sh.exe");
const runs = Number(argv[1] || 5);
if (!fs.existsSync(bin)) {
  console.log("read 计时：跳过（找不到 " + bin + "）");
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-rb-"));
fs.writeFileSync(path.join(dir, "lines200k.txt"), Array.from({ length: 200000 }, (_, i) => "line" + i).join("\n") + "\n");
// [标签, 计时脚本, 计数脚本, 期望行数]
const CASES = [
  ["管道 10 万行（seq | while read）", "seq 1 100000 | while read -r l; do :; done", "seq 1 100000 | { n=0; while read -r l; do n=$((n+1)); done; echo $n; }", 100000],
  ["管道 100 万行", "seq 1 1000000 | while read -r l; do :; done", "seq 1 1000000 | { n=0; while read -r l; do n=$((n+1)); done; echo $n; }", 1000000],
  ["heredoc 1 万行", "while read -r l; do :; done <<EOF\n$(seq 1 10000)\nEOF", "n=0; while read -r l; do n=$((n+1)); done <<EOF\n$(seq 1 10000)\nEOF\necho $n", 10000],
  ["here-string 2 万行", "s=$(seq 1 20000); while read -r l; do :; done <<< \"$s\"", "s=$(seq 1 20000); n=0; while read -r l; do n=$((n+1)); done <<< \"$s\"; echo $n", 20000],
  ["文件重定向 20 万行", "while read -r l; do :; done < lines200k.txt", "n=0; while read -r l; do n=$((n+1)); done < lines200k.txt; echo $n", 200000],
  ["readarray 10 万行（管道）", "seq 1 100000 | { readarray -t a; echo ${#a[@]}; }", "seq 1 100000 | { readarray -t a; echo ${#a[@]}; }", 100000],
];
const gitBash = process.platform === "win32" ? ["C:\\Program Files\\Git\\bin\\bash.exe"].find((p) => fs.existsSync(p)) : "/bin/bash";
const shells = [["flash-sh", bin, {}], ["flash-sh 逐字节（=0.1.1 管道读法）", bin, { FLASH_SH_READ_BYTES: "1" }]];
if (ref && fs.existsSync(ref)) shells.push(["对照 " + path.basename(ref), ref, {}]);
if (gitBash) shells.push([process.platform === "win32" ? "Git Bash" : "bash", gitBash, {}]);
function med(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
const report = {
  schema: 1,
  date: new Date().toISOString(),
  platform: process.platform + "-" + process.arch,
  runs,
  shells: shells.map(([name, exe]) => {
    const v = spawnSync(exe, ["--version"], { encoding: "utf8", windowsHide: true });
    let sha256 = null;
    try {
      sha256 = crypto.createHash("sha256").update(fs.readFileSync(exe)).digest("hex");
    } catch {}
    return { name, exe, version: ((v.stdout || "").split(/\r?\n/)[0] || "").trim(), sha256 };
  }),
  cases: [],
  startup: [],
};
console.log("read 吞吐（" + bin + "，每项 " + runs + " 次取中位数，单位 ms；行数都对时不标注）");
console.log(["用例", ...shells.map((s) => s[0])].join(" | "));
for (const [label, script, count, want] of CASES) {
  const cells = [];
  const jc = { label, expectLines: want, results: [] };
  report.cases.push(jc);
  for (const [name, exe, extra] of shells) {
    const c = spawnSync(exe, ["-c", count], { cwd: dir, env: { ...process.env, ...extra }, encoding: "utf8", timeout: 300000, windowsHide: true });
    const got = (c.stdout || "").trim();
    const lines = got === String(want) ? "" : " 行数BAD:" + (got || "?");
    const ts = [];
    let rc = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const r = spawnSync(exe, ["-c", script], { cwd: dir, env: { ...process.env, ...extra }, encoding: "utf8", timeout: 300000, windowsHide: true });
      ts.push(performance.now() - t0);
      rc = r.status;
    }
    jc.results.push({ shell: name, medianMs: +med(ts).toFixed(1), samplesMs: ts.map((t) => +t.toFixed(1)), rc, lines: got, linesOk: lines === "" });
    cells.push(med(ts).toFixed(0) + (rc === 0 ? "" : " (rc" + rc + ")") + lines);
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
  report.startup.push({ label, medianMs: +med(ts).toFixed(1), samplesMs: ts.map((t) => +t.toFixed(1)) });
}
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
  console.log("\nJSON 结果已写入 " + jsonOut);
}
fs.rmSync(dir, { recursive: true, force: true });
