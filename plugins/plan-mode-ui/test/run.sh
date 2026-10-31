#!/usr/bin/env bash
# 全量测试：遍历 test/*.mjs，逐个跑、逐个报告；任一失败整体失败。
# v0.5.3 起：之前只跑 smoke + features 两个，另外 9 个回归测试平时从不执行。
set -u
cd "$(dirname "$0")/.." || exit 1

# 依赖 @deepseek-ai/dsh-llm（peer）。优先用现成的 node_modules，否则软链到 DSH 的全局安装。
LINKED=0
if [ ! -e node_modules ]; then
  for cand in "${DSH_NODE_MODULES:-}" "$(npm root -g 2>/dev/null)/@deepseek-ai/dsh/node_modules" /usr/lib/node_modules/@deepseek-ai/dsh/node_modules; do
    if [ -n "$cand" ] && [ -d "$cand" ]; then
      ln -sfn "$cand" node_modules && LINKED=1 && break
    fi
  done
fi
if [ ! -e node_modules ]; then
  echo "找不到 @deepseek-ai/dsh 的 node_modules：先 npm i -g @deepseek-ai/dsh，或用 DSH_NODE_MODULES 指定路径"
  exit 2
fi

fail=0
pass=0
failed=""
for f in test/*.mjs; do
  name=$(basename "$f")
  log="/tmp/pmo-test-$name.log"
  if node "$f" >"$log" 2>&1; then
    printf "  OK   %s\n" "$name"
    pass=$((pass + 1))
  else
    printf "  FAIL %s\n" "$name"
    tail -12 "$log" | sed "s/^/       /"
    fail=$((fail + 1))
    failed="$failed $name"
  fi
done

[ "$LINKED" = "1" ] && rm -f node_modules
echo "passed $pass, failed $fail"
if [ "$fail" -ne 0 ]; then
  echo "failed:$failed"
  exit 1
fi