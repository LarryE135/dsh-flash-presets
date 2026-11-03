#!/usr/bin/env bash
# Install the Flash 精简 presets into a DSH home.
#
# DSH 0.1.7-rc.1 changed how presets are declared: the old per-preset directory
# ($DSH_HOME/.agent-presets/<id>/) is no longer read; a preset is now a plugin row
# (`@deepseek-ai/dsh-agent-preset`) inserted into a profile's user patch layer.
# This script writes a managed block into the profile patch file, and falls back
# to the legacy directory install for older DSH versions.
#
#   bash scripts/install.sh                       # profile "web" (autodetect)
#   bash scripts/install.sh --profile headless     # another profile
#   bash scripts/install.sh --legacy               # force the 0.1.5 directory layout
#   bash scripts/install.sh --with-plan-mode       # 预设 + 计划模式插件（独立包）一次装齐
#   bash scripts/install.sh --uninstall            # remove the managed block
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
# 0.2.6 起只发两个预设：v3（默认）与 v3 max（解除预算限制）
PRESETS=(flash-lean-ptc-v3 flash-lean-ptc-v3-max)
# --with-plan-mode：预设之外再把计划模式插件（独立包 dsh-plan-mode-ui）装上；
# 两者互相独立，装失败不影响预设本身。
PLAN_MODE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)   [ -n "${2:-}" ] || { echo "--profile 需要参数" >&2; exit 2; }
                 PROFILE="$2"; shift 2 ;;
    --legacy)    MODE="legacy"; shift ;;
    --modern)    MODE="modern"; shift ;;
    --all-presets) PRESETS=(flash-lean-ptc-v3 flash-lean-ptc-v3-max); shift ;;
    --with-plan-mode) PLAN_MODE=1; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    -h|--help)   sed -n '2,19p' "$0"; exit 0 ;;
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
  cp "$PATCH" "$PATCH.bak-$STAMP"
  echo "已备份 $PATCH → $(basename "$PATCH").bak-$STAMP"
  merge_patch
  echo "已写入托管块：$PATCH"
  validate_patch
  echo
  echo "安装完成。web profile 是 live reload：无需重启，刷新 GUI 即可在预设列表看到"
  echo "「轻量PTC-v3」与「轻量PTC-v3 max」。"
  echo "  计划模式是独立包：bash scripts/install.sh --with-plan-mode（或 dsh plugin add dsh-plan-mode-ui）"
  echo "  自检：dsh --profile $PROFILE --dump-config | grep -A3 'id: preset-flash-lean-ptc-v3-max'"
  echo "  体检：node scripts/doctor.mjs --profile $PROFILE   （版本/重复行/!!js/解析 一次过）"
  echo "  卸载：bash scripts/install.sh --uninstall --profile $PROFILE"
  if [ "$PLAN_MODE" = "1" ]; then install_plan_mode; fi
}

# 计划模式插件是独立包（dsh-plan-mode-ui）：自带组合包补丁与浏览器半边，与预设包互不依赖。
# 装它等于把这个包加进 profile；升级要先 remove 再 add（插件管理器不接受同名重复安装）。
install_plan_mode() {
  echo
  echo "-- 计划模式插件（独立包 dsh-plan-mode-ui）-----------------------"
  if ! command -v dsh >/dev/null 2>&1; then
    echo "! PATH 里没有 dsh 命令，跳过。等 dsh 可用后手动执行："
    echo "  dsh plugin --profile $PROFILE add dsh-plan-mode-ui"
    echo "  node scripts/tune-runtime.mjs --apply --profile $PROFILE"
    return 0
  fi
  _PLUGIN_VERSION="$(node -p "require('$HERE/plugins/plan-mode-ui/package.json').version" 2>/dev/null || echo "")"
  _TGZ="$HERE/dist/dsh-plan-mode-ui-${_PLUGIN_VERSION}.tgz"
  _INSTALLED=0
  if [ -f "$DSH_DIR/profiles/$PROFILE/node_modules/dsh-plan-mode-ui/package.json" ]; then
    _CUR="$(node -p "require('$DSH_DIR/profiles/$PROFILE/node_modules/dsh-plan-mode-ui/package.json').version" 2>/dev/null || echo "")"
    if [ -n "$_CUR" ] && [ "$_CUR" = "$_PLUGIN_VERSION" ]; then
      echo "✓ 计划模式插件已是 ${_CUR}，跳过安装"
      _INSTALLED=1
    else
      dsh plugin --profile "$PROFILE" remove dsh-plan-mode-ui >/dev/null 2>&1 || true
    fi
  fi
  if [ "$_INSTALLED" = "0" ]; then
    # 本地 tgz 优先：npm 上的 dsh-plan-mode-ui 可能还是旧版，装错版本比不装更难查
    if [ -f "$_TGZ" ] && dsh plugin --profile "$PROFILE" add "file:${_TGZ}" >/dev/null 2>&1; then
      echo "✓ 计划模式插件已装（本地包 $(basename "$_TGZ")）"
      _INSTALLED=1
    elif dsh plugin --profile "$PROFILE" add dsh-plan-mode-ui >/dev/null 2>&1; then
      echo "✓ 计划模式插件已装（npm：dsh-plan-mode-ui）"
      _INSTALLED=1
    fi
  fi
  if [ "$_INSTALLED" = "0" ]; then
    echo "! 计划模式插件没装上（npm 尚未发布它时属正常）。稍后手动二选一："
    echo "  dsh plugin --profile $PROFILE add dsh-plan-mode-ui"
    echo "  dsh plugin --profile $PROFILE add file:${_TGZ}"
  fi
  if command -v node >/dev/null 2>&1 && [ -f "$HERE/scripts/tune-runtime.mjs" ]; then
    if node "$HERE/scripts/tune-runtime.mjs" --apply --profile "$PROFILE" >/dev/null 2>&1; then
      echo "✓ 运行时调优已就位（常驻 PTC + glob/grep 并发；改过配置需重启 dsh）"
    else
      echo "⚠ 运行时调优未完成，稍后可手动跑：node scripts/tune-runtime.mjs --apply --profile $PROFILE"
    fi
  fi
  echo "  体检：node scripts/doctor.mjs --profile $PROFILE --all"
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

uninstall_modern() {
  [ -f "$PATCH" ] || { echo "缺少 ${PATCH}（无需卸载）" >&2; exit 0; }
  cp "$PATCH" "$PATCH.bak-$STAMP"
  strip_patch
  echo "已移除托管块（备份 $(basename "$PATCH").bak-${STAMP}）"
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
