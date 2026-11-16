# PTC 重声明自动重试（实验）

`run_code` 的运行时（`dsh-ptc-runtime-node`）用 `node:repl` + `repl.eval` 在**同一上下文**里跑每条程序，
顶层 `const/let` 会跨调用持久化，同名再声明就抛 `Identifier 'x' has already been declared`。

本目录用 ESM loader 在加载时改写该模块（不改全局安装、不需要 root）：命中重声明错误时，
把这条程序用 `;{ ... }` 块级包裹**自动重试一次**；重试也失败才把原错误回传模型。

## 启用

```bash
export NODE_OPTIONS=--import=/home/larry/Common/dsh-flash-presets/scripts/ptc-redeclare-fix/register.mjs
dsh web --profile web
```

systemd 常驻服务则在 unit 里加 `Environment=NODE_OPTIONS=--import=...`。
命中情况写在 `/tmp/ptc-patch.log`（每次加载一行 `PATCHED <bytes> <url>`）。
撤销 = 去掉这个环境变量。

## 证据

- 会话审计：2,111 条 `run_code` 里 120 条失败，其中 **57 条是重声明**；这 57 条**全部**满足
  「名字由更早程序声明过 + 本条又在自己顶层声明 + 本条没有自带块包裹」——补丁正好覆盖这一类。
- `node:repl` 复现：块级包裹后 12/12 不再报重声明。
- 锚点校验：真实 bundle（261,607 B）里两处锚点均存在，改写后 259,865 B 且可正常解析。

## 覆盖不到的部分

其余 63 条失败（超时 11、内层工具报错 21、语法错 18、其它）与重声明无关，不受此补丁影响。
## 实测结论：本机（非 root）打不上这个补丁

1. 用 `NODE_OPTIONS=--import=.../register.mjs` 启动 `dsh web --port 3082`，主进程能加载补丁
   （`/tmp/ptc-patch.log` 有 `PATCHED` 行）。
2. **但真正执行程序的不是主进程**：PTC 运行时是 dsh 派生出的子进程
   （`node --max-old-space-size=512 --experimental-vm-modules .../process.js`）。
3. 实测该子进程的环境里 **没有 `NODE_OPTIONS`**（父进程有、子进程没有），所以 loader 到不了真正求值的地方。
4. 结果：在 3082（带补丁启动）上跑「三次都用 `const r`」，第 2、3 次仍然报
   `Uncaught SyntaxError: Identifier 'r' has already been declared` —— 补丁未生效。

根因不在 loader 写法，而在 dsh 派生子进程时没有把 `NODE_OPTIONS` 传下去（`dsh-ptc-runtime-node/lib/index.js` 里
`env` 由 `process.env` 过滤 `PATH/PATHEXT/SYSTEMROOT/WINDIR/TEMP/TMP` 后构造，且沙箱化启动时另有一套 argv/env）。

因此本地可行路线只剩两条：

- **上游**：把 `evaluate()` 的重声明重试做进 `dsh-ptc-runtime-node`（本目录 loader.mjs 里的注入代码可直接照搬）。
- **提示词**：在预设里加一条「同一会话内 `run_code` 变量名不要重复，或整段用 `{}` 包裹」。
  注意模型多数时候会自己改名（r1/r2/r3），所以规则只能减少、不能消除；长会话才会暴露。