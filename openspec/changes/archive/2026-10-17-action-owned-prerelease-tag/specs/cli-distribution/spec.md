## MODIFIED Requirements

### Requirement: Release asset provenance
Draft/release 验证 MUST 针对准备发布的同一 asset 执行。维护者从 `main` 手动触发发布 workflow 并指定匹配 CLI 版本的新 tag 后，workflow MUST 从该次 dispatch 的 commit 构建和验证平台资产，验证成功后 MUST 为同一 commit 创建 annotated tag 和 prerelease draft；已有 tag 或 Release MUST 不被移动或覆盖。正式发布权限仍属于维护者，验证通过 MUST 不自动将 draft 公开。

#### Scenario: Manual draft preparation
- **WHEN** 维护者在 `main` 手动运行 Release workflow，开启 draft 并输入匹配 CLI 版本的新 tag
- **THEN** workflow MUST 在三平台产物与校验和验证通过后，为打包 commit 创建 annotated tag 与包含该产物的 prerelease draft，且 MUST 保持 draft 未公开

#### Scenario: Existing version provenance
- **WHEN** 输入 tag 或对应 Release 已存在
- **THEN** workflow MUST 不移动 tag、不覆盖 Release 或混入不同构建的资产

#### Scenario: Build-only candidate
- **WHEN** 维护者未开启 draft 选项而手动运行 Release workflow
- **THEN** workflow MUST 只生成候选构建产物，不得创建 tag 或 GitHub Release

#### Scenario: Draft verification succeeds
- **WHEN** 某个 draft asset 通过安装和运行验证
- **THEN** 验证记录 MUST 只证明该 asset 可用，且系统 MUST 不自动将其发布为正式 release
