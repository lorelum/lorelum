# 默认多视图切换验证

## 范围与环境

验证状态：在 idle 回收提交 `4cb196e68efb379cd2d7655622b0a3ea71f059b0` 上追加默认方法切换；唯一生产逻辑变化是 Engine method catalog 的默认 ID，method recipe、Profile/encoding identity、native candidate 与 idle 参数不变。测试和文档按实际多视图语义迁移。

主机为 Apple M4、32 GiB、macOS 15.7.1 (24G231)、Bun 1.4.2。复用前序已构建、身份核对通过的 darwin-arm64 native candidate 与固定 66,345,216-byte Q4_0 模型。本次没有重建未变的 native，也没有重复执行前序两轮 60 秒 idle 验收；其证据见 [idle verification](../reclaim-idle-model-memory/verification.md)。

所有 Store、ProjectContext、配置、derived cache、Backend journal、模型 cache 与服务端口均由集成环境隔离拥有。已安装模型和真实 Pack 仅作为只读来源，不操作共享 Backend、Store、Pack 或索引。使用真实 CLI command registry、认证 HTTP Backend、Engine 持久化和 native 模型；不是独立 CLI 子进程或发布包验收。既有 native smoke 使用延长的 60/70 秒服务/客户端预算，本次未修改它，不将该运行冒充产品默认 5 秒预算的单独验收。

## 命令与结果

`MODEL` 代表只读模型绝对路径，不在文档中记录本机路径。

```sh
bun test packages/engine packages/backend packages/cli
bunx tsc --noEmit -p packages/engine/tsconfig.json
bunx tsc --noEmit -p packages/backend/tsconfig.json
bunx tsc --noEmit -p packages/cli/tsconfig.json
bun run test:native-smoke -- "$MODEL"
openspec validate default-multi-view-retrieval --strict
openspec validate --specs
```

- 三个 package 的集中单测：**1357 pass、7 skip、0 fail**，168 个文件，5520 次 expectations。配置省略的参数化覆盖随后独立运行：**21 pass、0 fail**；未为测试组织变化重跑全套。
- Engine/Backend/CLI 类型检查通过。首次 Backend 类型检查发现 HTTP JSON 返回 `unknown`，已按既有 `IndexOperation` 响应类型修正测试，Backend 与 CLI 重检通过。
- 对 16 个变更 TypeScript 文件运行 `oxfmt --write`、focused oxlint。lint 无错误；Backend 两个 controller 测试中保留 9 条既有 sequential-await warnings。新增配置测试的两条 warning 通过独立 fixture 的参数化组织消除，没有增加 suppression 或修改生产路径。
- 变更严格校验通过；current specs **24 passed、0 failed**，query/index requirements 已同步。
- 对 13 个受影响文档检查 53 个相对链接目标，全部存在；后续补入的 empty-query 场景链接也指向实际读取过的入口。
- 远端 `a88e826` 的 [CI](https://github.com/lorelum/lorelum/actions/runs/41586974579) 为 2034 pass、20 skip、1 fail，失败于未修改的 Claude Hook fixture 写 stdin 时 `EPIPE`。`5bc16f3` 的 [CI](https://github.com/lorelum/lorelum/actions/runs/41587118146) 同为 2034 pass、20 skip、1 fail，但失败在 Store revision-delta 测试：2/2 progress 已写入，1 秒观察预算结束时尚未完成发布。
- revision-delta 测试改为零等待提交 query、显式等待后台 operation、再验证 complete，不延长产品 deadline；保留 changed contentDigest、每阶段新增向量数和所请求 predecessor revision 的覆盖，不钉死重复观察导致的内部读取次数。该文件补验 **20 pass、0 fail**（97 expectations），Backend 类型检查与 focused lint 通过。初次改为重复观察时，旧的精确读取次数断言失败；已用来源 revision 与实际结果/编码复用替代该实现细节断言。未为此修改 Hook、关闭检查或重跑失败任务碰运气。

## 四个真实 native 场景

`test:native-smoke` 的 `all` 选择成功完成 `project-context`、`retrieval-methods`、`install`、`empty-query`：

| 场景 | 观察 |
| --- | --- |
| ProjectContext | 48 条 Practice、96 个文档编码输入；冷提交、已提交 progress 的 partial、strict pending、complete、等价目录复用、增量、rebuild、cache prune、unload/reload 与坏 Practice fallback 通过 |
| 增量 | 仅改变一条 Practice 的 body；新增编码 1 个输入，未变 task-card 与其他 Practice 的 views 复用 |
| 方法切换 | 无配置 multi → 临时 single → 普通 multi → 显式 single → 移除配置回 multi；两种 Profile 隔离、零等待 ready 复用、原 operation 绑定及配置不写回通过 |
| Native 批次 | 默认 multi 文档 batch 包含 8 输入；多 clause query 实际 native batch 为 `[2]`，不靠 singleton 转发冒充 batch |
| Install | 9 条 Practice、18 个 multi 输入，native 文档批次 `[8, 8, 2]`；首次 query 前索引已 ready，query 使用同一 Profile、complete 且不重编码文档 |
| Empty | 空 Store 与 degraded 空项目返回 `corpus-empty` 及成功空语料解释，文档和 query embedding 数量为 0 |

第一次 native smoke 失败于旧暂停点：第一轮 native 编码只完成该批 Practice 的部分 views，尚未发布可查询的完整 Practice，query 正确仍为 preparing。集成环境改为在下一轮编码前由 index status 确认完整 Practice progress 已提交，再暂停验证 partial；不改生产实现、等待阈值或 coverage 要求。修正后完整四场景通过。

## 真实 Pack 的默认安装与 query

另外执行一次临时 smoke，复用现有隔离 native 环境和真实安装命令，将只读 `agentic-coding@0.6.0` 复制到临时 source，安装进新 Store。不设置方法配置，也不预先运行 query 建索引：

- Pack 共 35 条 Practice，安装返回 `indexSync: pending`，后台完成后、首次 query 前 `index status: ready`。
- 编码 **292 个多视图输入**；记录到 40 次文档 adapter 调用，包含模型未准备时的失败尝试，不将其当作 40 个成功 native batch。成功 native 输入大小包含完整 8-input batch。
- 查询 `Decide Scope and Stop Conditions Before Work Begins`，返回 `retrievalMethod: multi-view-vector`、`coverage: complete`，首个结果为 `agentic-coding.planning.decide-scope-and-stop-conditions`。
- query 与 install-ready Profile 相同，查询后 document count 不变，配置文件仍不存在。此次 ready query 观测为 17 ms；这不是吞吐、冷启动或跨机延迟保证。
- 临时脚本已删除，资源在 finally 中释放。复现方式：使用 `createNativeSmokeEnvironment(MODEL)` 建立隔离环境，`createSession()` 返回的真实 registry 执行 `pack install --path <复制源>`，等待环境后台队列后先读 index status，再执行零等待、require-complete 的普通 query；场景应验证上述方法、Profile、目标命中和 document count 不增长，而非用后续 query 的自动构建补上安装缺失。

## 未覆盖边界

未验证 Linux、Windows、Issue 报告主机、长期并发、全局 CLI 或最终发布包。没有进行检索质量评测或宣称普遍降低工作峰值；默认更改只复用既有算法，single 与 multi 的排名可以不同。前序真实 Pack 的内存对照不是本次吞吐 benchmark，也不证明所有语料的 multi 都优于 single。
