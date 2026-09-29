# 验证记录（2026-09-29）

本记录对应 2026-09-29 的源码 worktree 验证。默认 text 与 `--verbose` 使用同一命令/Store data；后者是变更前完整 text 的等价展示，因此下面的字节数是一次固定样本的输出比较，不是 token、准确率或总体性能结论。

| 样本 | 默认 text | 完整 text（`--verbose`） | 减少 |
| --- | --: | --: | --: |
| 一个已安装 Pack 的 `pack list` | 53 bytes | 192 bytes | 139 bytes |
| `--mode keyword --no-project --top-k 2` 的资源作者 query | 943 bytes | 1149 bytes | 206 bytes |
| 带资源链接与反模式的单篇 `get --no-project` | 4438 bytes | 4645 bytes | 207 bytes |

Hook 的同一个单 Pack 测试样本包含 header/intro/footer，按原 renderer 规则重建的旧 Catalog 为 412 characters，新 Catalog 为 345 characters，减少 67 characters（16.3%）；这也不是 token 测量。三项 CLI 比较使用 `bun packages/cli/src/main.ts`，显式隔离 `--store-root`；资源样本来自本机已安装的 `pack-creator` Pack 的目录 source 安装到临时 Store，不使用全局 `lore` binary 验证本 worktree 代码。

该临时 Store 上，默认 `get pack-creator.authoring.link-pack-resources-from-the-practice` 的正文包含 `[resource authoring guide](resource:references/pack-resources.md)`，同一次结果的 Store source 包含可读 `packRoot`；按该 root 拼接链接目标可以读到实际文件，普通 query→get 无须再 list。具名 `pack list pack-creator` 也提供 root。真实 keyword query 成功。首次 semantic index sync 遇到已有 Backend 的 `backend.build-mismatch`；按返回的 `stop-if-idle` 恢复指引确认其 `stopped` 后重试，在同一隔离 Store 上以源码 CLI 完成默认 semantic query，命中目标 Practice，并从后续默认 `get` 的 source root 读到 `resource:` 文件。演示后 Backend 已安全停止。

字段选择正确率、相似候选的补查次数和 Agent 端到端总 token 尚未按 Issue #231 的对照方法实测；本次验证只能说明确定性的输出/资源合同和这组固定样本的长度。

最终本地检查：`bun test packages/cli` 为 374 pass、1 个 Windows 专属用例在 macOS skip、0 fail；`bun run --filter @lorelum/site test` 为 41 pass；`bun run typecheck`、`bun run lint`、`bun run --filter @lorelum/site build`、`openspec validate trim-agent-cli-output --strict` 和 `git diff --check` 均退出 0。英文/中文站点参考页及 CLI/Agent 总览随行为一起更新，站点构建完成 prerender。源码 CLI 的真实 Store semantic query→get→resource 已验证；已安装 Plugin 的真实宿主会话未运行，不把源码 Hook 测试算作宿主验证。测试用隔离 Store 已移入废纸篓，可恢复；仓库内没有保留该临时 Store。
