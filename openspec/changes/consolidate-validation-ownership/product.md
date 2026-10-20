# 去除重复验证与工作：用户流程

## 正常使用

用户沿用完整 CLI/native 安装与原配置，不启用新开关，不清缓存、不重装 Pack。

```sh
lore query "怎样验证修改并避免回归" --top-k 5
lore query "怎样验证修改并避免回归" --mode keyword
lore index status
lore logs --trace-id <本次命令返回的traceId> --json
```

query 仍默认 semantic；keyword 仍离线。ready、partial、preparing、indexing、失败、退出码与完整 JSON/text 的解释不变。index 的模型准备、增量复用、完整发布和恢复不变；本变更不承诺解决默认 timeout 下的冷构建问题。

已安装语料、所选方法和输入相同时，结果、顺序和 coverage 不因删除内部重复工作而改变。安装、更新和资源准备的外部输入仍按原错误边界验证。

## 日志的可见差异

日志等级允许时，一个普通命令保留一个 started 和一个 completed 生命周期记录，不再同时记录两套等价的开始/完成消息。沿用已有 `cli.command.started` / `cli.command.completed` 证据；失败仍保留排障错误、stack 与关联信息。logger 的普通本机 context、凭据排除、私有位置、留存和错误隔离不变。

按 trace 读取时，较早的 direct record 即使落在全局最近记录窗口之外，仍可出现；anonymous shared lifecycle 继续按关系 ID 关联，不吸入其他 trace 的私有 context。损坏、轮转或缺失仍如实报告。

## 配置的读取时点

一个 CLI 调用按需读取一次配置文档。logging、query 等消费者各自验证所属字段；显式参数优先级不变。调用读取配置后，即使用户在它结束前编辑配置，余下流程使用该次读取值，下一次 CLI 调用重新读取。

显式 `--mode keyword` 不验证无关的 semantic method；无效用户输入仍先失败，不为读取配置或连接 Backend 改变错误优先级。logging 配置失败仍按既有方式回落，不能把原命令结果改为失败。`--debug` 不因新增共享机制而提前读取一个本来不需要的配置文件。

## 原有数据与失败恢复

无磁盘 schema、CLI 参数或 config 字段迁移。Store 提交/恢复、源冲突、索引发布审计、损坏共享向量缓存重新编码、下载与 native 完整性、认证、PID/启动时间和日志私有权限不放宽。

日志写入失败仍只影响日志及既有提示，不能改变 query/index/Hook 的业务结果。构建失败不发布未经最终 staging 校验的产物。博客 authored content 在 collection 边界验证，页面投影仍剔除 helper。

## 留给用户决定

本轮不改变 HTTP response 两端的完整 schema 保证、CLI 对任意 JSON 结果的拒绝规则、无效输入的错误时点、SQLite writer 的入口审计、配置路径链接规则或日志同步/私有性/留存政策。具体收益与代价在 design.md 的待决清单，交付时逐项汇报。
