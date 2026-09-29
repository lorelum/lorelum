## Context

`scripts/release/build-cli.ts` 只写 `dist/lore`，`scripts/release/build.ts` 已构建、校验并复制 native 到 `dist/release/<target>/`；发布归档复用后者。现有 `build:cli` 命名把前者呈现为常规构建。Backend 的 `daemon.ts` 先调用 `prepareModel`，再由 `embedding-process.ts` 解析 native；`embedding-resources.ts` 将 native 文件系统/manifest 错误映射为模型共用的 `embedding.resource-invalid`。`service.ts` 的 failed 状态只保留 code；Backend client 轮询后及 query CLI 根据 code 重新构造错误，因此底层上下文到不了用户。证据见 `scripts/release/build*.ts`、`packages/backend/src/runtime/{daemon,embedding-resources}.ts`、`packages/backend/src/modules/embedding/{service,dto}.ts`、`packages/backend/src/client/client.ts`。

## Goals / Non-Goals

**Goals:** 用常规 `build:cli` 得到完整可运行目录；缺 native 时不先下载模型；HTTP model status、显式 load 与 query 都提供一致、安全、可机读的资源失败原因及操作指引。

**Non-Goals:** 不更改 release archive/installer、固定模型、自动缓存重下载、backend 启动时机或 keyword 路由。`build:cli-only` 是针对无 embedding 检查的显式例外。

## Decisions

### 构建入口

将 `build:cli` 映射到现有 `scripts/release/build.ts`，单文件路径移为 `build:cli-only`；保留 `build:release-staging` 为兼容别名，撤销尚未提交的 `build:semantic-cli`。两个 benchmark 的复现命令改为 `build:cli-only`，历史验证记录不改。这样只改变入口与文档，不复制打包实现，也不改变发布步骤。相反若继续以新别名表示完整构建，AI/开发者仍容易把 `build:cli` 当权威入口。

### 错误信息的所有权和传递

Backend 定义受限 `ResourceFailure`：`kind: "model" | "native"`、`file`（固定逻辑文件名或 `embedding.modelPath`，不含用户绝对路径）、`check`（`missing`、`invalid`、`size-mismatch`、`sha256-mismatch`、`manifest-mismatch`）、可选 `expected`/`actual`（仅大小或 digest）。`EmbeddingError` 携带这个值并从 code/详情生成稳定、可操作的消息：native 使用新 code `embedding.native-resource-invalid` 与“重装匹配的完整目录”；模型保持 `embedding.resource-invalid`，指向缓存或显式 `modelPath`。文件校验在失败位置捕获实际大小/hash；native manifest 验证将已知检查失败转换为有界结构化结果，未知 I/O 错误保持安全的 `invalid` 而不回显原始路径。完整性规则和目录选择不变。

`EmbeddingService` 在 failed 状态同时保存 code 与 `ResourceFailure`；`ModelStatus` 的可选 `resource` 只在相关失败时出现。HTTP error body、Backend client 与 CLI `CliError`/JSON envelope 将其透传，文本使用同一消息。关键合同形状：

```ts
type ResourceFailure = {
  kind: "model" | "native";
  file: string;
  check: "missing" | "invalid" | "size-mismatch" | "sha256-mismatch" | "manifest-mismatch";
  expected?: string;
  actual?: string;
};
// ModelStatus: error?: EmbeddingErrorCode; resource?: ResourceFailure
// CLI failure: error: { code: string; message: string; resource?: ResourceFailure }
```

只从已验证的枚举和固定/manifest 文件名构造公开 `file`；原始 `Error.message` 可能含本机绝对路径，不能直接传播。相比只改错误文案，这个结构使 query、status 和 `--json` 用户得到同一根因；相比新建多级恢复框架，仍沿用现有 service 状态和 CLI envelope。

### 下载前 native 检查

从现有 `resolveEmbeddingResources` 拆出共享的 native 安装验证函数，供 daemon 的模型准备回调在 `prepareModel` 前调用；native startup 仍重新验证，并用现有 `assertUnchanged` 检查资源未被替换。重复验证有一次本地 hash 成本，但能让缺目录的编译版立即失败且不向远端拉 66 MB 模型；不在 `backend start`、keyword 或只读 status 中触发这项检查。

## Risks / Trade-offs

- [开发脚本兼容性] → `build:cli` 的输出从 `dist/lore` 变为完整目录；更新当前 benchmark/Agent 文档与脚本调用，保留 `build:cli-only` 明确轻量用途。历史记录不改。
- [信息泄露] → 公开字段只用固定逻辑路径、十进制大小和十六进制 digest；未知错误不拼接原始异常、URL 或私有路径。
- [验证成本] → native 在下载前和启动前各校验一次；先以现有 native 文件规模验收，不加缓存或跳过二次校验。

## Migration Plan

本地构建者改用 `build:cli` 并以完整 target 目录为交付单位；原 `build:release-staging` 继续可用。只使用 `dist/lore` 的 benchmark 改为 `build:cli-only`。若发现兼容问题，可恢复原脚本映射；已安装的旧包和模型缓存无须迁移。验证真实编译目录、故意缺 native 的负例及真实 model load/query 后再提交 PR，不自动发布或替换用户的全局安装。
