# 用户路径：完整原生 Skill，单一维护来源

用户照常安装 Lorelum Plugin 或 generic Skill，不需要选择正文来源、执行生成命令或管理本机共享目录。宿主拿到的是可独立读取的完整 Skill 和同目录 references；Pack 发现、semantic query 和 Practice 读取仍使用用户独立安装的 `lore`。

## 安装后第一次使用

用户通过各宿主既有 marketplace 安装 Lorelum，在正常本机环境信任并启用对应集成，然后开始一个需要工程指导的任务，例如：

> 设计一个避免付款重试导致重复扣款的接口。请使用 Lorelum 的相关工程指导。

宿主继续按现有 name/description 发现并按需加载 `lorelum`。已可见的 Catalog 直接复用；没有可用 Catalog 且该任务确实需要 Pack 发现时，Agent 运行一次 `lore pack list --details`。之后先执行 targeted semantic query，再通过 `lore get <practice-id>` 阅读准备采用的完整 Practice。不把 Catalog 当作完整指导，不在每次普通编辑前 list。

正常调用仍类似：

```sh
lore query "Payment may commit before the response times out. Existing clients retry without an idempotency key. How should the API prevent duplicate charges while preserving compatibility?"
lore get <practice-id>
```

`<practice-id>` 取自实际 query 结果，不是固定示例值。CLI 的既有 text/JSON 输出和错误状态不变；本方案不新增 locator JSON。

## 显式调用和不同安装方式

| 用户场景 | 保留的入口与行为 |
| --- | --- |
| Codex | `lorelum` 原生 Skill 的选择与显式调用入口；保留现有 metadata，不替换为普通 Hook 文本 |
| Cursor、WorkBuddy、ZCode | 原生 Skill 与现有 `/lore` command；command 不改成第二份检索指导正文 |
| Claude Code | `/lorelum:lorelum` 原生 Plugin Skill；不新增 legacy command |
| omp Main | 原生 Skill 与 extension 提供的 Catalog；不改变宿主现有调用方式 |
| omp task/eval child | 默认只接收源头 Main 的已读候选；不因 Catalog 缺席自动 list。独立任务确需发现时仍可 list；采用候选前必须 get 全文 |
| generic Skill | 继续安装完整 `skills/lorelum/`；移走仓库其余目录后，Skill 和相对 recovery reference 仍可读 |

自动匹配是需要真实 prompt 验证的 Agent 行为，不承诺任意措辞必触发。显式调用是匹配未发生时的原生入口，不依赖 Hook 先跑成功。

## 更新、版本和卸载

维护者改一处共享规则，运行 `bun run skills:generate` 生成全部安装产物，再运行 `bun run skills:check` 检查并一起提交原稿与产物；不直接编辑某一宿主的生成正文，也不设置保存监听或自动 Git hook。CI 只读检查，不替维护者生成。

用户按各宿主原生方式更新 Plugin，generic 用户按既有方式更新 Skill。共享来源唯一不代表所有已安装副本会实时更新：没有更新的安装继续使用它自己的完整版本，不暗中追随另一份 CLI 或 Plugin。生成命令只更新仓库的分发文件，不修改本机已安装的 Plugin cache。

CLI 与 Plugin 仍独立安装、更新。仅更新 CLI 不重写 Skill；仅更新 Plugin 不安装或升级 CLI。指导使用的命令必须在该 Plugin 声明支持的 CLI 范围内；对不支持的旧 CLI，沿用现有安装/升级文档，不通过“当前版本目录”猜另一个正文。升级到新增 CLI 能力的指导须另行对齐兼容范围，不由生成器默许。

卸载 Plugin 只移除该宿主管理的 artifact，CLI、Pack、model 与其他宿主 Plugin 不受影响。卸载 CLI 后 Skill 仍可读，但检索不可执行；不把“指导可加载”报告成“Lorelum 检索可用”。回退 Plugin 使用宿主已有机制，不额外维护共享目录或悬空 locator。

## 真正会遇到的失败

| 情况 | 用户可见结果 | 保留什么 / 下一步 |
| --- | --- | --- |
| Hook 被禁用、未信任、执行失败或 Cursor 首轮注入未出现 | Skill 仍可被原生发现并读取；任务按已有无 Catalog 路径继续 | CLI 可用时按需 list 一次。omp child 的默认无 Catalog 不按故障处理 |
| `lore` 不存在或宿主 PATH 不可见 | Hook 按已有方式不阻塞任务；需要 CLI 时出现命令缺失或宿主已有诊断 | Plugin 与指导仍在。安装/恢复已发布 CLI 的 PATH，再在新任务验证 |
| CLI 不支持该版本指导所需能力 | 显示既有 CLI 用法或兼容错误，不宣称检索成功 | 按宿主指南更新到支持版本；不自动安装、换 runtime 或改用 keyword |
| semantic query 返回 preparing 或错误 | 使用随 Skill 交付的 recovery reference，而非空结果 | 按当前 CLI 的状态/message 恢复，准备好后重试相同 query |
| Backend guarded stop 返回 deferred | 保留另一任务与实例，报告安全拒绝 | 不后台重试，不擅自 ordinary stop/kill；当前可独立工作继续 |
| Skill 或相对 reference 的安装文件损坏/缺失 | 说明该安装缺文件，不拼 cache 路径或借用另一宿主文件 | 从同一原生来源重新安装该版本 Plugin/Skill |

本方案不新增后台修复、自动同步、跨宿主共享安装、提示用户批准普通文件读取的流程，也不改变宿主原有 trust/permission。无论 Hook 是否成功，不允许直接读 LocalStore 来替代 CLI。

## 怎么确认用户实际可用

本次验证针对维护和正文迁移：共享修改到达全部七个目标、遗漏目标或产物时检查失败、原生 metadata 与路径保持、generic 脱离仓库仍可独立加载，以及可用宿主真实原生会话中的正文、相对 reference 和 CLI query/get。使用用户正常配置，不用在提示中直接塞正文代替加载；区分普通 Catalog 规则和 omp 适配，确认恢复指导符合现行 CLI 合同。

安装、更新、卸载、版本选择和 CLI/Hook 生命周期没有改变，不要求为生成工具重新执行所有宿主、所有平台的完整矩阵；改变这些边界时再做对应验收。具体平台、版本、调用结果与未验证项写在本 change 的验证记录，不把未执行项报告为通过，也不宣称完成全宿主兼容认证。Codex 失败读路径次数是独立观察项，不是本方案已经带来的改进。
