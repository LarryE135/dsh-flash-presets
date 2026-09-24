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
PRESETS=(flash-lean flash-lean-ptc)

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)   PROFILE="${2:?--profile 需要参数}"; shift 2 ;;
    --legacy)    MODE="legacy"; shift ;;
    --modern)    MODE="modern"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    -h|--help)   sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（用 --help 看用法）" >&2; exit 2 ;;
  esac
done

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
merge_patch()  { node "$HERE/scripts/merge-presets.mjs" --patch "$PATCH"; }
strip_patch()  { node "$HERE/scripts/merge-presets.mjs" --patch "$PATCH" --remove >/dev/null; }

validate_patch() {
  if command -v node >/dev/null 2>&1 && [ -f "$HERE/scripts/verify-yaml.mjs" ]; then
    if node "$HERE/scripts/verify-yaml.mjs" "$PATCH" >/dev/null 2>&1; then
      echo "YAML 校验通过。"
    else
      echo "✖ YAML 校验未通过，请运行：node $HERE/scripts/verify-yaml.mjs $PATCH" >&2
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
  echo "「Flash 精简（v4.1-flash）」与「Flash 精简·PTC（v4.1-flash）」。"
  echo "  自检：dsh --profile $PROFILE --dump-config | grep -A3 'id: preset-flash-lean'"
  echo "  卸载：bash scripts/install.sh --uninstall --profile $PROFILE"
}

install_legacy() {
  for p in "${PRESETS[@]}"; do
    src="$HERE/presets/legacy-0.1.5/$p"
    [ -d "$src" ] || { echo "缺少目录: $src" >&2; exit 1; }
    if [ -e "$LEGACY_DIR/$p" ]; then
      echo "已存在 $LEGACY_DIR/$p → 备份为 .bak-$STAMP"
      mv "$LEGACY_DIR/$p" "$LEGACY_DIR/$p.bak-$STAMP"
    fi
    mkdir -p "$LEGACY_DIR/$p"
    cp "$src/preset.yml" "$src/agent.cordis.yml" "$LEGACY_DIR/$p/"
    echo "已安装 $LEGACY_DIR/${p}（旧版目录式）"
  done
  echo
  echo "安装完成（旧版机制）。重启 DSH 后在预设列表选择「Flash 精简」/「Flash 精简·PTC」。"
}

uninstall_modern() {
  [ -f "$PATCH" ] || { echo "缺少 ${PATCH}（无需卸载）" >&2; exit 0; }
  cp "$PATCH" "$PATCH.bak-$STAMP"
  strip_patch
  echo "已移除托管块（备份 $(basename "$PATCH").bak-${STAMP}）"
}

uninstall_legacy() {
  for p in "${PRESETS[@]}"; do
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
