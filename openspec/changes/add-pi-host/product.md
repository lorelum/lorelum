# Product

## Status

本文定义已批准、正在实施但尚未交付的第一版产品路径，不代表当前发行版已支持 Pi。目标宿主为已核查的 Pi Coding Agent 1.2.0 API；实现验收应记录实际 Pi/CLI 版本，不声称支持未验证的旧版本。

## Normal User Journey

用户已经在正常本机环境安装 Pi，能运行普通 Agent 任务；Lorelum CLI 和 Pack 仍按现有安装指南独立管理。用户希望 Pi 自动知道有什么工程知识，而不是每次提醒 Agent 手动列目录。

第一版是原生 Pi Package 的本地路径安装。Git checkout 是资源来源，不是知识 Store；不要求 Bun、构建仓库或安装 monorepo 依赖。以下是交付后的安装流程，当前尚未存在所列 Package：

macOS/Linux：

```sh
git clone https://github.com/lorelum/lorelum.git "$HOME/lorelum-pi"
# 阅读来源和 Package 文件后再安装：Extension 与 Pi 具有相同本机权限。
pi install "$HOME/lorelum-pi/plugins/pi/lorelum"
pi list
pi
```

Windows PowerShell：

```powershell
git clone https://github.com/lorelum/lorelum.git "$HOME/lorelum-pi"
pi install "$HOME/lorelum-pi/plugins/pi/lorelum"
pi list
pi
```

若已有可信 checkout，可直接使用其绝对路径，不必再次克隆。上述路径是示例的新专用 checkout；已有同名目录时不要覆盖，改用现有可信 checkout 或另选空路径。Package 声明同时加载 Extension 与 Lorelum Skill，无需分别复制文件。个人安装是默认；团队项目声明可用 `pi install --local <absolute-package-path>`，遵守 Pi 的项目级信任，不能把机器专属绝对路径作为可移植团队配置提交。

用户在 Pi 中提出普通工程任务。Extension 先从 CLI 取得 Installed Pack Catalog，再在模型请求上下文提供至多 4000 字符的路由元数据，例如：

```text
Lorelum Installed Pack Catalog

This compact catalog is a relevance hint, not complete guidance.

- engineering-guidance
  Stack scope: typescript
  Description: Engineering decision guidance

For a matching task or decision, use the Lorelum Skill to retrieve detailed Practices. Do not infer that a Pack is irrelevant from missing description or stack scope.
```

这是提供给 Agent 的元数据，不额外伪造用户消息，也不逐轮刷屏。Skill 名称、描述和位置随 Package 被 Pi 发现；Skill 正文仍按需加载。遇到重要任务或决策时，Agent 使用 Skill 做一次有针对性的自然语言语义检索，再读取选中 Practice 的全文：

```sh
lore query "Define service API boundaries for this TypeScript change"
lore get architecture.api-boundary
```

以上 ID 和 Pack 名是示意，不代表发行包保证存在。用户需要显式发起时使用：

```text
/skill:lorelum 为当前变更检索相关工程规范
```

自动注入从不执行 query/get，也不自动安装 Pack、下载模型、启动 Backend 或改写 Agent 的 shell 命令。用户不必选择新的检索模式或配置新的数据库；语义准备及失败恢复继续由现有 Skill/CLI 合同处理。

## Continuity and Defaults

- 新建、恢复、fork、切换会话及 `/reload` 时重新取得当前 Catalog，避免沿用上一个 runtime 的快照。
- 手动或自动压缩成功后重新取得 Catalog；即使 Pi 在同一任务中内部重试、用户没有再发消息，模型请求仍有目录。
- 普通工具迭代复用快照，不每次执行 CLI，不不断追加目录消息；同一次模型请求只含一个本集成 Catalog。
- 外部安装或移除 Pack 后，用户用 `/reload` 刷新；没有文件监控或定时任务。压缩和新的会话边界也会刷新。
- 目录过大时使用共享 CLI 的截断提示。截断不证明其余 Pack 不存在；Skill 可按提示执行 `lore pack list --details`。
- 没有自动 Catalog 时，Skill 保留一次 list 的通用发现路径，不把缺失目录解释为没有相关工程知识。
- 不额外提供 `/lore`、会话关联设置或子 Agent 配置。子 Agent 是否发现自身 Catalog 取决于其实际加载的资源，不承诺传递主 Agent 已读 Practice。

