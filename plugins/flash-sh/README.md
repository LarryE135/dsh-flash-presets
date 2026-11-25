# dsh-flash-sh

给 DeepSeek Harness（DSH）Windows 桌面端加一个可选的 **Bash 兼容 shell 工具 `flash_sh`**。

Windows 版 DSH 的预设里只有 pwsh，模型却最熟 Bash。本插件自带 `flash-sh.exe`（Rust 写的单文件 Bash 兼容解释器，
coreutils / grep / sed / awk / diff / find / xargs 都编在 exe 里，与 GNU 版的差异见下文「内置命令的已知差异」），**不依赖 Git Bash / WSL / MSYS2**。

两种装法，二选一即可（都装也没关系，见「与 dsh-flash-presets 同时安装」）：

- **随 dsh-flash-presets（需要 presets ≥ 0.3.4，尚未发布）**：presets 把本包声明为可选依赖，Windows x64 上随 presets 一起装上，在插件页
  「Flash 精简预设」那一行下面作为 `flashSh` 子功能出现（默认关）。已发布的 presets（≤ 0.3.2）里还没有这部分代码，目前请用下面的单独安装。
- **单独安装**：本包自己是一个组合包（一行 `flash-sh-standalone`），见下面「安装」。

- 工具名 `flash_sh`，**不占用** `bash` / `pwsh` / `run_code`。
- **默认关闭**：它会在你的电脑上执行命令，必须你显式打开。
- **只在 Windows x64 上激活**：`package.json` 声明 `os: ["win32"]`、`cpu: ["x64"]`，组合包声明 `dsh.bundle.platforms: ["win32"]`，
  运行时还要求 `process.arch === 'x64'`（桌面端插件跑在 Electron 进程里，arch 是该 Electron 构建的架构）。
  实测（Linux 宿主、pnpm 11.22.0）：`dsh plugin add dsh-flash-sh` 时 **pnpm 仍会把包装进 profile**（并不按 `os` / `cpu` 跳过或拒绝），
  随后 DSH 在组合包激活阶段以 `Bundle supports Host platforms win32` 拒绝激活，最终不会激活、不注册任何工具；
  装错了平台用 `dsh plugin --profile <p> remove dsh-flash-sh` 清理即可。
- 包内无运行时依赖、无安装脚本（不会触发 pnpm 的 `allowBuilds` 拦截）。

版本要求：DSH `>=0.2.1-rc.5 <0.2.3-0`（`engines.dsh`，与 dsh-flash-presets 相同）。

## 安装

### 桌面端（推荐：插件页）

1. 把 `dsh-flash-sh-0.1.4.tgz` 放到一个**不会被删的固定位置**，例如 `C:\Users\<你>\dsh-plugins\dsh-flash-sh-0.1.4.tgz`。
2. 打开 DSH 桌面端 → 侧边栏 **插件** → **添加插件**，填 tgz 的**绝对路径**（插件管理器只接受绝对路径；
   `C:\...\dsh-flash-sh-0.1.4.tgz` 或 `file:C:\...\dsh-flash-sh-0.1.4.tgz` 都行）。
3. 装好后**完全退出并重启**桌面端（桌面 profile 只在启动时应用补丁层）。

