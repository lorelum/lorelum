## 1. 建立统一输出边界

- [x] 1.1 新增 JSON-safe value 的通用树形 text renderer，覆盖 scalar、nested object、array、空 string/集合、`null` 与多行内容；以独立 unit tests 验证完整值和顺序可见。
- [x] 1.2 实现 parser 前的默认 text/显式 `--json` 选择，并让它尊重 `--`、inline option value、separate option value、未知 command 与 parser failure；以 source-level tests 验证 stdout/stderr/exit 行为。
- [x] 1.3 将成功和失败路径收敛到一个 render entrypoint：JSON 保持完整 envelope，text 从同一 data/error 完整生成；以 protocol/main tests 验证 JSON schema、text error recovery 与 exit `0/1/2`。
- [x] 1.4 在 registry 将 `--json` 作为普通 command 可用的 global option，并为 pure custom text layout 建立受限的 internal callback；以 registry snapshot/describe tests 验证 command metadata 与既有 result schema 不变。

## 2. 将所有普通命令接入完整 text

- [x] 2.1 让 root、`describe`、所有 27 个 child command 与 `--version` 在无格式参数时走通用完整 text，`--json` 走原 envelope；以 registry replacement 和真实 command fixtures 覆盖每个 result-schema 类别。
- [x] 2.2 为 root/command Help 与 version 增加仅布局用途的 custom renderer，且以字段/值完整性 tests 验证它们不遗漏 capability data 或 version data；其余 command 不新增按命令投影的 renderer。
- [x] 2.3 删除或不引入 PR #191 风格的 command-specific text decoding、data filtering、Store/Backend I/O 或 state synthesis；用 focused diff review 和 output tests 验证 text 只消费 handler 已返回的 data。

## 3. 迁移 JSON parser 与用户文档

- [x] 3.1 审计并修正 CLI unit/process/native smoke/integration helpers 中的 JSON parse 路径，使其显式传 `--json`；新增默认 text process coverage，验证 Hook ABI 保持未改。
- [x] 3.2 更新 `packages/cli/AGENTS.md`、`docs/cli`、双语 site documentation 与官方 Skills：默认 text 是 Agent/人类可直接阅读的完整视图，任何调用方都不解析它的排版；`--json` 仅供排查、protocol 核对或实际 machine parser 使用；运行相关链接/构建检查。
- [x] 3.3 保留 PR #191 的 text-output 对照审阅文档作为本地交付证据，并确认关闭的 PR、旧分支实现和方向相反的未合并 OpenSpec 不进入新 PR diff。

## 4. 验收与提交前收口

- [x] 4.1 运行 `openspec validate general-cli-text-rendering --type change --strict --no-interactive`、focused CLI output tests、`bun test packages/cli`、`bun run test:integration`、`bun run test:native-smoke`、`bun run typecheck`、`bun run lint`、`bun run build:site` 与 `git diff --check`；native smoke 已按脚本执行，但本机没有它必需的 `/absolute/path/to/granite-q4_0.gguf`，其余检查通过（lint 仅有既有 warning，`fmt:check` 仅报告未修改的 `scripts/release/install-ps1.integration.test.ts`）。
- [x] 4.2 复查完整 diff、staged file list 和 secret-pattern scan，确认没有 Engine/Backend/Store/Hook/MCP 语义改动，没有公共 renderer plugin，没有丢失公开 data 的 text filter，并为新分支创建关联 Issue #194 和 PR #195。
