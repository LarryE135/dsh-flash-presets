#!/usr/bin/env bash
# 应用/回滚「PTC 重声明自动重试」补丁（process.js 与 persistent-process.js 两个求值器都要打）。
# 用法: apply.sh {check|apply|revert}   演练: SUDO= DSH_ROOT=/tmp/mirror ./apply.sh apply
set -uo pipefail

DSH_ROOT=${DSH_ROOT:-/usr/lib/node_modules/@deepseek-ai/dsh}
SUDO=${SUDO-sudo}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
REF="$REPO/backups/2026-11-15"
LIB="$DSH_ROOT/node_modules/@deepseek-ai/dsh-ptc-runtime-node/lib"
NAMES="process.js persistent-process.js"

die() { echo "错误: $*" >&2; exit 1; }
md5() { md5sum "$1" | cut -d' ' -f1; }

state_of() { # $1=name -> orig|patched|unknown
  local t="$LIB/$1" o="$REF/dsh-ptc-$1.orig" p="$REF/dsh-ptc-$1.patched"
  [ -f "$t" ] || { echo missing; return; }
  if [ "$(md5 "$t")" = "$(md5 "$o")" ]; then echo orig
  elif [ "$(md5 "$t")" = "$(md5 "$p")" ]; then echo patched
  else echo unknown; fi
}

case "${1:-}" in
  check)
    for n in $NAMES; do echo "  $n: $(state_of $n)"; done ;;
  apply)
    for n in $NAMES; do
      s=$(state_of $n)
      if [ "$s" = patched ]; then echo "  $n: 已是补丁状态"; continue; fi
      if [ "$s" = unknown ]; then
        if [ -f "$LIB/$n.orig" ] && [ "$(md5 "$LIB/$n.orig")" = "$(md5 "$REF/dsh-ptc-$n.orig")" ]; then
          echo "  $n: 未知状态但 .orig 可信 -> 覆盖"
        else die "$n 与已知版本都不同，且 .orig 不可信，拒绝覆盖"; fi
      fi
      [ -f "$LIB/$n.orig" ] || $SUDO cp -p "$LIB/$n" "$LIB/$n.orig" || die "$n 备份失败"
      $SUDO cp "$REF/dsh-ptc-$n.patched" "$LIB/$n" || die "$n 写入失败"
      [ "$(md5 "$LIB/$n")" = "$(md5 "$REF/dsh-ptc-$n.patched")" ] || die "$n 写入后校验失败"
      node --check "$LIB/$n" || die "$n 语法检查不通过，请立即 revert"
      echo "  $n: OK 已打补丁"
    done ;;
  revert)
    for n in $NAMES; do
      s=$(state_of $n)
      if [ "$s" = orig ]; then echo "  $n: 本来就是原版"; continue; fi
      if [ "$s" != patched ]; then
        if [ -f "$LIB/$n.orig" ] && [ "$(md5 "$LIB/$n.orig")" = "$(md5 "$REF/dsh-ptc-$n.orig")" ]; then
          echo "  $n: 未知状态（旧版补丁），但 .orig 可信 -> 直接还原官方原版"
        else die "$n 状态未知且 .orig 不可信，拒绝覆盖"; fi
      fi
      $SUDO cp "$REF/dsh-ptc-$n.orig" "$LIB/$n" || die "$n 回滚写入失败"
      [ "$(md5 "$LIB/$n")" = "$(md5 "$REF/dsh-ptc-$n.orig")" ] || die "$n 回滚校验失败"
      echo "  $n: OK 已回滚"
    done ;;
  *) echo "用法: $0 {check|apply|revert}"; exit 2 ;;
esac