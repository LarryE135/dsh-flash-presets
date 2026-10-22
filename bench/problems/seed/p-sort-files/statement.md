# P-sort-files：合并去重排序（脚本型 + 可复跑交付）

工作目录的 `data/` 里有三个数据文件 `numbers-1.txt`、`numbers-2.txt`、`numbers-3.txt`，每行一个整数（可重复、无序、共约 3 万行）。任务：

1. 把三个文件合并、去重、升序排序；
2. 前 100 个数写到 `result.txt`（每行一个，不保留多余空白或空行）；
3. `merge.mjs`：可被 `node merge.mjs` 独立运行、无网络、无第三方依赖，从 `data/` 读取并按同样的规则重算，把前 100 个数打印到标准输出；judge 会执行它复算并对时（时限见 limits.json，超时判错）；
4. `verify.log` 记录你实际跑过的核对命令与其关键输出。

judge 只看 `result.txt` 是否正确、`merge.mjs` 是否在时限内输出同样的前 100 个数——两者都满足才满分。
