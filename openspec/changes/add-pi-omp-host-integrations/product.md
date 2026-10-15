# omp 的 Lorelum 插件使用方案

本文件定义该 change 的用户路径与行为边界。技术选择见 [design.md](./design.md)，考证与实施证据分别见 [research.md](./research.md) 和 [verification.md](./verification.md)。

## 用户要得到什么

用户已有 omp、已安装的 Lorelum CLI 与需要使用的 Knowledge Pack。安装插件后，宿主同时发现 Lorelum Skill 和 Catalog extension；不手工复制 Skill，也不由插件安装 Pack 或配置模型。

第一次提交任务时，extension 提供一个简短的 Installed Pack Catalog。它只告诉 Agent 有哪些 Pack，不把所有 Practice 加进 prompt。Agent 到达需要 guidance 的工程决策时做 targeted semantic query，使用某个候选前完整 get。

正常使用不要求每个任务显式调用 Skill。用户也可以直接说：“用 Lorelum 检查这个设计的故障恢复边界。”不新增一个与宿主 Skill 重复的 `/lore` command。


## 安装、更新与移除

使用仓库的 omp marketplace：

```sh
omp plugin marketplace add https://github.com/lorelum/lorelum.git
omp plugin install lorelum@lorelum-plugins
omp plugin list
```

marketplace 将 `lorelum` 解析到 `plugins/omp/lorelum/`，包含 Skill 和 extension。

项目范围安装使用 `--scope project`；个人范围是宿主默认。checkout 验收把 marketplace add 的来源换成仓库绝对路径，其他步骤一致。

更新与卸载：

```sh
omp plugin marketplace update lorelum-plugins
omp plugin upgrade lorelum@lorelum-plugins
omp plugin uninstall lorelum@lorelum-plugins
```

移除插件不会移除 CLI、Pack 或已存在的 Backend 数据。

## 任务过程中的可见行为

以“支付请求超时后客户端可能重试，要确定幂等边界”为例：

1. 用户描述实际约束，不必手工贴 Pack 目录。
2. Main 首次模型请求前，extension 从 CLI 取得有界 Catalog；每次普通请求临时复用同一快照，不重复查询。
3. Agent 执行相关自然语言 `lore query`，再用 `lore get <practice-id>` 读取要应用的完整内容。
4. Agent 用读取的 Practice 辅助设计，不能把 Catalog 当成完整规则，不能根据缺少 description 判定“没有相关 guidance”。
5. 启动、重新加载、切换、branch/tree 导航与 compact 完成只使快照失效；下一次模型请求读取一次，transcript 不累积永久 Catalog 消息。
6. 成功 `lore get` 自动关联当前 omp 会话；默认只为包含 `lore` 的 Bash 命令传递身份，显式 `agent.shellSessionInjection: all-shell` 可覆盖全部 Bash。
7. Main 启动 task/eval 子 Agent 后，子 Agent 默认只收到 Main 成功 get 的 Practice 摘要，不收到 Pack Catalog。所有嵌套子 Agent 都沿用源头 Main 的候选身份；子 Agent 自己 get 的记录仍属于自己，不自动并入 Main。候选不是正文或采用证明，使用前仍需完整 get。
8. 希望子 Agent 也看到 Pack 目录时，用户在 `~/.lorelum/config.yaml` 设置 `agent.subagentPackCatalog: true`；默认是 `false`。开启后只额外提供 Pack 目录元数据，不注入完整 Pack 或 Practice 正文，不改变 Main 的 Catalog 或已读候选。CLI 在下一次子 Catalog bridge 调用读取设置：新子 Agent 或下一次会话/compact 刷新生效，同一生命周期普通请求复用快照；无需重启 Backend，也可重新加载 omp 触发刷新。
9. 子 Agent 不会仅因没有 Catalog 自动执行 `pack list` 补齐目录。确实需要独立发现材料的工程决策仍可按需检索或浏览；这不是自动 Catalog 初始化。

用户在同会话外部改了 Pack 后，Catalog 快照不会实时自动更新；需要精确信息时 query/get/pack list 仍从 CLI 取得。重载或新会话刷新 Catalog，不增加 watcher。

## 实际失败与恢复

| 情况 | 用户/Agent 看到什么 | 既有工作与下一步 |
| --- | --- | --- |
| CLI 不在宿主 PATH，或版本没有对应 bridge | 一次 Catalog 未注入诊断；宿主任务继续 | 保留 Pack 和任务；安装/更新 CLI，确保宿主能解析 lore，重新加载 |
| Catalog 超时、Store 错误或返回无效 JSON | 本次没有 Catalog，而不是“无 Pack” | 主任务继续；确有独立发现需求时按 Skill 检索或查看 Pack，按 CLI 错误恢复；不因子 Agent 默认没有 Catalog 自动补目录 |
| 有效 Store 没有 Pack | Catalog 明确表示没有已安装 Pack | 主任务继续；用户按已有 Pack 安装指南添加所需内容，不由插件自动安装 |
| query 返回 preparing | Agent 识别为语义准备状态 | 按既有 recovery reference 等待/处理后重试同一 semantic query，不转成空结果或 keyword |
| Skill 或 extension 被宿主禁用 | 被禁用部分不生效，不自动修改配置 | 在宿主插件管理中重新启用；独立的任务材料发现不依赖自动 Catalog |
| 插件卸载 | 新会话不再自动加载该 artifact | CLI、Pack 与知识数据保持可用，不要求重新安装知识 |

只有需要排障时才读取该次调用的 trace 日志；不自动外发日志或创建 Issue。

## 明确不提供的能力

pi 支持不属于本阶段实施范围。读取关联不修改全局环境或宿主权限；子 Agent 提示只走正常本机 omp 的原生 task/eval 链，不用跨进程 RPC 或替换宿主任务入口。

公开用户指南在真实正常路径验收后更新英文与中文页面；平台支持与已验证宿主版本以单独验证记录为依据，不把其他平台推定为已验证。
