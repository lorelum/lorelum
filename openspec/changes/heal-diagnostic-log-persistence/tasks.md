# Tasks

## 1. 受管位置原语（packages/log）

- [x] 1.1 `sinks/safety.ts`：`evaluateManagedTarget` 纯函数（注入 facts/options）、同句柄 `inspectAndTightenHandle`（fstat → 掩码 fchmod → fstat 复核，失败即拒绝、无路径 chmod 回退）、`O_NOFOLLOW` 打开与 ELOOP/ENOTDIR 消歧、类型化 `ManagedLogLocationError`、`walkManagedLocation`（信任根结构门：非 symlink/是目录/归本用户，不看 mode、不触其上；受管段缺失则 `0700` 创建并在句柄上设 mode，已存在则句柄上判定/收紧）。
- [x] 1.2 `safety.test.ts`：纯函数矩阵（safe/repairable/unsafe × 结构、nlink、mode、uid、特殊位保留、win32 仅结构）与真实 fs walk（缺失链创建、宽段收紧、信任根逐 bit 不变、symlink/非目录/越界拒绝）。

## 2. JsonlFileSink 接线（packages/log）

- [x] 2.1 `sinks/jsonl.ts`：walk 接线（每写重走，保留替换防御）；目标文件先 `O_APPEND|O_WRONLY|O_NOFOLLOW` 打开、仅 ENOENT 才 `O_CREAT 0600`，在写入句柄上判定/收紧后追加；首次失败以 `{category, path, detail?}` 暴露（`getter failure`），静默禁用语义不变。
- [x] 2.2 `jsonl.test.ts`：`0755` 信任根下写入成功且根逐 bit 不变；宽子树目录与 `0644` 文件被掩码收紧；symlink 目标/硬链接（`nlink > 1`）不写不碰；`0505` 拒绝且 mode 不动；首失败类别；健康路径 `failure === undefined`；既有并发与替换防御用例保持通过。

## 3. 当次报告（packages/cli）

- [x] 3.1 `log/runtime.ts`：`sinkFailureNotice` 渲染（通用类别 + 信任根异主的非递归 chown 指引）与 `flush()` 单点 stderr 发送（覆盖全部 CLI 出口与 Hook）；健康路径安静。
- [x] 3.2 `runtime.test.ts`：渲染器文案（含指引不含 `-R`）+ 安静路径 + 恰好一行提示。

## 4. 端到端守卫（packages/cli）

- [x] 4.1 `log/persistence-home.integration.test.ts`（子进程、隔离 HOME、生产 `homedir()` 路径）：`0755` 根写入成功、HOME 与根逐 bit 不变、文件 `0600`/子树 `0700`、`lore logs --trace-id` 读回记录；不可用根下 envelope（除 traceId）与 exit code 和健康路径一致、恰好一行 stderr 提示、HOME 不变、symlink 目标内容保持。

## 5. 验证

- [x] 5.1 `bun test`（1120 pass / 0 fail / 16 skip）、`bun run typecheck`、`bun run lint`（36 警告 = main 基线，0 error）、`bun run fmt:check`（本变更文件全干净；main 既有 12 个脏文件未触碰）。
- [x] 5.2 `openspec validate heal-diagnostic-log-persistence --strict`（通过）。
- [ ] 5.3 PR 描述报告实际结果与未验证项（macOS 未本机验证；Windows 由相应侧复验）。
