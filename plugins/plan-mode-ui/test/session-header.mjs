// sessionHeader 的路径解析：会话 id 自带 "session-" 前缀，目录名就是这个 id。
// 0.2.6 之前的写法是 "session-" + id → "session-session-…"，永远落空（isSubagent 恒为假）。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

let seq = 0;
const home = mkdtempSync(join(tmpdir(), "pmui-hdr-"));
process.env.DSH_HOME = home;

const uuid = "0f8e8a4e-1c2d-4b3a-9f10-2a7b6c5d4e3f";
const cwd = "/home/tester/proj";
const projectDir = "--home-tester-proj--";
const sessionDir = join(home, "sessions", projectDir, "session-" + uuid);
mkdirSync(sessionDir, { recursive: true });
const header = {
  type: "session", version: 4, id: "session-" + uuid, createdAt: Date.now(),
  cwd, isSeeded: false, delegationDepth: 2, agentPreset: "flash-lean-ptc-v3"
};
writeFileSync(join(sessionDir, "session.v4.jsonl.zstd"), zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + "\n", "utf8")));

const { __sessionHeaderForTest } = await import("../lib/index.js?hdr" + (++seq) + "-" + Date.now());

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (error) { failed++; console.log("  FAIL " + name + " :: " + (error && error.message)); }
};
const eq = (actual, expected, what) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((what || "值") + " 期望 " + b + "，实际 " + a);
};

// 1) 带前缀的 id（DSH 的真实形式）：必须命中
check("session-<uuid> → 读出 cwd 与 delegationDepth", () => {
  const head = __sessionHeaderForTest({ id: "session-" + uuid });
  eq(head, { cwd, delegationDepth: 2 }, "header");
});

// 2) 裸 uuid（老布局/别处传进来的形式）：也要命中
check("裸 uuid → 同样命中", () => {
  const head = __sessionHeaderForTest({ sessionId: uuid });
  eq(head, { cwd, delegationDepth: 2 }, "header");
});

// 3) 缓存：文件删掉后仍然返回上次结果（证明走的是 cache 而不是每次读盘）
check("命中后走缓存（删文件仍返回）", () => {
  rmSync(join(sessionDir, "session.v4.jsonl.zstd"));
  const head = __sessionHeaderForTest({ id: "session-" + uuid });
  eq(head, { cwd, delegationDepth: 2 }, "cached header");
});

// 4) 未知 id → null（不抛）
check("未知 id → null", () => {
  eq(__sessionHeaderForTest({ id: "session-does-not-exist" }), null, "header");
});

// 5) 没有 id 的会话对象 → null（不抛）
check("无 id → null", () => {
  eq(__sessionHeaderForTest({}), null, "header");
  eq(__sessionHeaderForTest(undefined), null, "header(undefined)");
});

console.log("\nsession-header: passed " + passed + ", failed " + failed);
process.exit(failed === 0 ? 0 : 1);
