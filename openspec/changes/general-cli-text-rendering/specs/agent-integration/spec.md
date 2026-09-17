## MODIFIED Requirements

### Requirement: CLI-first local integration

本地 Agent integration SHALL 使用已发布的 `lore` CLI 加宿主原生 Skill 与 Hook。Plugin、Skill 和 Hook MUST 通过 CLI 的 list、query 与 get 合同取得内容，且 MUST 不直接读取 LocalStore、导入 Engine/Backend、复制排序或错误语义。Agent/Skill 的普通 list、query、get 与资源定位 SHALL 直接阅读默认完整 text；它们 MUST NOT 把 text 的排版当作可解析机器协议。仅当排查异常、核对 protocol envelope、检查精确结构化字段或把结果明确交给机器 parser 时，调用方 MAY 显式传入 `--json` 并解析 JSON envelope。脚本和 CI 凡实际解析 payload MUST 显式传入 `--json`。`lore hook codex` 与 `lore hook zcode` 仍使用各自专用 Hook ABI，而不使用普通格式协商。

#### Scenario: A host needs a relevant Practice

- **WHEN** 宿主 Agent 需要发现或读取 Practice
- **THEN** 集成 MUST 通过默认 text 的 `lore` CLI 完成发现、query 或 get，并直接阅读完整公开数据；不得解析 text 排版或绕过 CLI 访问内部包。仅在排查该调用的异常时，MAY 以 `--json` 核对 envelope

### Requirement: Catalog-aware targeted retrieval

CLI-first 集成的 Skill SHALL 将已提供的 Installed Pack Catalog 仅作为 routing metadata，而不得将其当成完整 Practice 内容或不存在相关 guidance 的证明。generic Skill 在任务上下文没有可用 Catalog 时 MUST 执行一次默认 text 的 `lore pack list --details` 建立 Catalog，并在当前任务复用结果；Codex Skill 在 Hook 已注入 Catalog 时 MUST 复用它而不得重复 list。Hook MUST 保持 metadata-only，且不得自动执行 `lore query` 或 `lore get`。当 Skill 判定 material task、decision、verification、recovery 或 completion moment 值得检索时，MUST 先执行一次默认 text 的 targeted natural-language semantic query；准备使用某个 Practice 前 MUST 以默认 text 读取其完整内容。

#### Scenario: Generic Skill establishes a missing Catalog once

- **WHEN** generic Skill 的当前任务上下文没有可用的 Installed Pack Catalog，且需要检索 guidance
- **THEN** Skill MUST 只执行一次 `lore pack list --details` 建立 Catalog，并在后续普通编辑、命令或回复前复用它

#### Scenario: Codex reuses Hook-injected Catalog

- **WHEN** Codex Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行默认 text 的 targeted semantic query，且不得重新执行 list

#### Scenario: ZCode reuses Hook-injected Catalog

- **WHEN** ZCode 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行默认 text 的 targeted semantic query，且不得重新执行 `lore pack list --details`

### Requirement: Semantic-first recovery preserves CLI semantics

Skill MUST 不因预期延迟跳过可执行的 semantic query，也不得在首次 query 前预检 Backend、model、index 或 status。默认 text 中可见的 preparing state 或 error MUST 被视为 lifecycle state 或 actionable error，而不是空结果或无相关 Practice 的证据；Skill MUST 先按对应 recovery reference 处理，再重试同一个 semantic query。排查需要核对 envelope 或精确字段时，Skill MAY 用 `--json` 复现同一调用。keyword retrieval MUST 只在调用方明确要求 offline lexical lookup 或 semantic-runtime diagnosis 时通过 `--mode keyword` 选择，并明确标识其为 keyword result；Skill MUST 不将其作为自动 fallback。

#### Scenario: Preparing query does not fall back to keyword

- **WHEN** targeted semantic query 返回 `data.state: "preparing"`
- **THEN** Skill MUST 不返回空 guidance 或自动执行 keyword query，而必须在准备完成后重试同一个默认 text 的 semantic query

#### Scenario: Explicit offline lookup uses keyword mode

- **WHEN** 调用方明确要求 offline lexical lookup 或诊断 semantic runtime
- **THEN** Skill MAY 使用 `--mode keyword`，并 MUST 将结果标识为 keyword retrieval；仅在诊断中需要精确 envelope 时才追加 `--json`
