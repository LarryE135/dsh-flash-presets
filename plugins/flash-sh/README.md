# dsh-flash-sh

给 DeepSeek Harness（DSH）Windows 桌面端加一个可选的 **Bash 兼容 shell 工具 `flash_sh`**。

Windows 版 DSH 的预设里只有 pwsh，模型却最熟 Bash。本插件自带 `flash-sh.exe`（Rust 写的单文件 Bash 兼容解释器，
coreutils / grep / sed / awk / diff / find / xargs 都编在 exe 里，与 GNU 版的差异见下文「内置命令的已知差异」），**不依赖 Git Bash / WSL / MSYS2**。

两种装法，二选一即可（都装也没关系，见「与 dsh-flash-presets 同时安装」）：

- **随 dsh-flash-presets（0.3.4 起）**：presets 把本包声明为可选依赖，Windows x64 上自动装上，在插件页「Flash 精简预设」那一行下面
  作为 `flashSh` 子功能出现（默认关）。非 Windows x64 的机器上 npm / pnpm 按本包的 `os` / `cpu` 直接跳过，不会下载 7.9 MB 的 exe。
- **单独安装**：本包自己是一个组合包（一行 `flash-sh-standalone`），见下面「安装」。

- 工具名 `flash_sh`，**不占用** `bash` / `pwsh` / `run_code`。
- **默认关闭**：它会在你的电脑上执行命令，必须你显式打开。
- **只在 Windows x64 上注册**：`package.json` 声明 `os: ["win32"]`、`cpu: ["x64"]`（其他平台上 npm / pnpm 不安装；直接
  `dsh plugin add dsh-flash-sh` 会被 pnpm 以 unsupported platform 拒绝），组合包再声明 `dsh.bundle.platforms: ["win32"]`，
  运行时还要求 `process.arch === 'x64'`（桌面端插件跑在 Electron 进程里，arch 是该 Electron 构建的架构）。
- 包内无运行时依赖、无安装脚本（不会触发 pnpm 的 `allowBuilds` 拦截）。

版本要求：DSH `>=0.2.1-rc.5 <0.2.3-0`（`engines.dsh`，与 dsh-flash-presets 相同）。

## 安装

### 桌面端（推荐：插件页）

1. 把 `dsh-flash-sh-0.1.0.tgz` 放到一个**不会被删的固定位置**，例如 `C:\Users\<你>\dsh-plugins\dsh-flash-sh-0.1.0.tgz`。
2. 打开 DSH 桌面端 → 侧边栏 **插件** → **添加插件**，填 tgz 的**绝对路径**（插件管理器只接受绝对路径；
   `C:\...\dsh-flash-sh-0.1.0.tgz` 或 `file:C:\...\dsh-flash-sh-0.1.0.tgz` 都行）。
3. 装好后**完全退出并重启**桌面端（桌面 profile 只在启动时应用补丁层）。

> 命令行 `dsh plugin --profile desktop …` 在 npm 装的 `dsh` 上会被拒绝（"profile "desktop" is managed exclusively by the
> Electron application"），桌面 profile 只能由桌面端自带的管理器改。web / 自定义 profile 可以用
> `dsh plugin --profile web add C:\...\dsh-flash-sh-0.1.0.tgz`。

### 手动安装（插件页不可用时）

1. 完全退出桌面端。
2. 把 tgz 解压（里面是 `package/` 目录），把 `package` 整个复制成
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-flash-sh`（设置了 `DSH_HOME` 时用 `%DSH_HOME%\profiles\desktop\...`）。
3. 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾加：
   ```yaml
   - insert:
       - id: flash-sh-standalone
         name: 'dsh-flash-sh'
         config:
           enabled: true
   ```
   （文件若只有 `[]`，先把 `[]` 删掉再加。）
4. 重启桌面端。

手动方式不经过 pnpm：之后插件管理器做任何安装 / 卸载时，pnpm 可能把这个"未登记"的目录当多余包清掉，届时重做第 2 步即可。

## 启用

二选一（优先级：环境变量 `DSH_FLASH_SH` ＞ 补丁里的 `enabled` ＞ 默认关）：

**A. 改 profile 补丁（推荐）** —— 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加：

```yaml
- id: flash-sh-standalone
  config:
    enabled: true