> 命令行 `dsh plugin --profile desktop …` 在 npm 装的 `dsh` 上会被拒绝（"profile "desktop" is managed exclusively by the
> Electron application"），桌面 profile 只能由桌面端自带的管理器改。web / 自定义 profile 可以用
> `dsh plugin --profile web add C:\...\dsh-flash-sh-0.1.4.tgz`。

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
- **危险命令每次都问**（不进记忆）：`rm` / `rmdir` 带 `-r` / `-f`；写到工作区外（重定向含 `>|` `>>` `1>` `&>` `>&`、`tee`、`cp` / `mv` 的目标
  与 `mv` 的源、`sed -i`、`sort -o`、`uniq` 的输出、`tar -C` / `unzip -d`、`mkdir` / `touch` 等；临时目录与 `/dev/null` 除外；含 `$变量`、`~`、
  花括号展开、可能匹配 `..` 的 glob 的写目标按外部算；**按真实路径判断**，经符号链接 / 联接点写到外面也算；先 `cd` 出工作区再写相对路径也算；
  `/c/…`、`C:\…`、别的盘、UNC `\\host\share`、`CON` / `COM1` 等设备名按 Windows 规则判断）；工作目录在工作区外；`$(...)` / 反引号 / `<(...)` / here-document；
  命令名来自变量、带 glob / 花括号展开；给 `PATH` / `LD_PRELOAD` / `BASH_ENV` / `IFS` / `GIT_*` / `NODE_OPTIONS` 等赋值（前置、单独、`export` / `declare` / `read` / `printf -v`）；
  套另一个 shell（`bash -c`、`pwsh`、`cmd /c`，含 `C:\…\cmd.exe`、`RM.exe` 这类带路径 / 大小写 / 扩展名的写法——比对前先归一化）、`eval` / `source` / `alias` / `hash` / `trap`、
  `command` / `builtin` / `exec` / `env` / `xargs` / `sudo` / `coproc` / `npx` 之类的包装命令；解释器的内联代码（`python -c`、`node -e` / `-pe`、`perl -e` / `-pe` / `-M…`、`ruby -e`、`php -r`）、
  把代码从管道喂给解释器（`… | python3`）、`awk` 里的 `system()` / 管道 / 写文件、`sed` 的 `e` / `w`；`git push` / `clean` / `reset --hard` / `checkout .` / `restore` / `config`（写）/ `-c …` /
  `-C <工作区外>` 等；`find -delete` / `-exec` / `-fprint`；`chmod` / `chown` / `ln`；函数定义；`curl` / `wget` / `ssh` / `dd` / `kill` / `reg` / `setx` / `patch` / 包管理器等；参数里有 UNC 路径。
  这是一套保守的启发式规则，原则是**看不懂的写法一律每次都问**；规则键用原样的命令名，`/usr/bin/rm`、`RM.exe` 与 `rm` 互不借用批准。
  对抗用例见 `test/adversarial.mjs`（77 条 + 15 条良性写法）。仍然要知道：同一类里的命令参数不同也算同一类（批准过 `rm a.o` 后，工作区内的 `rm b.c` 不再问；
  批准过 `python3 x.py` 后，`python3 y.py` 不再问——脚本内容本身不受审查）。
- **子进程环境脱敏**：名字里含 `KEY` / `PASSWORD` / `PASSWD` / `SECRET` / `TOKEN` / `CREDENTIAL` / `COOKIE` / `JWT`（不分大小写，`db_password` 也算）、
  以 `_PAT` / `_AUTH` 为词（`GITHUB_PAT`、`NPM_CONFIG__AUTH`、`SSH_AUTH_SOCK`；不误伤 `NODE_PATH` 这类 `*_PATH` 与 `GIT_AUTHOR_*`）、
  前缀为 `DSH_` / `AWS_` / `GITHUB_` / `GH_` / `NPM_CONFIG_` / `YARN_NPM_` / `AZURE_DEVOPS_` 的变量，以及**值**是带账号密码的 URL（`postgres://u:p@h`、
  `http://user:pw@proxy`）的变量，都不传给 flash-sh；`PATH`、`HOME`、`USERPROFILE`、`TEMP`、不带账号密码的代理等照常保留。
  影响：flash_sh 里的 `npm` 读不到 `NPM_CONFIG_*`（改读 `.npmrc`），`git` 走 ssh-agent 会失败（`SSH_AUTH_SOCK` 被去掉）。需要凭据的命令请让它自己读配置文件。
