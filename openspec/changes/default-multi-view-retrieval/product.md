# 默认使用多视图检索

## 正常路径

新用户正常执行 `lore pack install agentic-coding`。安装先提交 Pack，再按默认多视图方法提交索引。完成后执行 `lore query "如何保持索引快照一致"`，使用多视图文档与 query 投影；无需手填 `query.retrievalMethod` 或重新启动 Backend。`--json` 的 semantic data 中 `retrievalMethod` 为 `multi-view-vector`；默认精简 text 不重复显示默认方法，`--verbose` 仍完整显示。

如果安装返回 `indexSync.state: pending`，或首次 query 返回 preparing/indexing，仍通过原来的 operation/status 与重试路径观察；本次不隐藏 pending，不改前台等待预算，也不自动降级 keyword。

## 已有用户

- 没有显式设置方法，只有 single-vector 索引：新构建下 `lore index status` 可能报告多视图目标 missing；该只读命令不触发构建。下一次普通 query 或 install/index build 提交该方法自己的构建。旧 single 索引保留，不把它冒充多视图 ready，也不改变 canonical Pack。
- 已显式选择 multi-view-vector：继续使用原有 Profile 和兼容索引，不因成为默认而重建。
- 已显式选择 single-vector：设置继续生效，普通 query、index 和 install 同步仍使用 single；没有自动改写配置或方法替换。
- 需要保留原来的整条 Practice 检索：在用户配置加入 `query.retrievalMethod: single-vector`。需要仅比较一次时，执行 `lore query "如何保持索引快照一致" --mode single-vector`；它不写配置，下一次普通查询恢复多视图默认。
- 删除 `retrievalMethod` 或使用空 query 配置：回到多视图默认，而不是旧 single 默认。
- keyword：`--mode keyword` 保持离线，不读取或校验未使用的 semantic 方法设置。

## 结果、边界与恢复

更换默认可能改变排序、query views 数和向量数。本次没有修改既有多视图的 task-card/body/clause 切片预算与聚合公式，不承诺所有 query 的排名都更好，也不声称解决独立的检索质量问题。内存实测只覆盖已测 Pack 和主机，不构成全语料容量保证。

新默认索引准备失败时，仍报告现有模型或索引错误；Pack 安装不回滚。用户修正模型来源后可沿现有 load/build/query 路径重试，或显式选择 single 方法使用其保留产物。不会自动删除缓存、重新下载模型或迁移 canonical Store。切回兼容方法可以复用其缓存，不混用另一方法的向量。
