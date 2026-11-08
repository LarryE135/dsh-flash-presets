#!/usr/bin/env bash
# Install the Flash 精简 presets into a DSH home.
#
# DSH 0.1.7-rc.1 changed how presets are declared: the old per-preset directory
# ($DSH_HOME/.agent-presets/<id>/) is no longer read; a preset is now a plugin row
# (`@deepseek-ai/dsh-agent-preset`) inserted into a profile's user patch layer.
# This script writes a managed block (two preset rows) into the profile patch file.
# 0.2.6 removed the pre-0.1.7 directory layout: --legacy now exits 3.
#
#   bash scripts/install.sh                        # profile "web" (autodetect)
#   bash scripts/install.sh --profile desktop      # another profile
#   bash scripts/install.sh --with-runtime         # 额外写入 profile 级 PTC 常驻运行时
#   bash scripts/install.sh --all-presets          # 与默认等价（两个预设都写），保留以兼容
#   bash scripts/install.sh --uninstall            # remove the managed block（含运行时覆盖）
#   bash scripts/install.sh --force                # 即使该 profile 已用插件卡装了本包也照装（默认 exit 4 拒绝）
#   DSH_HOME=/tmp/dsh bash scripts/install.sh       # custom DSH home
#
# Safe to run repeatedly: the managed block is replaced in place and the patch
# file is backed up as cordis.patch.yml.bak-<timestamp> before every write.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE="web"
MODE="auto"
ACTION="install"
STAMP="$(date +%Y%m%d-%H%M%S)"
# 0.2.6 起只发两个预设：lite（13 条，默认）与 balance（3 条）
PRESETS=(flash-lean-ptc-v3 flash-lean-ptc-v3-balance)
FORCE=0
# --with-runtime（旧名 --with-plan-mode，保留为别名）：额外往 profile 补丁层追加
# ptc-runtime: persistent-in-memory。这是 profile 级覆盖，对该 profile 的所有预设生效，
# --uninstall 会一并撤掉。计划模式组件不在脚本路径里，它只随插件管理器安装。
WITH_RUNTIME=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)   [ -n "${2:-}" ] || { echo "--profile 需要参数" >&2; exit 2; }
                 PROFILE="$2"; shift 2 ;;
    --legacy)    MODE="legacy"; shift ;;
    --modern)    MODE="modern"; shift ;;
    --force) FORCE=1; shift ;;   # 与插件卡叠加也照装（默认拒绝：会重复注册同一个预设）
    --all-presets) PRESETS=(flash-lean-ptc-v3 flash-lean-ptc-v3-balance); shift ;;  # 0.2.9 起包内就这两个，保留开关只为兼容旧脚本
    --with-runtime|--with-plan-mode) WITH_RUNTIME=1; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    -h|--help)   sed -n '2,/^set -euo/p' "$0" | sed '$d'; exit 0 ;;
    *) echo "未知参数: $1（用 --help 看用法）" >&2; exit 2 ;;
  esac
done