- **大输出**：内存里只留头尾；完整输出流式写到临时目录下 `dsh-flash-sh-spill-*`（`mkdtemp` 新建、0700；文件名是 128 位随机数，`O_EXCL` 0600 新建），
  单个 DSH 进程累计上限 64 MB，超过就停写并在结果里注明。启动时清理 24 小时以前的残留目录：只删名字对、是真目录（不跟符号链接 / 联接点）、
  POSIX 上属主是自己、且里面只有 spill 日志文件的目录，逐个删文件再删空目录，不做递归删除。
- **超时**：exe 的 `--timeout` 到点会杀掉整棵进程树、以 124 退出并在 stderr 写 `flash-sh: timed out after Ns, process tree killed`；
  插件在此之上再留 5 秒，exe 没退就硬杀（Windows 上 `%SystemRoot%\System32\taskkill.exe /PID <pid> /T /F`，绝对路径、不走 PATH；
  taskkill 失败时退回直接杀进程；开发验证用的 POSIX 模式下杀整个进程组）。杀掉后最多再等 3 秒，孙进程仍攥着输出管道不放就由插件断开管道收尾，
  调用一定会返回。`timedOut` 只在看到这个标记（或插件硬杀）时为 true，脚本自己 `exit 124` 不算超时。
- **workdir**：相对路径按会话工作区解析；Windows 上 `/d/x` 按 `D:\x` 理解；`\\host\share`、`//host/share`、`\\.\设备` 这类路径在工作区之外时
  **连 stat 都不做就拒绝**（在 Windows 上访问网络共享本身就会向对方发 SMB 认证）。

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

PATH 上没有 jq 时用内置版本；设 `FLASH_SH_JQ=builtin` 可以强制使用内置版。输出格式与退出码对齐 jq 1.7（对照用例逐条和真 jq 1.7 比过）。

- **支持**：`.`、`.a.b`、`."a"`、`.["k"]`、`.[n]`（含负下标）、`.[]`、后缀 `?`、`|`、`,`、`( )`、`[...]`、`{k: v}` / `{k}`、`$var`、
  比较 `== != < <= > >=`、`and` / `or` / `//`、`not`、算术 `+ - * / %`；函数 `keys`、`keys_unsorted`、`length`、`select(f)`、`map(f)`、
  `empty`、`type`、`add`、`has(k)`、`to_entries`、`from_entries`、`with_entries(f)`（`from_entries` 按 jq 1.7
  的规则取键 `key` / `name` / `Name` / `Key`、取值 `value`，键不是字符串时报错）。
- **更新赋值**（0.1.2 新增）：`|=`、`=`、`+=`、`-=`、`*=`、`/=`、`%=`、`//=`，左边是路径表达式（`.a`、`.a.b[0]`、`.[e]`、`.[]`、`?`、
  `|`、`,`、`select(f)`、`empty` 的组合），语义按 jq 1.7：`|=` 取右边第一个结果、右边没有结果时删除该路径（`.[] |= empty` → `[]`）；
  `=` / `+=` 等的右边在原输入 `.` 上求值、每个结果各产出一份；不存在的路径按需补 `null` / 对象 / 数组。所以
  `with_entries(.value += 1)`、`.a.b |= . + 1`、`.items[] |= select(.ok)`、`.x //= "默认"` 都能用。左边不是路径（如 `(.a | length) = 1`）
  时报 `Invalid path expression with result …`，与 jq 相同。
- **选项**：`-r` / `--raw-output`、`-j` / `--join-output`（同 `-r`，且每个结果后不加换行）、`-c`、`-e`、`-n`、`-s`、
  `--arg`、`--argjson`，短选项可合写（`-rc`、`-jc`）。
- **不支持**（报 `jq: error: unsupported` 并返回 3；不认识的选项返回 2）：`reduce` / `foreach`、`if … then … else … end`、`as $x` 绑定、
  `def` 自定义函数、字符串插值 `"\(.a)"`、切片 `.[1:2]`（也不能作更新的左边）、递归 `..`、`?//`、`@csv` / `@tsv` / `@base64` 等格式化、
  `tostring` / `tonumber` / `split` / `join` / `test` / `sort_by` / `group_by` / `unique` / `paths` / `getpath` / `setpath` / `del` 等其余内建函数、
  `--tab` / `--indent` / `--slurpfile` / `--rawfile` 等选项。需要这些时装一个真 jq 放进 PATH（内置版只在找不到 jq 时才用）。

