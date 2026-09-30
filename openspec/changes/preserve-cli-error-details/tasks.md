# Tasks: preserve-cli-error-details

## 1. Contract and transport

- [x] 1.1 增加封闭 detail 类型、source/reason/expected enums、预算、确定性截断、控制字符转义、text formatter、JSON schema 与防御性 envelope 过滤。
- [x] 1.2 扩展 `CliError`、protocol failure envelope/schema 与 text renderer，同时保留 message-only failures 与 allowlist downgrade 行为；`BackendError` 与 Backend-to-CLI details mapping 延后到 #229。
- [x] 1.3 将 `source` schema 实现为严格 oneOf discriminated shape，并覆盖非法 source variants 的 schema/sanitizer 测试。
- [x] 1.4 保持本 change 不添加无 Backend producer 的 mirror/mapping 预留；#229 交付实际配置 producer 时补充 mirror-contract drift 与无损 translation 测试。

## 2. Minimal producers

- [x] 2.1 将 structured facts 接入 query integer option validation，保持 `usage.invalid` 与 exit 2。
- [x] 2.2 将 structured facts 接入 query user settings validation，保持 `query.config-invalid` 与 exit 2。

## 3. Verification and docs

- [x] 3.1 为 factory、schema、renderer、runtime allowlist 与两条端到端 fixtures 增加 unit/process tests。
- [x] 3.2 更新 maintainer 与双语站点文档，并运行 CLI/Backend tests、typecheck、lint、formatting 与 strict OpenSpec validation。
- [x] 3.3 将 proposal/design/tasks 全部改为中文，并补齐当前主 spec 的 Purpose。
- [x] 3.4 同步最新 upstream/main，解决 #258 的 concise text 文档重叠并重跑验证。
