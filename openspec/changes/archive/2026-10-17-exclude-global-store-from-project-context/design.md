## Context

见 proposal.md。`packages/engine/src/project-context/resolver.ts` 目前从 start directory 向根目录扫描，每遇到 `.lorelum` 就作为 layer；该扫描不使用已传入的 `StorageRoot`。默认 Store root 是用户级 `.lorelum`，其中同时包含 shared config、canonical Store 与嵌套 Pack artifact。把它加载为项目层会触发 project config 和 direct Pack root 的降级诊断。现有 ProjectContext resolver tests 已覆盖父子继承、坏 config/Pack/Practice 与 `--no-project`，但没有 Store root 边界。

## Goals / Non-Goals

**Goals:**

- 以 selected Store root 作为自动 discovery 的明确边界，阻止 Store-owned data 进入 ProjectContext。
- 维持 Store root 以下真实项目 layer 的发现、继承、precedence 和 Store fallback。
- 对显式错误目标 fail closed，并让 query/get/index/context status 获得同一 resolver 结果。

**Non-Goals:**

- 不更改 global config schema、Store Pack artifact 布局、用户目录或有效项目 `.lorelum` 文件。
- 不硬编码 home 路径，不用 config 内容、Pack 名称或 Git metadata 推断目录角色。
- 不改变 `--no-project`、`base: user|none`、project cache identity、模型或 Backend 生命周期。

## Decisions

### 1. Store root 是 resolver 的保留路径边界

resolver 接收 selected `StorageRoot.rootPath` 的规范化 identity，并在向上 discovery 时先比较候选 layer marker 与该 identity。命中时不加载该层，并停止继续扫描父目录；此前已找到的子项目 layers 保留。这样 home 下的项目仍可继承自身及项目父目录的 layers，却不会把 user Store 或更上层非项目标记带入语料。

该边界是对既有“未发现任何 marker 即返回 Store-only”的补充，而非替代：普通目录到文件系统根目录都没有 `.lorelum` 时，resolver 仍返回无 ProjectContext，query/get/index 保持 selected Store 行为。

不选择通过 project config 是否包含 `backend`/`embedding` 或 Pack 目录是否为嵌套布局来识别 Store：内容探测既脆弱又会把用户修复 warning 的行为变成隐式、可变的角色切换。

### 2. 显式 Store root 采用 usage failure 而不是静默 Store-only

当 `--project-root` 的 marker 等于 selected Store root，resolver 返回既有 invalid-project-root path。调用方已经表达了明确 project intent，静默忽略会隐藏配置错误；同时 fail-closed 保证不会创建 Backend target、cache 或从其他祖先猜测替代项目。

不选择把 Store root 当普通 empty project：它仍会耦合 query 的 context digest、derived cache 与用户 Store 内部布局。

### 3. 以规范化路径比较覆盖默认和 custom Store

边界由 selected Store root 参数计算，使用现有安全目录解析的一致 canonical absolute/real path 比较，而不是 `$HOME/.lorelum` 常量。缺失或无效 Store root 不会被凭空当作 marker；既有 Store 验证和 project symlink safety 继续负责各自边界。

### 4. 在共享 resolver 层一次修复，并按各个 CLI route 验证

实现只在 Engine ProjectContext resolver 引入 boundary，避免 CLI、Backend target 和 keyword 路径各自维护发现规则。测试覆盖 resolver 的 custom Store root、child valid project、explicit Store root，以及 CLI `context status` / query/get/index 的可观察结果。用户文档仅说明 ProjectContext 从项目 layers 发现，不将用户全局 Store 视为可配置项目层。

## Risks / Trade-offs

- [custom Store root 恰好位于项目祖先] → Store root 是明确 selected canonical data authority；自动 discovery 在此停止，用户可选择不同 `--store-root` 或将项目层置于边界以下。
- [路径 symlink/realpath 不一致] → 复用既有安全路径解析；新增 test 覆盖等价解析而不放宽 symlink 规则。
- [已有用户依赖 Store root 被当 project] → 该行为读取的是不兼容内部布局并持续 degraded，不是受支持项目 contract；通过 Store-only 恢复而非迁移数据。
- [只测 query 而 get/index 再次偏离] → 共享 resolver tests 加上三个 CLI route 的 focused regression coverage，并包含完全没有 `.lorelum` marker 的普通目录。

## Migration Plan

1. 代码升级不迁移、删除或重写任何 `.lorelum` 数据；首次 query 直接停止把 selected Store 当 project layer。
2. 现有从 home 子目录运行的 query 自动转为 Store-only，除非其下存在有效项目 layer；可能的旧 project-derived cache 维持为可 prune 的用户级派生状态。
3. 发布前运行 Engine/CLI focused tests、OpenSpec strict validation、typecheck、lint 与 format check；回滚只恢复旧 discovery 行为，不需要数据恢复。