## Supported Situations and Recovery

| 用户情况 | 可见结果与可用性 | 一个实际恢复动作 |
| --- | --- | --- |
| 已安装 CLI 和 Pack | 正常任务无需额外设置；目录进模型上下文，Practice 仅按需读取 | 无需恢复 |
| CLI 成功读取但没有 Pack | 上下文明确显示 `No installed Knowledge Packs are currently available.`；Pi 仍正常工作 | 按现有 Pack 安装指南安装所需包后 `/reload` |
| CLI 缺失或版本太旧 | 交互模式简短提示 `Lorelum Catalog unavailable: install or update the lore CLI, then /reload.`；用户任务继续，不自动安装 | 安装或更新 CLI 后 `/reload` |
| Store 无法读取 | 显示目录不可用而不是空结果；CLI/Pack 不被删改，用户任务继续 | 执行 `lore pack list --details` 查看具体 CLI 故障并按其恢复指引处理，再 `/reload` |
| Catalog 调用超时、非零退出或无效响应 | 不注入旧快照或伪造成功；任务继续，非交互 stdout 保持 Pi 协议 | 用 `lore pack list --details` 检查 CLI 后 `/reload` |
| 项目尚未授予信任 | 保持 Pi 原生审批，集成不提前运行、不自动批准 | 审阅项目资源声明后按 Pi 正常流程决定是否信任 |
| Pi 禁用此 Package 或 Extension | 不承诺自动注入；若 Skill 仍启用则保留通用发现流程 | 在 Pi 原生资源配置中按需要启用可信资源 |

恢复提示应简短、去重，仅在对应生命周期尝试失败时出现，不在每次模型请求刷屏。错误文字不把普通本机路径或 error stack 默认标为必须外发或必须脱敏；反馈继续由用户控制。

## Ownership, Updates and Removal

Extension 与 Skill 由 Pi Package 管理；CLI、Backend 和已安装 Pack 不归这个 Package 管理。Extension 运行于 Pi 进程，安装即代表允许可信代码具有该进程的本机权限；不引入额外遥测、会话数据库或上传知识。

本地来源不复制文件。请保留 checkout；更新先 `git -C "$HOME/lorelum-pi" pull --ff-only`，再在 Pi 执行 `/reload`。若 checkout 有本地更改或历史分叉，保留它们并先处理 Git 提示，不建议 reset/clean。`pi update --extensions` 不能替用户更新本地源码。第一版不宣传不存在的 npm 来源、Git 子目录 URI 或跨宿主 selector。

移除个人安装：

```sh
pi remove "$HOME/lorelum-pi/plugins/pi/lorelum"
```

项目安装使用同一绝对来源和 `--local`。随后重启或 `/reload`，确认资源移除。CLI 和 Pack 继续可用；不要为移除 Extension 删除 Lorelum Store。用户以后仍可按普通 CLI 工作流检索。

## Acceptance Walkthrough

实现阶段须用完整候选 CLI、独立 fixture Store 和 Pi 正常安装资源完成上述安装、首次发现、显式 Skill 检索、手动压缩、会话切换、reload、空 Store、CLI 缺失和移除路径。内部自动压缩/overflow 重试使用实际 Pi runtime 与受控 provider 捕获请求验证，不能仅手动调用事件 handler 冒充验收。记录版本、安装来源、请求中目录数量、是否执行 query/get，以及失败后普通任务是否继续。不能仅凭单元测试或源码分析宣布完整支持；不要求受限沙箱复现。
