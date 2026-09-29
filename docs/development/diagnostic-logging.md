# 本机日志与排障

Lorelum 的本机日志用于复盘 CLI、Backend、Hook 与 native runtime 的一次调用链。它不是 telemetry、上传通道、HTTP logs API 或自动 Issue 创建器；日志只留在用户设备，是否把任何内容带出设备由用户在 feedback 或公开提交前另行决定。

## 开发者接入

所有包从 `@lorelum/log` 导入。不要新增全局事件 union、字段注册表或单字段预算；message 是稳定、可搜索的字符串，context 是本机 JSON 调试上下文。

```ts
import { createLogger } from "@lorelum/log";

const log = createLogger({ source: "backend.query", sinks: [sink] }).with({ traceId });

log.debug("query.requested", { query, mode });
log.info("query.completed", { durationMs, resultCount, operationId });
log.error("query.failed", { route: "query", status: 503 }, error);
```

`traceId` 串起一次用户可理解的调用；`requestId`、`operationId`、`preparationId`、`nativeRunId` 是链路中的原子节点。它们是可选 context，不是记录日志的前置条件。没有 trace 的 daemon startup、cleanup 或开发调试也应正常记录。

logger 会自动排除明确的 credential key 和 Bearer-like 值：Authorization、Cookie、token、private key、probe credential 等不能由 logger 自动写入。不要扫描环境、config、完整 HTTP header/body 或仓库来补日志。除此之外，调用方明确写入的 query、Practice、路径、模型路径、native 输出或 Error 会作为本机调试内容保留；不要把“本机记录”误称为“已适合公开”。

## 文件、等级与查看

用户级根目录是 `~/.lorelum/logs/`：

- CLI：`cli/<date>/<traceId>.jsonl`
- Hook：`hooks/<host>/<date>/<traceId>.jsonl`
- Backend：`backend/current.jsonl` 和有限轮转文件

短命令与 Hook 使用各自的段文件，避免并发 append 混写；Backend 是长驻进程，使用轮转文件。自动创建的文件应为当前用户私有。普通写入、rotation、flush 或 cleanup I/O 故障只禁用对应 sink，不能改变已经完成的 query/index/model/Hook 结果；不安全的目标路径仍必须失败，不能写到未知位置。

用户和开发者不要直接依赖 JSONL 行结构。使用 CLI：

```sh
lore logs --trace-id <traceId> --limit 100
lore logs --source hook.codex --level debug
lore logs prune
```

读取不会启动 Backend/model、下载、query 或修改 Store。遇到损坏、轮转或缺失文件时，它会返回部分记录以及 `missingEvidence`，不会把其他 trace 的内容当成匹配结果。`lore logs prune` 只清理 Lorelum 管理且已超过保留范围的日志文件。用户从普通 text failure 的 `diagnostics.traceId` 开始排查时，应按[站点故障排查说明](../../apps/site/content/docs/troubleshooting.mdx)操作；本文不重复用户侧步骤。

## Debug 模式与 Hook

默认持久等级是 `info`。发行版有两种开启详细记录的方式：

```sh
lore --debug query "why did this fail?"
```

或在 `~/.lorelum/config.yaml` 中设置：

```yaml
logging:
  level: debug
```

前者只作用于这一次调用；当它进入 Backend 时，detail 也只会传给同一条 authenticated request 及其关联 request、operation、preparation 和 native lifecycle，不会改写 daemon 的全局等级或影响并发调用。后者适合由宿主自动执行的 Hook 和长期复现。既有 `--log-level` 仍然只控制 stderr 呈现，不能替代这两个收集开关。Hook 在 debug 下可以记录 payload handling、解析、Catalog 渲染和 degraded 原因，但 stdout 必须仍是原宿主 ABI；畸形的非结构化 payload 只记录大小，不原样落盘。

若持久 `logging.level` 写入非法值（例如 `noisy`），本次调用仍按默认 `info` 完成业务命令（fail open 不变），但不再静默：envelope 的 `diagnostics.notices` 携带完整事实组——setting、收到的值、允许 enum、实际生效 level 与 config 来源；同次调用的 stderr 输出一条单行提示（含收到值、允许 enum 与实际生效 level），同 trace 落盘一条 `warn` 级 `logging.level-fallback` 记录（含 setting、收到值、实际生效 level 与 config 来源）。三个入口指向同一回退事实，因此 `lore logs --trace-id` 和 `lore feedback draft --include-logs ...` 能解释"为什么没有预期级别的记录"。`--debug` 覆盖时实际生效等级是 `debug`，提示同时说明持久配置未生效。Lorelum 不会自动改写用户 config；按提示把值改回 `error`/`warn`/`info`/`debug` 即可。

## Feedback 的日志选择

`lore feedback draft --trace-id ...` 默认保留同 trace 的完整 `error`、`warn`、`info` 调用链，以及由 correlation IDs 安全关联的匿名 lifecycle records。它保留普通 query、Practice、结果、路径、原生输出、自由 context、原始 correlation IDs 与已序列化的 Error stack；只有明确 credential 会在日志写入时自动排除。diagnostic facts 仍保留为摘要，不取代完整记录。

```sh
lore feedback draft --trace-id <traceId> --kind bug --include-logs debug
```

`--include-logs info` 与默认选择等价；debug 模式只读取**已经记录**的同 trace 日志，无法补回过去没有开启的 debug，且会在没有任何 debug record 时返回 `debug-records-not-found`。本机 artifact 不因普通 query、结果或路径而要求确认；但上传、创建/更新 Issue 等外发动作必须取得用户明确授权。只有 evidence 实际含 credential 或可识别敏感材料时，才建议审阅、删减或改走私发/工单。若没有足够证据，应建议用 `--debug` 或 `logging.level: debug` 重新复现，而不是猜测日志内容。

## 发行版 stack

`build:cli`、release staging 和 release archive 都显式使用 inline source map，并禁用 minify。这样发行版遇到未处理异常、或 logger 序列化 Error stack 时，位置仍应还原到原始 TypeScript 文件、行和列，而不是 `$bunfs` 或中间 bundle。`scripts/release/compile-cli.test.ts` 会实际运行两种 binary 编译路径（包括 Windows-compatible Bun CLI compiler），以受控异常验证这一合同；以后即使有人提议开启 minify，也必须先保持该验证通过。