# profile 只能是单层目录名：挡掉 "a/b"、".." 之类，避免把补丁写到预期目录之外
case "$PROFILE" in
  ""|.|..|.*|*/*|*\\*)
    echo "✖ 非法 profile 名称：${PROFILE}（只接受单层目录名，如 web / desktop / headless）" >&2
    exit 2 ;;
esac

PATCH="$DSH_DIR/profiles/$PROFILE/cordis.patch.yml"
LEGACY_DIR="$DSH_DIR/.agent-presets"

# ── 选机制 ────────────────────────────────────────────────────────────────────
if [ "$MODE" = "auto" ]; then
  if [ -e "$PATCH" ]; then
    MODE="modern"
  elif [ -e "$LEGACY_DIR" ]; then
    MODE="legacy"
    echo "未发现 ${PATCH}，但存在 $LEGACY_DIR → 按旧版（DSH < 0.1.7）目录式安装。"
  else
    echo "找不到 ${PATCH}（也没有 ${LEGACY_DIR}）。" >&2
    echo "请确认 DSH_HOME 是否正确（当前：${DSH_DIR}），或用 --profile 指定 profile 名。" >&2
    exit 1
  fi
fi

# ── 补丁改写（交给跨平台助手，Windows 安装器共用同一实现）──────────────────
merge_patch()  { node "$HERE/scripts/merge-presets.mjs" --patch "$PATCH" --only "$(IFS=,; echo "${PRESETS[*]}")"; }
strip_patch()  { node "$HERE/scripts/merge-presets.mjs" --patch "$PATCH" --remove >/dev/null; }

# 这个 profile 是不是已经用插件卡（dsh plugin add）装了本包？装了的话脚本再写托管块 = 同一个预设注册两次。
bundle_installed() {
  _pkg="$DSH_DIR/profiles/$PROFILE/package.json"
  [ -f "$_pkg" ] || return 1
  node -e 'const fs=require("fs");try{const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const b=(p.dsh&&p.dsh.profile&&p.dsh.profile.bundles)||[];process.exit(b.indexOf("dsh-flash-presets")>=0?0:1)}catch(e){process.exit(1)}' "$_pkg"
}

validate_patch() {
  if command -v node >/dev/null 2>&1 && [ -f "$HERE/scripts/verify-yaml.mjs" ]; then
    _yrc=0
    node "$HERE/scripts/verify-yaml.mjs" "$PATCH" >/dev/null 2>&1 || _yrc=$?
    if [ "$_yrc" -eq 0 ]; then
      echo "YAML 校验通过。"
    elif [ "$_yrc" -eq 2 ]; then
      echo "⚠ YAML 校验已跳过（未安装 js-yaml）。安装后可用：node $HERE/scripts/verify-yaml.mjs $PATCH"
    else
      echo "✖ YAML 校验未通过：已回滚到安装前的备份（$(basename "$PATCH").bak-${STAMP}），未完成安装。" >&2
      echo "  复查：node $HERE/scripts/verify-yaml.mjs $PATCH" >&2
      [ -f "$PATCH.bak-$STAMP" ] && cp "$PATCH.bak-$STAMP" "$PATCH"
      exit 1
    fi
  fi
}

# ── 四个动作 ──────────────────────────────────────────────────────────────────
install_modern() {
  [ -f "$PATCH" ] || { echo "缺少 $PATCH" >&2; exit 1; }
  # 第五轮审计 T3-6：以前只提示"都装不会报错"，实际结果是同一个预设出现两次（预设列表里重复、
  # 选哪个都可能撞到不同的规则）。现在默认拒绝，--force 才继续。
  if [ "$FORCE" != "1" ] && bundle_installed; then
    echo "✖ 这个 profile 已经用插件卡装了本包（profiles/$PROFILE/package.json 的 dsh.profile.bundles）。" >&2
    echo "  再跑脚本会把同一个预设注册两次。二选一：" >&2
    echo "    ① 只留插件卡：什么都不用做（插件卡已经带两个预设 + 旧 id 兼容 + 计划模式）" >&2
    echo "    ② 只留脚本安装：dsh plugin --profile $PROFILE remove dsh-flash-presets" >&2
    echo "  确实要叠加（不推荐）：bash scripts/install.sh --profile $PROFILE --force" >&2
    exit 4
  fi
  cp "$PATCH" "$PATCH.bak-$STAMP"
  echo "已备份 $PATCH → $(basename "$PATCH").bak-$STAMP"
  merge_patch
  echo "已写入托管块：$PATCH"
  validate_patch
  echo
  echo "安装完成。web profile 是 live reload：无需重启，刷新 GUI 即可在预设列表看到"
  echo "「精简·PTC v3（lean-v3）」与「精简·PTC v3 balance」。"
  echo "  已写入：两行预设（lite / balance）。"
  echo "  升级须知：本脚本整块替换旧托管块 —— 0.2.5 时代的三卡（flash-lean-ptc-v1 / -v2）会被移除，"
  echo "  且这条路没有旧 id 兜底（别名层只随插件卡发行）。需要旧会话继续可打开，请改装插件卡。"
  echo "  未安装：计划模式组件、旧 id 兼容层、glob/grep 只读并发 —— 这三项只在插件管理器安装时才有："
  echo "    dsh plugin --profile $PROFILE add github:LarryE135/dsh-flash-presets#v0.3.0"
  echo "    两者二选一：本脚本写过预设之后要改装插件卡，请先 --uninstall（都装会被默认拒绝：预设会重复注册）。"
  echo "  自检：dsh --profile $PROFILE --dump-config | grep -A3 'id: preset-flash-lean-ptc-v3'"
  echo "  体检：node scripts/doctor.mjs --profile $PROFILE   （版本/重复行/!!js/解析 一次过）"
  echo "  卸载：bash scripts/install.sh --uninstall --profile $PROFILE"
  if [ "$WITH_RUNTIME" = "1" ]; then install_runtime; fi
}

# --with-runtime：只写 profile 级的 ptc-runtime 覆盖（plan-mode 组件不在脚本路径里）。
# 这块内容落在托管块之外，卸载时要单独撤掉（见 uninstall_modern）。
install_runtime() {
  echo "-- PTC 常驻运行时（profile 级）-----------------------"
  if ! command -v node >/dev/null 2>&1 || [ ! -f "$HERE/scripts/tune-runtime.mjs" ]; then
    echo "  未找到 node 或 tune-runtime.mjs，已跳过（不影响两个预设）。"
    return 0
  fi
  # --no-backup：install_modern 开头已经整份备份过，不必再留一份 .bak-tune-*
  node "$HERE/scripts/tune-runtime.mjs" --apply --profile "$PROFILE" --no-backup >/dev/null 2>&1 || true
  if grep -q 'executionMode: persistent-in-memory' "$PATCH" 2>/dev/null; then
    echo "  已写入 ptc-runtime: persistent-in-memory（profile 级覆盖，对该 profile 的所有预设生效）"
    echo "  改过配置需重启 dsh 才生效；卸载时会被一并撤掉。"
  else
    echo "  ⚠ 未能写入常驻运行时；两个预设不受影响，可手动跑 node scripts/tune-runtime.mjs --apply --profile $PROFILE"
  fi
}

install_legacy() {
  # legacy 只提供 v1 旧式目录：与 --all-presets 无关，固定走 v1
  for p in flash-lean-ptc-v1; do
    src="$HERE/presets/legacy-0.1.5/$p"
    if [ ! -d "$src" ]; then
      echo "0.2.6 起不再提供旧式目录（presets/legacy-0.1.5 已移除）。" >&2
      echo "旧版机制请装 0.2.5；新版机制用：bash scripts/install.sh --profile <p>" >&2
      exit 3
    fi
    if [ -e "$LEGACY_DIR/$p" ]; then
      echo "已存在 $LEGACY_DIR/$p → 备份为 .bak-$STAMP"
      mv "$LEGACY_DIR/$p" "$LEGACY_DIR/$p.bak-$STAMP"
    fi
    mkdir -p "$LEGACY_DIR/$p"
    cp "$src/preset.yml" "$src/agent.cordis.yml" "$LEGACY_DIR/$p/"
    echo "已安装 $LEGACY_DIR/${p}（旧版目录式）"
  done
  echo
  echo "安装完成（旧版机制）。重启 DSH 后在预设列表选择「Flash 精简·PTC v1」。"
}

# 我们自己的备份文件会随每次安装/卸载累积（.bak-<时间戳> 与 .bak-tune-<时间戳>）。
# 只保留最近 10 个、且只动这两类命名，避免把用户自己的备份删掉。
prune_backups() {
  local dir keep=10 patterns=( "cordis.patch.yml.bak-[0-9]*-[0-9]*" "cordis.patch.yml.bak-tune-[0-9]*" )
  dir="$(dirname "$PATCH")"
  local f list=()
  for f in "$dir"/cordis.patch.yml.bak-[0-9]*-[0-9]* "$dir"/cordis.patch.yml.bak-tune-[0-9]*; do
    [ -e "$f" ] || continue
    list+=("$f")
  done
  [ "${#list[@]}" -le "$keep" ] && return 0
  # 按修改时间从新到旧，删掉第 keep+1 个之后的
  local i=0
  while IFS= read -r f; do
    i=$((i+1))
    [ "$i" -gt "$keep" ] || continue
    rm -f "$f"
  done < <(ls -1t "${list[@]}" 2>/dev/null)
}

uninstall_modern() {
  [ -f "$PATCH" ] || { echo "缺少 ${PATCH}（无需卸载）" >&2; exit 0; }
  cp "$PATCH" "$PATCH.bak-$STAMP"
  # 顺序要紧：先撤 tune-runtime 块，再 strip 托管块。反过来的话，strip 看到文件里
  # 还有 tune 块、不会补回 `[]`，撤完块就只剩空行 → 整个 profile 起不来（R1-2）。
  local runtime_note=''
  if grep -q '# >>> tune-runtime' "$PATCH" 2>/dev/null; then
    if command -v node >/dev/null 2>&1 && [ -f "$HERE/scripts/tune-runtime.mjs" ]; then
      # --no-backup：下面已经有整份 .bak-${STAMP}，不必再留一份 .bak-tune-*
      node "$HERE/scripts/tune-runtime.mjs" --revert --profile "$PROFILE" --no-backup >/dev/null 2>&1 || true
    fi
    if grep -q '# >>> tune-runtime' "$PATCH" 2>/dev/null; then
      runtime_note="⚠ 仍残留 tune-runtime 块，请手动检查 $PATCH"
    else
      runtime_note='已一并撤掉 ptc-runtime 常驻运行时覆盖'
    fi
  fi
  strip_patch
  echo "已移除托管块（备份 $(basename "$PATCH").bak-${STAMP}）"
  # 不能写成 `[ -n "$x" ] && echo`：$x 为空时这一行整体返回 1，set -e 会让卸载直接失败（CI 抓到过）。
  if [ -n "$runtime_note" ]; then echo "$runtime_note"; fi
  prune_backups
}

uninstall_legacy() {
  # legacy 只提供 v1 旧式目录：与 --all-presets 无关，固定走 v1
  for p in flash-lean-ptc-v1; do
    if [ -e "$LEGACY_DIR/$p" ]; then
      mv "$LEGACY_DIR/$p" "$LEGACY_DIR/$p.removed-$STAMP"
      echo "已移走 $LEGACY_DIR/$p → .removed-$STAMP"
    fi
  done
}

case "$ACTION/$MODE" in
  install/modern)   install_modern ;;
  install/legacy)   install_legacy ;;
  uninstall/modern) uninstall_modern ;;
  uninstall/legacy) uninstall_legacy ;;
  *) echo "内部错误: $ACTION/$MODE" >&2; exit 1 ;;
esac