### read 与逐行读取

**规则**：`read` 绝不从输入里多拿走一个字节——本行之后的内容属于下一个读的人（下一次 `read`、`read` 之后的 `cat` / `head`、
子进程、管道里的另一段）。bash 在管道上为此一次只读一个字节。flash-sh 的做法按输入来源分三种：

- **管道 / FIFO / here-string / heredoc**（0.1.2 起）：先 *peek*（Windows `PeekNamedPipe`、Linux `tee(2)` 到私有管道）——只把管道里
  现成的数据拷一份出来、不取走；在拷贝里找分隔符。拷贝里剩下的部分仍在管道里，谁接着读都拿得到，所以不需要「把多读的还回去」。
  - **本 shell 自己建的、没交给别人的管道**（0.1.3 起：流水线里 `cmd | while read` 的那根管道、here-string、heredoc）：用掉的行
    也先留在管道里，拷贝用完时才一次取走（**延迟交还**），每行不再有系统调用。在任何别的读者碰到这根管道之前先把用掉的字节
    取走（结清）：运行别的命令或 applet、起子进程、流水线开始、`read` 换到另一个 fd、`read -t` 等输入、`mapfile` 等。一旦这根
    管道交给过子进程、后台任务或同时运行的两段流水线，就不再延迟（那时可能有别人同时在读）。
  - **其他管道**（从父进程继承来的 stdin 等）：每行恰好读到分隔符为止（1 次真读），真读出来的字节和拷贝逐字节比对，不一致
    （有别的读者同时在读）就按真读到的字节重新解析。
- **磁盘文件**：一次读一块，块里剩下的部分留给同一个打开文件的下一次 `read`。`< 文件` 这种本 shell 打开、没交给别人的文件
  （0.1.3 起）文件位置先停在块尾，在别的读者之前才挪回本行末尾；其他文件（继承来的、交给过子进程的）每次 `read` 返回前就挪回去
  （与 bash 相同，每行一次 seek）。期间只要运行过可能读写文件的东西（子进程、内建 applet、`echo`/`printf`/`test` 等少数纯内建
  以外的命令、以写方式打开任何文件），这份缓存就作废、重新从文件读。
- **控制台、设备等其他来源**：逐字节读。设环境变量 `FLASH_SH_READ_BYTES=1` 可以对所有来源强制逐字节读（排查用）。

0.1.1 修过 0.1.0 的回归（Windows 上管道 / here-string / heredoc 只读到第一行），代价是管道上改成逐字节读；0.1.2 用 peek 找回一部分；
0.1.3 的延迟交还去掉了每行的系统调用。Linux 构建实测（同一构建配置，5 次中位数，计数确认行数正确）：管道 10 万行 242 → 104 ms、
100 万行 2.34 → 1.04 s、here-string 2 万行 38.5 → 22.4 ms、heredoc 1 万行 13.8 → 11.7 ms、文件 20 万行 236 → 215 ms（0.1.2 → 0.1.3）。
0.1.2 实机测试（Windows 11 x64，5 次中位数）：管道 10 万行 287 ms、100 万行 2265 ms、文件重定向 20 万行 504 ms（Git Bash 5.2.37 分别为 1804 ms、18402 ms、7095 ms）；0.1.3 / 0.1.4 尚无实机数据。
注意：下游报告里 0.1.0 的管道数字（10 万行 0.057 s）是用不数行的循环测的。按 0.1.0 源码，它在 Windows 管道上每次 `read` 读走一块
（最多 256 B）、只用第一行、其余丢掉，循环实际只跑了一小部分行，那个数字不能当目标（CI 的 read 计时步骤对 0.1.0 计数）。需要整段读进数组时 `readarray -t a < <(cmd)` 仍然最快。

