## ADDED Requirements

### Requirement: Registry and local directory source routes are exclusive

`lore pack install` 与 `lore pack update` SHALL 支持 selected Registry release 或显式 local Pack directory 两条 source route。Registry route 保留 Pack specifier 和 Registry selection 行为；local directory route 只通过 non-empty `--path <directory>` 选择，且其 source acquisition MUST NOT 读取 Registry、解析 release version、执行 Git 或访问 Registry/network source client。canonical install 完成后的既有 `indexSync` lifecycle 不因 source route 改变。

两条 route MUST 共享现有 LocalStore replacement boundary：同一 canonical artifact 的 install MUST 幂等成功；同名但 artifact 不同的 local install MUST 返回 `pack.update-required`，而 local update MUST 执行显式替换。`--store-root` 对 local route 的 Store selection 与 Registry route 一致。local install MUST 继续满足 `semantic-index` 中的 install `indexSync` requirement；local update 保持当前 update 的 result/lifecycle，不因本 change 触发 indexSync。

#### Scenario: Local install preserves the explicit update boundary
- **WHEN** 已安装 `team-pack` 与 `lore pack install --path ./team-pack` 读取的 artifact 不同
- **THEN** CLI MUST 返回 `pack.update-required`，且不得静默覆盖现有 Pack

#### Scenario: Local route honors an isolated Store
- **WHEN** 用户执行 `lore --store-root ./scratch pack install --path ./team-pack`
- **THEN** CLI MUST 只修改 `./scratch` 选择的 LocalStore，不得修改 default Store、Registry catalog 或项目配置

#### Scenario: Local source acquisition does not enter the Registry pipeline
- **WHEN** 用户执行任一合法 `pack install --path` 或 `pack update --path` 命令
- **THEN** source acquisition MUST 不调用 Registry selector、descriptor loader、release resolver、Git materializer 或 Registry/network source client；合法 local install 的后置 indexSync 仍遵循既有 install contract
