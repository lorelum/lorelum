## ADDED Requirements

### Requirement: Single authored source for shared Skill guidance

Lorelum 的 generic 与全部支持宿主 Skill SHALL 从同一人工维护来源取得共享检索与恢复指导；每个分发 artifact SHALL 携带该版本的完整正文和相对 references。宿主适配 MUST 只拥有原生 metadata、Catalog 发现政策与实际宿主附加行为，不得分叉 query、get、trace 排障或 CLI 错误恢复规则。生成产物 MUST 与其来源一致，分发检查 MUST 覆盖全部支持目标而不得静默遗漏新增宿主。

现有文本差异 MUST 先依据现行合同与实现区分真实宿主行为、历史漂移和纯文案差别；只有真实宿主行为 SHALL 进入适配。lease 等共同 CLI 能力 MUST 按任务条件指导，而不得仅因某份正文遗漏就划成宿主专属功能。

#### Scenario: Shared guidance changes once

- **WHEN** 维护者修改一条共享检索或恢复规则并准备分发 generic 和全部支持宿主的 artifact
- **THEN** 每个 artifact MUST 包含同一新规则以及其对应宿主适配，且检查 MUST 拒绝任一旧版、缺失或被手工改写的受管产物

#### Scenario: A supported host is omitted

- **WHEN** 仓库存在原生 Lorelum Plugin artifact，但它不在共享指导的生成覆盖中
- **THEN** 分发一致性检查 MUST 失败并指出缺少覆盖的宿主，而不得因为生成器自己的目标清单未列出它就通过

#### Scenario: Host difference is meaningful

- **WHEN** 为 omp child 或 Cursor 首轮无可见注入的任务生成指导
- **THEN** artifact MUST 分别保留现行 agent-integration 合同中的 child 不自动建立 Catalog 和按需建立缺失 Catalog 行为，共享来源 MUST 不把二者合并为同一默认动作

### Requirement: Generated guidance preserves native installation and recovery

Skill 共享来源的变更 SHALL 保留每个宿主既有的原生发现 metadata、按需加载、显式调用、Plugin 身份与安装所有权。已安装 Skill 的完整指导与相对 references MUST 不依赖 Hook 成功、CLI 提供正文 locator、构建工具或仓库其余文件才能读取。Pack 发现、query 和 get MUST 继续经过已发布的 `lore` CLI；完整指导可读取 MUST NOT 被等同于 CLI 检索可用。

#### Scenario: Clean install and explicit invocation

- **WHEN** 用户按受支持宿主的既有原生机制安装 Lorelum 并开始新任务
- **THEN** 宿主 MUST 能发现并按需加载安装 artifact 内的完整 Skill，既有显式入口 MUST 保留；用户 MUST 不需要执行生成命令或配置新的本机共享正文目录

#### Scenario: Hook context is absent

- **WHEN** Hook 被禁用、未信任、未运行、失败或尚未让 Catalog 可见
- **THEN** 原生 Skill 及 reference MUST 仍可读取，Agent MUST 按现行 Catalog 缺失合同处理，不得因没有 locator 形成死入口，也不得绕过宿主 trust

#### Scenario: CLI is absent

- **WHEN** 用户已安装 Plugin/Skill，但宿主无法执行 `lore`
- **THEN** 完整指导 MUST 仍可加载，宿主任务 MUST 保持既有非阻塞行为，Agent MUST 说明 CLI 不可用及安装/恢复 CLI 的下一步，而不得自动安装 CLI、访问 Store 或声称检索成功

#### Scenario: Installation is independent of its source checkout

- **WHEN** 用户仅安装某个生成的 `skills/lorelum/` 目录，且原仓库不在本机
- **THEN** 正文及其中相对 reference MUST 完整可读，MUST 不读取其他宿主或构建目录的文件

#### Scenario: CLI and Plugin update independently

- **WHEN** 用户只更新 CLI、只更新一个宿主 Plugin，或卸载其中任一组件
- **THEN** Skill 正文 SHALL 由它自己的原生安装版本决定，其他宿主与 Pack 数据 MUST 保留，MUST 不留下 Lorelum runtime locator 或自动跨版本借用正文；调用所需 CLI 能力不可用时 MUST 显示兼容恢复方向而非隐式替换 runtime
