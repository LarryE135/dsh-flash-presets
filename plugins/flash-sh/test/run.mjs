#!/usr/bin/env node
// dsh-flash-sh 自测入口（npm test）：
//   node test/run.mjs                                   unit（必跑；不需要 DSH、不需要二进制）
//   FLASH_SH_TEST_BIN=/path/flash-sh node test/run.mjs  + host（真实 cordis + dsh-tools 宿主：注册/执行/超时/截断/取消/审批/撞名）
//   DSH_REAL_NM=/path/node_modules FLASH_SH_TEST_BIN=... node test/run.mjs
//                                                       + real-dsh（真实 DSH 安装：plugin add tgz / dump-config / 启动注册；需要 bash）
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", cwd: path.resolve(dir, "..") }).status === 0;
let ok = run(process.execPath, [path.join(dir, "unit.mjs")]);
ok = run(process.execPath, [path.join(dir, "host.mjs")]) && ok;
if (process.env.DSH_REAL_NM) ok = run("bash", [path.join(dir, "real-dsh.sh")]) && ok;
else console.log("real-dsh：跳过（未设置 DSH_REAL_NM）");
console.log(ok ? "dsh-flash-sh 自测：全部通过" : "dsh-flash-sh 自测：有失败");
process.exit(ok ? 0 : 1);
