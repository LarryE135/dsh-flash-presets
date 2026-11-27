// 待命池数据面回归：命中 --standby 待命进程时，大输出必须和 -c 直连结果一致（不能卡到超时）。
// 用法：node test/standby-output.mjs <flash-sh 二进制>（需 0.1.9 及以上，支持 FSHR 握手）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const arg = process.argv[2] || process.env.FLASH_SH_TEST_BIN;
if (!arg) { console.log("SKIP standby-output：未给二进制"); process.exit(0); }
const bin = path.resolve(arg);
const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(pathToFileURL(path.join(here, "..", "lib", "index.js")).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env };
const cwd = os.tmpdir();

async function warmPool() {
  const pool = new m.StandbyPool(bin);
  pool.probeState = "ok";
  pool.warm();
  for (let i = 0; i < 50 && !(pool.slot && pool.slot.ready); i++) await sleep(50);
  assert.ok(pool.slot && pool.slot.ready, "待命进程没有就绪");
  return pool;
}

let pass = 0;
// 28000 行约 140 KB：超过管道缓冲；200000 行约 1.2 MB：走溢出落盘
for (const n of [28000, 200000]) {
  const direct = await m.runFlashSh(bin, { command: "seq 1 " + n, cwd, timeoutMs: 10000, maxOutputBytes: 30000, env, standbyPool: null });
  const pool = await warmPool();
  try {
    const t = Date.now();
    const r = await m.runFlashSh(bin, { command: "seq 1 " + n, cwd, timeoutMs: 10000, maxOutputBytes: 30000, env, standbyPool: pool });
    assert.equal(r.timedOut, false, `seq 1 ${n} 待命路径超时（${Date.now() - t} ms）`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, direct.stdout, `seq 1 ${n} 待命路径与直连输出不同`);
    if (r.spillPath) {
      const lines = fs.readFileSync(r.spillPath, "utf8").trim().split("\n");
      assert.equal(lines.length, n);
      assert.equal(lines[0], "1");
      assert.equal(lines[n - 1], String(n));
    }
    pass++;
  } finally { pool.dispose(); }
}
console.log(`standby-output：${pass}/2 通过`);
