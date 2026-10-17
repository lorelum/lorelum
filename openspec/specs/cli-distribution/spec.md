# cli-distribution Specification

## Purpose
定义 Lorelum CLI 的平台发布包和安装器合同，使用户无需预装 Bun、Node 或 sudo 即可得到与 native runtime 字节一致、可恢复的单一命令入口。

## Requirements

### Requirement: Self-contained verified platform package
每个支持目标的发布包 SHALL 包含唯一用户入口 `lore` CLI、匹配 target 且以 `lore-model` 命名的 native model runtime、manifest 和必要 notices/licenses。安装器 MUST 在安装前验证下载文件、archive layout、目标 manifest 与解压路径安全性；CLI 与 native runtime MUST 来自同一已验证 asset，不得由安装器重新构建、从 PATH 解析或与其他 release 混搭。`lore` MUST 保持唯一被安装器激活的用户命令入口。

#### Scenario: Valid platform archive
- **WHEN** 用户安装与当前平台匹配的发布 archive
- **THEN** 安装器 MUST 只接受同时包含匹配 `lore`、target native manifest 和 `lore-model` executable 的完整 archive，并在验证失败时拒绝安装而不留下可用入口

### Requirement: Atomic and non-invasive installation
安装器 SHALL 将版本内容安装到用户可写目录，并仅在完整验证后原子切换 `lore` 命令入口。安装器 MUST 不要求 Bun、Node 或 sudo，MUST 不修改 shell startup 文件，也 MUST 不覆盖或删除外部管理的同名入口；失败、取消或损坏 archive MUST 不产生半安装状态。

#### Scenario: Existing external command
- **WHEN** 安装目标位置已有不是 Lorelum 安装器管理的命令
- **THEN** 安装器 MUST 停止并说明冲突，而不得覆盖该命令

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

### Requirement: Compiled CLI preserves source-mapped diagnostic locations
`build:cli`、release staging 和 release archive 所使用的编译路径 SHALL 显式关闭 minify，并在单文件 `lore` executable 中嵌入可由运行时使用的 source map。来自 Lorelum TypeScript 源码的未处理异常和已记录 Error stack MUST 能还原到原始 `packages/**/**.ts:<line>:<column>` 位置，而不得只暴露编译 bundle、`$bunfs` 或压缩后位置。

编译产物验证 MUST 实际执行与待交付构建路径等价的 binary，并以一个可控异常断言 source location 还原；源级单元测试或未编译的 CLI 运行不得替代该验证。将来任何启用 minify 的提议 MUST 保持这一验证通过，否则不得进入发行路径。

#### Scenario: A compiled release executable reports an original TypeScript location
- **WHEN** 编译验证执行一个会抛出已知异常的 Lorelum TypeScript fixture
- **THEN** 该 executable 的异常输出或已记录 stack MUST 指向 fixture 的原始 `.ts` 文件及其行列号，并不得把 release bundle 或 `$bunfs` 作为唯一可定位位置

### Requirement: Development CLI build outputs match their stated capabilities
`build:cli` SHALL 生成未归档的当前 target 完整 CLI 目录，其中 SHALL 包含可执行文件和与其匹配且经过验证的 native runtime/manifest，可用于模型加载和语义操作。`build:cli-only` SHALL 仅生成不携带 native runtime 的 `dist/lore` 编译文件，用于明确不需要 embedding 的检查。`build:release-staging` SHALL 保持完整构建的兼容入口；这些本地构建 MUST 不发布包或上传资产。

#### Scenario: Compiled CLI validates semantic behavior
- **WHEN** 开发者为当前 target 运行 `build:cli`
- **THEN** CLI 和匹配的 native runtime SHALL 位于同一可运行目录，而不能要求另行复制开发 candidate 或从 PATH 找 executable

#### Scenario: Explicit binary-only check
- **WHEN** 开发者只需编译文件用于 keyword 或启动成本检查而运行 `build:cli-only`
- **THEN** 命令 SHALL 产出 `dist/lore`，且 MUST 不将它声称为可执行 embedding 的完整安装包