```

profile 补丁会**整体替换**这一行的 `config`（DSH 的 patch 语义），要保留别的字段（如 `timeoutMs`）就一起写上。改完重启桌面端。
桌面端设置页里的插件清单是只读的，没有能改插件 config 的表单；插件页的开关只改整行的 `disabled`，不改 `enabled`。

**B. 用户环境变量** —— PowerShell 执行 `setx DSH_FLASH_SH 1`，然后**完全退出**桌面端（含托盘）再从开始菜单启动。
不要把 `DSH_FLASH_SH` 写进 `.env`：DSH 启动器拒绝 `.env` 里出现任何 `DSH_*` 变量（会直接启动失败）。
`DSH_FLASH_SH=0` 可以强制关闭。

## 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关 |
| `binPath` | 包内 `vendor/win32-x64/flash-sh.exe` | 换用别的 flash-sh 可执行文件（也可用环境变量 `DSH_FLASH_SH_BIN`） |
| `timeoutMs` | `120000` | 单次调用默认超时；到点整棵进程树被杀，退出码 124 |
| `maxTimeoutMs` | `600000` | 模型可请求的最大超时 |
| `maxOutputBytes` | `30000` | stdout / stderr 各自回传上限：保留开头和结尾各一半（按 UTF-8 字符边界），中间写明省略了多少字节；完整输出写到临时文件并回传路径 |
| `approval` | `sandboxed` | 何时请求你审批：`sandboxed`＝会话权限不是「完全访问」时（默认）；`read-only`＝只在会话为只读时；`off`＝从不（风险见下文） |
| `approvalMemory` | `session` | `session`＝同一会话里同一类命令批准一次后不再问（危险命令除外）；`off`＝每次都问 |
| `allowNonWindows` | `false` | 仅供开发验证：非 Windows x64 也注册（需配 `binPath`；或 `DSH_FLASH_SH_ANY_PLATFORM=1`） |

`binPath` 写成空字符串等于没写（用内置 exe）。用环境变量 `DSH_FLASH_SH_BIN` 换了 exe 时启动日志会写一行说明；
`binPath` 指向**非内置** exe 时启动日志打一条 warn 并附上它的 sha256，便于核对来源。

作为 dsh-flash-presets 的子功能时，这些字段写在 `flash-presets` 那一行的 `config.flashSh` 下（例如 `flashSh: { enabled: true, approval: sandboxed }`），含义相同。

### 安全提示与审批

`flash_sh` 是一个普通子进程，**不受 DSH 文件沙箱约束**（DSH 的 bash / pwsh 在「工作区可写」下是被沙箱包住的，flash_sh 不是）。
DSH 的工具管线默认不为任何工具弹审批（审批只用于沙箱升级，以及个别工具自己要求的场合），所以本插件自己做审批闸：

- **失败即关闭**：`approval` 不是 `off` 时，读不到会话权限模式也按「需要审批」处理；审批被拒绝 / 取消、审批策略为「从不」、
  没有审批渠道、**审批调用本身出错**，一律不执行。只有 `allowed-once` 放行。
- **会话内记住（`approvalMemory: session`，默认）**：DSH 0.2.1-rc.5 – 0.2.2-rc.x 的审批接口只有「允许一次 / 拒绝 / 取消 / 不可用」四种结果，
  会话策略只有 `ask` / `never`，**没有**「本会话记住」或「始终允许」（查过 `@deepseek-ai/dsh-user-approval` 与审批卡片的源码）。
  所以本插件自己记：同一个会话里，同一类命令批准一次后不再问。「同一类」= 命令里出现的**全部命令名**（排序去重）加上特征
  （`|` 管道、`>` 写文件、`&` 后台）。例如批准过 `ls -la`，之后 `ls src` 不再问；但 `ls | head`、`ls > a.txt`、`ls && rm x` 都是新的一类，要再问。
  审批框里会写明「批准后同类命令本会话不再问」的范围。记忆只在内存里，重启 DSH 或换会话就清空。
- **危险命令每次都问**（不进记忆）：`rm` / `rmdir` 带 `-r` / `-f`；写到工作区外（重定向、`tee`、`cp` / `mv` 的目标、`sed -i`、`mkdir` / `touch` 等，
  临时目录与 `/dev/null` 除外；含 `$变量` 或 `~` 的写目标按外部算）；工作目录在工作区外；`$(...)` / 反引号 / `<(...)` / here-document；
  套另一个 shell（`bash -c`、`pwsh`、`cmd` 等）、`eval` / `source`、`xargs` / `env` / `sudo` 之类的包装命令；`python -c` / `node -e` 等内联代码；
  `git push` / `git clean` / `git reset --hard`；`find -delete` / `-exec`；函数定义；`curl` / `wget` / `ssh` / `dd` / `kill` / `reg` / `setx` 等。
  这是一套保守的启发式规则：看不懂的写法一律按「每次都问」处理。
- **子进程环境脱敏**：名字里含 `KEY` / `PASSWORD` / `PASSWD` / `SECRET` / `TOKEN` / `CREDENTIAL`（不分大小写，`db_password` 也算）的环境变量，
  以及全部 `DSH_*`，都不传给 flash-sh；`PATH`、`HOME`、`USERPROFILE`、`TEMP` 等照常保留。需要凭据的命令请让它自己读配置文件。
- **大输出**：内存里只留头尾；完整输出流式写到临时目录下 `dsh-flash-sh-spill-*`（`mkdtemp` 新建，文件权限 0600），单个 DSH 进程累计上限 64 MB，
  超过就停写并在结果里注明。启动时删除 24 小时以前的残留目录。
- **超时**：exe 的 `--timeout` 到点会杀掉整棵进程树、以 124 退出并在 stderr 写 `flash-sh: timed out after Ns, process tree killed`；
  插件在此之上再留 5 秒，exe 没退就硬杀（Windows 上 `taskkill /T /F`）。`timedOut` 只在看到这个标记（或插件硬杀）时为 true，
  脚本自己 `exit 124` 不算超时。

**`approval: off` 的风险**：模型生成的每条命令都会直接在你的电脑上、以你的用户权限执行，不经过 DSH 沙箱，也没有任何确认 ——
包括删除文件、改写工作区外的文件、联网上传、读取你能读到的任何文件。只建议在一次性的虚拟机 / 容器里，或你完全信任当前任务时使用；
启动日志会为此打一条 warn。想少弹审批，优先用默认的会话内记忆，或把会话切到「完全访问」（那是 DSH 自己的、看得见的开关）。

精简·PTC 预设下 flash_sh 在 `run_code` 程序里被调用，**等你批准的时间也算在 `run_code` 的截止时间里**（默认约 120 秒），超时会被当作取消。

## 内置命令的已知差异

以下按 `native/flash-sh` 源码（awk、diff 是自己写的；sed 用的是 uutils `sed` 0.3.0 crate）逐项核对，并在 Linux 构建上实测过。
Windows 程序（`git`、`node`、`python`…）按 PATH 调用，不在此列。

**awk**（POSIX 语言 + 常用 gawk 扩展：`length(arr)`、`tolower`、`-v`、正则 FS / RS、`printf %c`、`ENVIRON`、`getline` 各种形式、
`print > 文件` / `>>` / `| 命令`、`cmd | getline`、`system`、`close`、`match(s, re, arr)`、`**`）。**不支持**：

- 函数：`gensub`、`strftime` / `systime` / `mktime`、`asort` / `asorti`、`and` / `or` / `xor` / `lshift` / `rshift` / `compl`、
  `strtonum`、`typeof` / `isarray`、`patsplit`（调用时报 `function … not defined`）；`split` 的第 4 参数（分隔符数组）不会被填充。
- 语法 / 特殊变量：`BEGINFILE` / `ENDFILE`、`nextfile`（语法错误）、`|&` 协进程、`@include` / `@load`、`RT`、`FPAT`、`FIELDWIDTHS`、
  `IGNORECASE`、`PROCINFO`（如 `sorted_in`）；命令行选项 `--csv` 等 gawk 长选项。

**sed**（uutils sed 0.3.0：POSIX 全部 + 多数 GNU 扩展，`-E` / `-n` / `-i后缀` / `-s`、`a` `i` `c` 单行写法、`I` `M` 标志、
`0,/re/`、`first~step`、`addr,+N`、`F` `Q` `R` `W` `T` `z`、`e` / `s///e`）。**不支持或行为不同**：