实测正常（Linux 构建对照 bash 5.2，Windows CI 上直接跑 exe，`test/read-regress.mjs` 45 条 × 两种执行方式）：

- `cmd | while read -r l`、`find … | while read -r f`、`while read …; done <<< "$x"`、`while read …; done <<EOF`、
  `{ read a; read b; read c; }` 连续读、子 shell / 函数里从管道读、嵌套管道、`read` 之后接 `cat` / `head -n 1` / `awk` / `mapfile`
  读剩下的内容（管道 / heredoc / here-string / 文件 / `exec 3<file` 都对）、同一管道经两个 fd 交替读、1 MB 单行（文件和管道）；
- 延迟交还的交还时机（0.1.3）：`while read` 中途 `break` 后 `wc` / `head` / `awk` / `mapfile` 读剩余、命令替换 / 流水线段 / 子 shell /
  函数 / `eval` 读同一 stdin、管道与 heredoc 两个 fd 交替、文件重定向 `break` 后 applet 接着读、20 万行计数、`lastpipe`、`read -t` / `-t 0`
  不把已用的行当成新输入；
- `read -n N`、`read -d 分隔符`（含 `-d ''`）、`read -t 秒数`（含 `-t 0` 只探测；无数据时按时返回 142）都正常；
  最后一行没有换行时 `read` 返回 1 且变量里是这行内容，与 bash 相同；
- `readarray` / `mapfile` 从管道读（`cmd | { readarray -t a; …; }`、`readarray -t a < <(cmd)`）正常，需要整段读进数组时它最快。

### 与 bash / Git Bash 的其他已知差异

0.1.2 实机测试（Windows 11 + DSH 0.2.2-rc.5，对照 Git Bash 5.2.37，108 个用例 15 处差异）列出的差异，按 0.1.4 的实际情况：

