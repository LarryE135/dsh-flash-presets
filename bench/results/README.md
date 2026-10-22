# bench/results

评测产物目录（CSV）。`*.csv` 已被 .gitignore 排除：

- `runs.csv`：`bench/run.mjs` 追加的每次运行记录（自动创建）。
- `baseline.csv`：回归门的对照基线。第一次批量跑完后，把结果里的非消融臂
  复制为 `baseline.csv` 并提交（`bench/gate.mjs` 默认读这个文件）。