- `e` 命令和 `s///e` 标志在 Windows 上交给 **`cmd.exe /C`** 执行，不是 bash —— 写 bash 语法的命令会失败。
- 替换里的大小写转换 `\U` `\L` `\u` `\l` `\E` 不生效（原样输出）；`\b`、`\<`、`\>` 词边界匹配不到任何东西。
- `s///` 不能同时用数字和 `g`（`s/a/b/2g` 报错）；没有 `v`（会崩溃退出）、`L` 命令；`-z` 不会把 NUL 当行分隔。
- 默认按**字节**处理（Windows 上通常没有 `LANG`）：正则里的反向引用 `\(a\)\1` 直接报错，`.` 匹配单个字节而不是一个中文字符。
  需要时在命令前加 `LC_ALL=C.UTF-8`（例如 `LC_ALL=C.UTF-8 sed 's/\(a\)\1/x/'`）。
- `-i` 必须把备份后缀连写（`-i.bak`）；BSD 的 `-i ''` / `-i .bak` 不支持。写 `/dev/stdout` 这类特殊文件会失败。

**diff**（自写，Myers 算法：普通格式、`-u` / `-U N` / `--unified=N`、`-q` / `--brief`、`-r`、`-i`、`-w` / `-b` / `-B`、`--label`、`-` 读 stdin、
「\ No newline at end of file」，退出码同 GNU）。**不支持**：`-c` / `-C`（上下文格式）、`-y` / `--side-by-side`、`-e` / `--normal` / `-n`、
`-p`（显示函数名）、`-N` / `--new-file`、`-s`、`-x` / `--exclude`、`-I` / `--ignore-matching-lines`、`-t`、`--color`、`--suppress-common-lines`；
二进制文件不会报 `Binary files … differ`，而是按文本逐行比较。

