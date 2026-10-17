## Purpose

让 Pack 作者和离线开发者能够从一个显式本地 Pack root 安装或更新真实 LocalStore，同时保持格式校验、原子 mutation、来源隐私与 Registry 安装相同的安全边界。

## ADDED Requirements

### Requirement: Explicit local Pack directory install and update

CLI SHALL 支持 `lore pack install --path <directory>` 与 `lore pack update --path <directory>`。`directory` 可以是相对调用时 cwd 或绝对路径的一个 Pack root；CLI MUST 只从该目录验证并读取 `pack.yaml`、可选 `decisions.yaml`、Practices 与 Pack resources，以其中经过验证的 Pack name/version 作为唯一 identity。local directory source acquisition MUST NOT 要求或调用 Git repository、Registry descriptor、release ref、Registry/network source client；成功 install 后的既有 `indexSync` lifecycle 不因该 source route 改变。

`--path` MUST 是 non-empty string，且 MUST 与 Pack specifier 及 `--registry` 互斥。参数形态非法时 CLI MUST 在读取目录、联系 Registry 或修改 LocalStore 前返回 invalid invocation error；空 `--path` MUST NOT 被解析为 cwd。成功 result MUST 标识 `source.type: "directory"`；它 MUST NOT 包含 `registry`、Git ref、Git commit、调用方 source directory path 或其 canonical path。既有 Store `packRoot` result 字段保持当前语义。directory 是一次性输入，CLI MUST NOT 将它保存为 Registry、default 或项目配置。

#### Scenario: Install a valid local Pack directory
- **WHEN** 用户执行 `lore pack install --path ./fixtures/team-pack`，且该目录是有效 Pack root
- **THEN** CLI MUST 将 decoded Pack 安装到所选 LocalStore，成功 result MUST 报告 validated Pack name/version、`source.type: "directory"` 与现有 `indexSync` result，且不得包含 source directory 的绝对路径

#### Scenario: Update from a changed local Pack directory
- **WHEN** 同名 Pack 已安装不同 artifact，用户执行 `lore pack update --path ./fixtures/team-pack`
- **THEN** CLI MUST 用该目录 decoded 的 candidate 替换已安装 Pack，并保持现有 generation、delta、cleanup 与 update result 合同；该 update MUST NOT 因本 change 新增 indexSync

#### Scenario: Local source options cannot be mixed
- **WHEN** 用户同时传入 `--path` 与 Pack specifier 或 `--registry`
- **THEN** CLI MUST 返回 invalid invocation error，且不得读取目录、联系 Registry 或修改 LocalStore

### Requirement: Local directory validation and failure recovery

local directory route MUST 在进入 decoder 前安全解析 source root；不存在、不可 canonicalize、不是目录或无法成功打开该 root 目录的 source MUST 返回 `source.unavailable`。在一个可读 root 中，CLI MUST 复用 `decodePackDirectory()` 的 Pack format、directory entry、symlink、Practice/resource、文件数量和字节预算；decoder 拒绝的内容 MUST 返回 `pack.invalid`。任何失败 MUST 保留 LocalStore 的现有 canonical Pack、generation 与 Registry catalog，且不得留下部分 artifact。

CLI 的 public error messages MUST NOT 回显传入或 canonicalized directory path，也不得转发 decoder 的内部 filesystem detail。用户可从 `source.unavailable` 得到“确认目录后重试”的单一步恢复；`pack.invalid` 则表示 directory 可读但不满足 Pack contract。

#### Scenario: Invalid local Pack does not alter an installed Pack
- **WHEN** 用户以 `lore pack update --path <directory>` 指向缺少 `pack.yaml`、含不安全目录项或不满足 Pack validation 的目录
- **THEN** CLI MUST 返回 `pack.invalid`，且已有同名 Pack 的 artifactDigest 与 generation MUST 保持不变

#### Scenario: Missing local directory gives one recoverable action
- **WHEN** 用户传入不存在、不可读取或非目录的 `--path` value
- **THEN** CLI MUST 返回 `source.unavailable`，并提示用户确认目录后重试；不得回退到 Registry

### Requirement: Local directory result provenance is deliberately transient

`source.type: "directory"` 只表示本次 Pack candidate 来自显式本地目录；它 MUST NOT 被 LocalStore manifest、Pack projection、query result、Installed Pack Catalog 或后续 install/update 隐式重用。LocalStore SHALL 继续只持久化 canonical Pack artifact、identity、digest、generation 和既有 mutation data；既有 Store `packRoot` 不构成 source directory provenance。

#### Scenario: An isolated Store does not retain local path provenance
- **WHEN** 用户执行 `lore --store-root ./scratch pack install --path ./team-pack` 后读取该 Store 的 Pack catalog
- **THEN** CLI MUST 只修改 `./scratch` 选择的 LocalStore；catalog 可报告 Pack identity 与 canonical artifact，但不得公开 source directory，也不得更改 Registry catalog 或 project 配置
