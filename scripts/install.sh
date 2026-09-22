#!/usr/bin/env bash
# Install the presets of this repository into a DSH home.
#
#   bash scripts/install.sh              # -> ~/.dsh/.agent-presets/
#   DSH_HOME=/path bash scripts/install.sh
#
# Existing preset directories are moved aside as <name>.bak-<timestamp> first,
# so this is safe to run repeatedly.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DSH_HOME:-$HOME/.dsh}/.agent-presets"
STAMP="$(date +%Y%m%d-%H%M%S)"
PRESETS=(flash-lean flash-lean-ptc)

for p in "${PRESETS[@]}"; do
  src="$HERE/presets/$p"
  [ -d "$src" ] || { echo "缺少目录: $src" >&2; exit 1; }
  if [ -e "$DEST/$p" ]; then
    echo "已存在 $DEST/$p → 备份为 $DEST/$p.bak-$STAMP"
    mv "$DEST/$p" "$DEST/$p.bak-$STAMP"
  fi
  mkdir -p "$DEST/$p"
  cp "$src/preset.yml" "$src/agent.cordis.yml" "$DEST/$p/"
  echo "已安装 $DEST/$p"
done

echo
echo "安装完成。"
echo "  校验：DSH_HOME=\"${DSH_HOME:-$HOME/.dsh}\" node \"$HERE/scripts/verify-presets.mjs\""
echo "  随后重启 DSH（或刷新 GUI），在预设列表选择「Flash 精简」/「Flash 精简·PTC」。"