### jq（内置最小子集）

PATH 上没有 jq 时用内置版本；设 `FLASH_SH_JQ=builtin` 可以强制使用内置版。支持 `.`、`.a.b`、`.[n]`、`.[]`、后缀 `?`、`|`、`,`、`[...]`、`{k: v}`、`$var`、比较与 `and/or//`、算术，以及 keys、keys_unsorted、length、select、map、not、empty、type、add、has；选项支持 `-r -c -e -n -s --arg --argjson`。输出格式与退出码对齐 jq 1.7。不支持的语法报 `jq: error: unsupported` 并返回 3。

## 验证

1. 运行随包的 `check-flash-sh.ps1`（只读自检）。
2. 插件启动时通过 DSH 的日志通道（cordis logger）写一行：`[flash-sh] flash_sh registered (…\vendor\win32-x64\flash-sh.exe)`；
   未注册时写 `[flash-sh] flash_sh not registered: <原因>`。桌面端把这些日志写到哪里，DSH 的 npm 包里查不到（桌面壳不在其中），
   所以最可靠的确认方式是第 3 步。
3. 在对话里让模型调用，例如："用 flash_sh 执行 `echo $((6*7)); uname -s`，把原始输出贴给我"。
4. 精简·PTC 预设（lean-v3，`run_code` 是唯一可直接调用的工具）下，模型会在 `run_code` 程序里调用 `flash_sh`，这是正常的；
   跑长命令时要让模型给 `run_code` 传足够大的 `timeoutMs`（`run_code` 的截止时间包含其中的嵌套调用）。

## 与 dsh-flash-presets 同时安装

dsh-flash-presets 0.3.4 起把本包当作可选依赖，在 `flash-presets` 一行下作为 `flashSh` 子功能挂上（默认关）。两种装法可以并存：

- 插件页上，presets 那边**不新增组件**，仍然只有「Flash 精简预设」一行；单独装的本包是另一行 `flash-sh-standalone`；
- 工具名都叫 `flash_sh`，由进程内的协调器保证**任何时候只注册一个**：两边都启用时 **presets 的 flashSh 优先**，本包这一行跳过并写日志
  `flash_sh is provided by dsh-flash-presets（…flashSh 子功能）; dsh-flash-sh（flash-sh-standalone 行） skips registering it`；
  presets 那边被关掉或卸载后，本行自动接管。若是别的插件（第三方）先注册了 `flash_sh`，两边都不抢，等它注销后再补上。
- 注意环境变量 `DSH_FLASH_SH=1` 会同时打开两边（两者用同一个开关）；建议只保留一处启用。
- 两边的配置各管各的：生效的是 presets 那边 `config.flashSh` 的设置。
- 0.3.4 的 presets 不会把 profile 补丁里 `- id: flash-sh-standalone` 的覆盖换算过去（那是本包自己的一行，只要本包还装着就仍然有效）；
  卸载本包、改用 presets 时，请把它改写到 `- id: flash-presets` 的 `config.flashSh` 下（presets 启动日志会提示）。

## 卸载

- 插件页里删除 `dsh-flash-sh`（或 `dsh plugin --profile <p> remove dsh-flash-sh`），重启。
- 手动安装的：删 `profiles\desktop\node_modules\dsh-flash-sh` 目录和补丁里的 insert 行。
- 别忘了删掉 profile 补丁里的 `- id: flash-sh-standalone` 覆盖行（行不存在时 DSH 只打一条 "entry not found" 警告），
  以及 `setx DSH_FLASH_SH ""` 设过的环境变量（`reg delete HKCU\Environment /v DSH_FLASH_SH /f`）。
- pnpm 可能在 profile 的 `pnpm-workspace.yaml` 留一行记录，不影响配置合成。

## 开发

```bash
npm test                                   # unit（必跑，不需要 DSH 与二进制；包内与仓库内都能跑）
FLASH_SH_TEST_BIN=/path/to/flash-sh npm test   # + host：真实 cordis + dsh-tools 宿主（需要能解析到 @deepseek-ai/*，否则自动跳过）
DSH_REAL_NM=/path/to/dsh-install/node_modules FLASH_SH_TEST_BIN=... npm test   # 再加真实 DSH 安装的 plugin add / dump-config / 启动（需要 bash）
```

许可：MIT（见 LICENSE）。flash-sh.exe 内含 uutils coreutils / sed（MIT）等第三方组件，见 NOTICE 与 THIRD_PARTY_LICENSES.md。