| 项 | flash-sh 0.1.4 | bash / Git Bash | 说明 |
| --- | --- | --- | --- |
| `sh`、`bash` | **0.1.4 起可用**：`sh -c …`、`sh 脚本`、`bash -c …`、`bash 脚本` 都用 flash-sh 自己执行（Windows 上一律如此，不会调到 PATH 里的 Git Bash 或 System32 的 WSL `bash.exe`） | `/usr/bin/sh` | 行为等同 `bash`（不是 dash / POSIX 模式）。审批上 `sh -c` 与 `bash -c` 同等对待：每次都问 |
| `cmp`、`nproc` | **0.1.4 起内置**（`cmp -s / -l / -b`；`nproc --all / --ignore`，认 `OMP_NUM_THREADS`） | 有 | |
| `id`、`stat`、`chmod`、`ps` | 没有 | 有 | Windows 上没有对应的权限 / 进程模型。替代：`whoami`；文件大小 `wc -c < f`；修改时间 `date -r f`；进程用 PowerShell 的 `Get-Process` |
| `/dev/zero`、`/dev/urandom`、`/dev/random` | **0.1.4 起可读**：`< /dev/urandom` 重定向，以及内置命令的文件参数（`head -c 16 /dev/urandom`、`od -N4 /dev/zero`、`cat /dev/zero \| head -c 5`）；随机字节取自系统 CSPRNG（`BCryptGenRandom`） | 有 | 只特判读取：`ls /dev`、`[ -e /dev/zero ]`、写入它们、把它们当参数传给外部程序（`git`、`python`…）都不行。`/dev/null` 一直可用 |
| `time` | **0.1.4 起可用**：`time 命令` / `time -p`，`TIMEFORMAT`（`%R %U %S %P`，精度与 `l` 格式）；输出到 stderr | 有 | Windows 上 user / sys 只计 flash-sh 进程自己，不含它起的子进程 |
| `type -a` | **0.1.4 起列出全部**（关键字、函数、内建、内置 applet、PATH 上的每一个） | 列全部 | 内置 applet 会多列一行 `… is a flash-sh applet` |
| `read -p 提示` | **0.1.4 起与 bash 相同**：只在输入是终端时把提示写到 stderr | 同左 | 0.1.2 把提示写进了 stdout |
| `timeout 5 echo ok` | **0.1.4 起可用**：内建命令（`echo`、`printf`、`test`…）PATH 上找不到时用一个新的 flash-sh 执行 | 可用（调 `/usr/bin/echo`） | 与 bash 一样，shell 函数不能交给 `timeout` |
| `${#s}`（多字节） | 按字符数（`中文` = 2） | UTF-8 locale 下同样是 2；C locale 下按字节（6） | 不改：flash-sh 始终按 UTF-8 字符计。需要字节数用 `printf %s "$s" \| wc -c` |
| `$( )` 里的 NUL | 保留（`x=$(printf 'a\0b')` 长度 3） | 丢掉 NUL 并警告（长度 2） | 不要靠命令替换搬二进制数据，改用临时文件 |
| `ls -l` 权限位 | 恒为 `-rwxrwxrwx` | 真实权限 | Windows 文件没有 Unix 权限位；不要解析 `ls -l` 的权限列 |
| `du -sh` 小目录 | `0` | `1.0K` | uutils du 在 Windows 上对很小的目录可能显示 0；要文件的字节数用 `wc -c < 文件` 或 `du -b` |
| `ulimit -n` | 恒报 `unlimited` | 3200 等 | 只是占位，`ulimit` 不会真的设限 |
| `kill -INT $$`（子 shell 里打自己的父 shell） | 进程以 130 结束 | Linux bash 5.2：等前台任务结束后继续执行；Git Bash：同样不触发 trap | 在顶层 `trap … INT; kill -INT $$` 两边都正常触发 trap |
| CRLF 结尾的脚本 | 行尾的 `\r` 保留在单词里（与 Linux bash 相同） | Git Bash 会忽略 `\r` | Windows 上写脚本文件请用 LF 换行 |
| `mapfile -u`、`mapfile -n` | **0.1.4 起与 bash 相同**（`-n N` 只从输入里取 N 行，`-u fd`、`-s`、`-O`） | 同左 | 0.1.3 及以前 `-n` 会把剩下的输入也读走、`-u` 不支持 |

### Windows：低完整性目录与杀毒软件

- **低完整性标签目录**：如果 `flash-sh.exe`（或拷贝它的目录）带 `Mandatory Label\Low Mandatory Level`（`icacls 目录` 能看到，
  某些下载目录、沙盒工具建的目录会带），从那里启动的程序继承 Low 完整性，写 `%TEMP%` 和 `C:` 一律被拒（`os error 5`，
  `mktemp: 拒绝访问`）。这是 Windows 的强制完整性控制，与 flash-sh 无关——把 exe 放回 profile 的 `node_modules` 下或任意普通目录即可。
  `test/read-regress.mjs` 0.1.4 起会先探测可写性，不可写时明确提示并跳过相关用例，不再报成失败。
