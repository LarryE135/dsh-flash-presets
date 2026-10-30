#!/usr/bin/env bash
# v0.4.0：smoke（设置/提示词/无审批残留）+ features（两阶段推进/计划纠偏/scope 语义）
set -u
cd "$(dirname "$0")/.." || exit 1
LINKED=0
if [ ! -e node_modules ]; then
  ln -sfn /usr/lib/node_modules/@deepseek-ai/dsh/node_modules node_modules || exit 1
  LINKED=1
fi
fail=0
node test/smoke.mjs || fail=1
node test/features.mjs || fail=1
if [ "$LINKED" = "1" ]; then rm -f node_modules; fi
exit $fail
