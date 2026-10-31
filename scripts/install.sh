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
#   bash scripts/install.sh --with-plan-mode       # 预设 + 计划模式插件一次装齐
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
# 0.2.5 起默认只装 v3（现行主版本）；v1/v2 是对照版本，用 --all-presets 显式安装
PRESETS=(flash-lean-ptc-v3)
# --with-plan-mode：装完预设后顺带装计划模式插件（可选组件；失败不影响预设）
PLAN_MODE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)   [ -n "${2:-}" ] || { echo "--profile 需要参数" >&2; exit 2; }
                 PROFILE="$2"; shift 2 ;;
    --legacy)    MODE="legacy"; shift ;;
    --modern)    MODE="modern"; shift ;;
    --all-presets) PRESETS=(flash-lean-ptc-v1 flash-lean-ptc-v2 flash-lean-ptc-v3); shift ;;
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
  echo "「Flash 精简·PTC v3（v4.1-flash，lean-v3）」。"
  echo "  v1/v2 是对照版本，默认不装；需要 A/B 时重跑：bash scripts/install.sh --all-presets"
  echo "  自检：dsh --profile $PROFILE --dump-config | grep -A3 'id: preset-flash-lean-ptc-v3'"
  echo "  体检：node scripts/doctor.mjs --profile $PROFILE   （版本/重复行/!!js/解析 一次过）"
  echo "  卸载：bash scripts/install.sh --uninstall --profile $PROFILE"
  if [ "$PLAN_MODE" = "1" ]; then install_plan_mode; fi
}

# 计划模式插件（可选组件）：优先用 dist/ 里现成的 tgz，没有就现打一个，都没有退回目录。
# 没有 dsh 命令时只打印等价命令 —— 预设已经装好，不把安装判失败。
install_plan_mode() {
  echo
  echo "── 计划模式插件（--with-plan-mode）────────────────────────────"
  _spec=""
  _tgz=$(ls -1t "$HERE"/dist/dsh-plan-mode-ui-*.tgz 2>/dev/null | head -1 || true)
  if [ -n "$_tgz" ]; then
    _spec="$_tgz"
  elif command -v npm >/dev/null 2>&1 && [ -f "$HERE/plugins/plan-mode-ui/package.json" ]; then
    mkdir -p "$HERE/dist"
    if (cd "$HERE/plugins/plan-mode-ui" && npm pack --ignore-scripts --pack-destination "$HERE/dist" >/dev/null 2>&1); then
      _tgz=$(ls -1t "$HERE"/dist/dsh-plan-mode-ui-*.tgz 2>/dev/null | head -1 || true)
      if [ -n "$_tgz" ]; then _spec="$_tgz"; echo "已打包插件：$(basename "$_spec")"; fi
    fi
  fi
  if [ -z "$_spec" ] && [ -d "$HERE/plugins/plan-mode-ui" ]; then
    _spec="$HERE/plugins/plan-mode-ui"
    echo "⚠ 没有 tgz，退回目录方式（开发用；正式安装建议先 npm pack）"
  fi
  if [ -z "$_spec" ]; then
    echo "⚠ 找不到插件来源，跳过。手动装：dsh plugin --profile $PROFILE add dsh-plan-mode-ui"
    return 0
  fi
  if command -v dsh >/dev/null 2>&1; then
    if dsh plugin --profile "$PROFILE" add "$_spec"; then
      echo "✓ 插件已装：dsh-plan-mode-ui（重启 dsh web 后硬刷新页面）"
      echo "  体检：node scripts/doctor.mjs --profile $PROFILE --all"
    else
      echo "⚠ 插件安装失败（预设已装好，不受影响）。手动重试："
      echo "  dsh plugin --profile $PROFILE add \"$_spec\""
    fi
  else
    echo "⚠ PATH 里没有 dsh 命令，插件未安装。等 dsh 可用后手动执行："
    echo "  dsh plugin --profile $PROFILE add \"$_spec\""
  fi
}

install_legacy() {
  # legacy 只提供 v1 旧式目录：与 --all-presets 无关，固定走 v1
  for p in flash-lean-ptc-v1; do
    src="$HERE/presets/legacy-0.1.5/$p"
    if [ ! -d "$src" ]; then
      echo "跳过 ${p}：本版未提供旧式目录（legacy 仅保留 v1）"
      continue
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