- **杀毒软件拦截**：自检第 3 项报「无法执行」或执行很慢，多半是杀软在隔离 / 扫描 `flash-sh.exe`。核对 `check-flash-sh.ps1` 第 2 项的
  sha256 与发布值一致后，把 `…\node_modules\dsh-flash-sh\vendor\win32-x64\` 加入排除项。
- **溢出文件**：输出超过上限时完整输出写到 `%TEMP%\dsh-flash-sh-spill-*`。0.1.4 起 DSH 正常退出时删除本次的目录；进程被强杀没来得及删的，
  下次启动时清理 24 小时以前的（只删本插件前缀、只装着溢出日志的目录）。

### 其他

- `mkfifo` 没有内建（Windows 上也没有命名 FIFO 的等价物）。需要「边生产边读」时用进程替换 `< <(cmd)`，或先写临时文件再读。

## 验证

1. 运行随包的 `check-flash-sh.ps1`（只读自检）。
2. 插件启动时通过 DSH 的日志通道（cordis logger）写一行：`[flash-sh] flash_sh registered (…\vendor\win32-x64\flash-sh.exe)`；
   未注册时写 `[flash-sh] flash_sh not registered: <原因>`。桌面端把这些日志写到哪里，DSH 的 npm 包里查不到（桌面壳不在其中），
   所以最可靠的确认方式是第 3 步。
3. 在对话里让模型调用，例如："用 flash_sh 执行 `echo $((6*7)); uname -s`，把原始输出贴给我"。
4. 精简·PTC 预设（lean-v3，`run_code` 是唯一可直接调用的工具）下，模型会在 `run_code` 程序里调用 `flash_sh`，这是正常的；
   跑长命令时要让模型给 `run_code` 传足够大的 `timeoutMs`（`run_code` 的截止时间包含其中的嵌套调用）。

## 与 dsh-flash-presets 同时安装

dsh-flash-presets 0.3.4 起（需要 presets ≥ 0.3.4，尚未发布）把本包当作可选依赖，在 `flash-presets` 一行下作为 `flashSh` 子功能挂上（默认关）。两种装法可以并存：

- 插件页上，presets 那边**不新增组件**，仍然只有「Flash 精简预设」一行；单独装的本包是另一行 `flash-sh-standalone`；
- 工具名都叫 `flash_sh`，由进程内的协调器保证**任何时候只注册一个**，启动阶段也不例外：本包这一行启动时先不注册，等 presets 那边表态
  （presets 的 `flash-presets` 行一开始 apply 就会表态；DSH 的加载器配置里看不到 `flash-presets` 行、或它被整行关掉时不等；
  看得到它但它一直不表态时最多等 15 秒，什么都判断不了时等 3 秒），所以不会出现「本行先注册、presets 随后接管」的双注册窗口。
  两边都启用时 **presets 的 flashSh 优先**，本包这一行跳过并写日志
  `flash_sh is provided by dsh-flash-presets（…flashSh 子功能）; dsh-flash-sh（flash-sh-standalone 行） skips registering it`；
  presets 那边被关掉或卸载后，本行自动接管。若是别的插件（第三方）先注册了 `flash_sh`，两边都不抢，等它注销后再补上。
- 注意环境变量 `DSH_FLASH_SH=1` 会同时打开两边（两者用同一个开关）；建议只保留一处启用。
- 两边的配置各管各的：生效的是 presets 那边 `config.flashSh` 的设置；两边的 `approval` / `approvalMemory` / 超时 / 输出上限 / `binPath` 不一致时，
  本包这一行让位时会打一条 warn，列出哪些设置**没有生效**。
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
                                           #   + read 回归：直接跑该可执行文件（管道 / here-string / heredoc 逐行读取，test/read-regress.mjs）
                                           #   + 进程树收尾：--timeout 与父进程被杀时整棵树都结束（test/job-tree.mjs；find -exec / xargs 孙进程两条只在 Windows 判定）
node test/read-bench.mjs [/path/to/flash-sh] [次数]   # 逐行 read 计时（只打印）：正常读法 vs FLASH_SH_READ_BYTES=1 逐字节 vs bash
DSH_HOST_NM=/path/to/node_modules FLASH_SH_TEST_BIN=... node test/host.mjs   # host 换一套宿主包跑；实测 DSH 0.2.1-rc.5、0.2.2-rc.1、0.2.2-rc.5 都通过
                                           #   （0.2.2 起没有 tools.sdkSchemas、执行要挂 tool executor：测试会自动检测并挂上 native executor）
DSH_REAL_NM=/path/to/dsh-install/node_modules FLASH_SH_TEST_BIN=... npm test   # 再加真实 DSH 安装的 plugin add / dump-config / 启动（需要 bash）
```

许可：MIT（见 LICENSE）。flash-sh.exe 内含 uutils coreutils / sed（MIT）等第三方组件，见 NOTICE 与 THIRD_PARTY_LICENSES.md。
