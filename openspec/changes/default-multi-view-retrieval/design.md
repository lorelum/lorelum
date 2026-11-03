## Context

Observed：`packages/engine/src/query/semantic/methods/catalog.ts` 的 `DEFAULT_VECTOR_RETRIEVAL_METHOD_ID` 为 single-vector。CLI `query/settings.ts`、Backend `protocol/retrieval-method.ts` 和 content-addressed runtime 的省略值路径都复用它；CLI `query/text.ts` 也据此决定默认 text 是否显示方法。两个实现及其 method/Profile/representation 身份已经独立，不需要新评分器或缓存格式。

调用链已经核对：query command 读取单次 config 文档并处理显式 mode 覆盖，再通过 runtime client 发送 semantic + retrievalMethod；Backend controller 处理省略方法后交给 `ContentAddressedSemanticRuntime`；runtime 创建方法对应的 execution，选择已有 artifact/progress 或提交 operation。install command 在 canonical commit 后通过 `syncSemanticIndexAfterInstall()` 按设置提交同一 Store 的 build；index status/build/rebuild 也读取同一设置。

真实 `agentic-coding@0.6.0` 的隔离安装对照观察到：35 条 Practice 在 single 方法形成 35 个输入，在 multi 方法形成 292 个较短输入；各自默认 batch=8 的 index 完成时 native footprint 约 1479/368 MiB。这是指定 Pack/主机的资源证据，不是排名质量或跨语料内存保证。

## Goals / Non-Goals

**Goals:** 所有省略方法入口统一选择现有 multi-view-vector，保留显式 single、配置优先级、索引隔离和既有 pending/error；真实证明新默认的 query、install 和旧方法切回都可完成。

**Non-Goals:** 修改投影/评分/估算 token 预算、自动改写配置、删除旧缓存、批量迁移 index、修改模型或 embedding recipe、增加别名/flag/协议字段、宣称解决检索质量 Issue。

## Decisions

### 一个默认值，复用所有入口

只将 Engine catalog 中现有常量值切换为 `multi-view-vector`。CLI settings/text、Backend request resolver/runtime 与 barrel 复用同一默认。常量类型、公开方法 ID、方法 resolver、依赖方向均不变，不增加第二个 CLI 默认或 Backend 特例。

最小接口保持原样：`resolveVectorRetrievalMethod(id: VectorRetrievalMethodId): VectorRetrievalMethod`；CLI `loadSemanticRetrievalSettings(options?, readConfig?)` 返回 `{retrievalMethod}`；Backend 对 omitted 方法调用现有 `resolveRequestedRetrievalMethod(value)`。例如没有配置的 `createQueryCommand` 按同一 config 快照加载 multi 默认，已有显式 single 则仍产生 single 请求。新默认 text 自然隐藏 multi 方法名，显示非默认 single；JSON/verbose 不删字段。

### 通过现有 Profile 边界迁移

默认值不是 Profile 身份的一部分，具体 method recipe 才是。multi 与 single recipe/version、embedding identity 和 artifact 格式均不变。已有 multi 用户复用其兼容产物；原来未配方法且只有 single artifact 的用户转到独立 multi target，首次 query/install/build 沿原 preparing/indexing 流程构建。旧 single artifact 不删除、不报告为 multi ready，也不自动混用。显式 single 配置或单次 mode 可以继续访问旧方法，切回无需重启 daemon。

不建迁移 marker、全库预扫描、后台批处理、fallback 或配置回写。一次方法失败沿现有错误返回和 Pack commit/indexSync 分离处理；keyword 与参数校验顺序不变。

### 调整行为覆盖，不重钉实现细节

普通配置缺失/空 section、显式选择、临时 mode 与非法配置的优先级由现有 CLI 边界测试覆盖；Backend 省略方法的实际 query/index target 行为需要更新。只验证 catalog 常量复制或固定列表的断言不作为新回归，删除无行为价值的 default wiring 断言，不为通过测试削弱向量/coverage/隔离验收。

原 native 场景隐含 single 的 document 数量不再成立。更新真实 scenario，从无配置 multi 开始，验证 task-card/body 和多 clause query；临时 single、自身 artifact 构建、返回默认、显式 single 配置、移除配置回到 multi、旧 operation 仍绑定原方法。install 场景在首次 query 前必须确认 multi index ready；不能用 query 的自动构建补洞。ProjectContext 在下一轮 native 编码前通过 index status 确认完整 Practice 的 progress 已提交，再暂停以验证 partial/strict；一次 native batch 可能只编码了该批 Practice 的部分视图，不能当作已提交的索引进度。增量场景继续检查仅变更投影编码，而非把某个固定向量数当作普遍合同。

主 Agent 是最终验证负责人：Engine/Backend/CLI 相关单测与类型/lint 一次集中运行，修改后只补失效检查；目标 worktree 现有匹配 native candidate 已验证，可复用，无需为纯默认切换重建未变的 native。运行完整 native smoke 的 ProjectContext、retrieval-methods、install 场景，并补无显式方法的真实 Pack install/query，证明不是只把常量改了就称完成。旧 idle 回收参数未变，不重复其两轮 60 秒验收。

### 文档与维护

更新中英文 configuration/query/indexing，说明首次准备、多方法 cache 共存、保持 single 的配置与临时覆盖，不把删除字段解释为回到 single。维护者 API 文档同步 HTTP 省略方法语义。当前 release-note 模板包含旧默认断言时只去除过时的保留默认/opt-in 句，不准备新 release、不改版本/推荐或 workflow；发布前的完整范围审查仍属于发布流程。

维护演练：以后修改默认只需 catalog 与行为文档/边界验收，投影实现和用户显式设置不动；默认首次索引失败仍由既有 operation/recovery 路径负责，不能加静默 single fallback 掩盖失败。

## Risks / Trade-offs

- 无显式配置用户的排名与结果可能变化，这是获授权的默认切换；不承诺所有查询质量提升。
- 首次多视图索引需要编码更多视图并占用额外缓存空间，可见 preparing/indexing 属于正常迁移，不是 Store 丢失。
- 只有新构建处理省略方法时使用新默认；CLI 显式传送 method 可与兼容 daemon 共用，不能因该切换自动重启共享服务。
- 旧 active change 的历史验证仍按当时方法解释；本次新增验证单独记录，不能把旧 single 计数冒充新默认的通过结果。
