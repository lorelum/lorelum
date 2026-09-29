## MODIFIED Requirements

### Requirement: CLI-first local integration
本地 Agent integration SHALL 使用已发布的 `lore` CLI 加宿主原生 Skill 与 Hook。Plugin、Skill 和 Hook MUST 通过 CLI 的 list、query 与 get 合同取得内容，且 MUST 不直接读取 LocalStore、导入 Engine/Backend、复制排序或错误语义。面向机器的调用 MUST 使用公开 JSON 合同；宿主 Skill 直接阅读结果时 MAY 使用完整的 Agent 可读 text。

#### Scenario: A host needs a relevant Practice
- **WHEN** 宿主 Agent 需要发现或读取 Practice
- **THEN** 集成 MUST 通过 `lore` CLI 的公开 text 或 JSON 合同完成发现、query 或 get，而不得绕过 CLI 访问内部包；自动解析结果的调用方 MUST 使用 JSON

## ADDED Requirements

### Requirement: Hook routing Catalog does not own resource locators
SessionStart Hook 的有界 Catalog SHALL 为每个 Pack 提供名称、非空描述与适用范围，但 MUST 不在每个条目中常驻注入版本或 `packRoot`。Skill 在选中 Practice 后 MUST 从 `get` 的对应 source 读取 Store root 来解析 Pack-root-relative `resource:` 链接；显式浏览 Pack 时 SHALL 从 `pack list <name>` 获取 root。多来源 MUST 分别处理；ProjectContext 的逻辑层标签 MUST 不当作可读目录。

#### Scenario: A resource link is followed without a Catalog root
- **WHEN** Hook Catalog 没有 root 且 Agent 通过 query、get 读到 Store Practice 的资源链接
- **THEN** Agent MUST 使用 get 对应 source 的 root 定位资源，且 MUST 不为普通 query/get 预先重复运行全量 `pack list --details`

#### Scenario: Explicit Pack browsing gets a fresh locator
- **WHEN** 用户明确要求浏览或维护一个已安装 Pack
- **THEN** Skill MUST 从 `pack list <name>` 获取该 Pack 的当前 root，而不得从 Hook Catalog 猜测路径
