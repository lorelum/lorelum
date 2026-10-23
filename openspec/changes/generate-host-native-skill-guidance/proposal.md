## Why

Lorelum 的 generic 与六个宿主 Skill 重复维护 query、get、资源读取和故障恢复规则；现有共享指导测试的手写清单还遗漏了 omp。Issue #246 的核心目标是共享规则只有一个人工维护来源，同时保住宿主原生发现、按需加载和显式调用，而不是消灭安装后的文件副本。

## What Changes

- 构建时组合完整 Skill 与相对 references，并将生成产物提交在原安装路径；用户不运行生成器。验证生成覆盖、独立目录可读性与真实原生会话加载，不以静态检查冒充实际加载，也不将未改变的宿主安装生命周期全矩阵设为本次前置门槛。
- 共享正文和 recovery 规则集中在构建工具的内容源中；普通宿主与 generic 共用 Catalog 判断和按任务条件启用的 lease，适配只保留原生 metadata 与 omp 的 Catalog/read-hint 真实差异。
- 增加 `bun run skills:generate` 和 `bun run skills:check` 别名，维护者修改原稿后显式生成并提交产物；用户安装流程不运行生成器。
- 增加确定性生成、只读漂移检查与独立的宿主集合完整性检查，覆盖 generic、Claude Code、Codex、Cursor、omp、WorkBuddy、ZCode；检查通过现有 `bun test` 进入 CI。
- 保留现有 Plugin selector、Skill 名称、manifest、Hook ABI、安装/更新/卸载所有权和 CLI-first 检索路径。不新增 CLI 命令、runtime locator、集中安装目录或 symlink。
- 将 omp recovery reference 中违背现行 Backend 合同的 `error.recovery`/后台重试说明纠正为现行 CLI message 指导，补齐 generic 正文遗漏的共同 lease 指导；不将历史漏同步或同义文案保留成“宿主差异”。

这是分发与维护方式的改变；除上述按既有合同纠正指导外，不引入新的用户检索行为。[产品路径](product.md)、[设计](design.md)和[验证证据](evidence.md)分别记录体验、机制与事实边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `plugin-distribution`：增加单一人工指导来源、独立可读的完整原生安装产物，以及覆盖全部宿主的分发一致性要求；不改变既有身份和 runtime 边界。

## Impact

- 预期实施影响：新增 `scripts/skill-guidance/`；生成现有 `skills/lorelum/`、`plugins/*/lorelum/skills/lorelum/`；调整共享 guidance 测试及维护文档。
- 无新增运行时依赖、CLI/Hook API、LocalStore 数据、Backend 状态或安装迁移。生成器使用 Bun 与标准库，不添加包依赖。
- 产品支持验证覆盖六个 Plugin 和 generic 安装入口；Codex 上游路径问题单独跟踪，不作为生成方案已经修复的效果。
- 不修改远端 Issue，不引入额外的用户宿主配置或安装状态。
