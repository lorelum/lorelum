## Context

本变更按 `proposal.md` 和 `product.md` 执行。代码基线为 main `724389e`；#279 已把默认 single-vector 和 opt-in multi-view 的 method、Profile、encoding-input schema 隔离。不得把旧版单向量假设套回新版 reader、progress、scoring 或 migration。

### Observed

- `query/semantic/index/reader.ts` 正常 open 仍调用完整 integrity；`index/database.ts` 的 metadata read 遍历所有 encoding-input rows 并验证向量数值。`artifacts/semantic-progress.ts` 的 progress/status 也复用这些入口。
- Backend `ContentAddressedSemanticRuntime.storeTarget` 先读完整 corpus，收尾 `isCurrent` 又读完整 corpus；ProjectContext 的收尾会重新解析可被外部编辑的项目来源。
- `getEffectivePracticeWithPackRoots` 调用 `verifyEffectivePracticeSources`，对目标的每个来源 Pack 哈希整个 artifact、解析完整 projection；`row-materializer.ts` 同时为 effective 和每个 source 重复 canonicalize。
- 模型 prepare 校验 `.part` 后 rename，process 的 resolver 对新路径重新哈希；每次 encode 仍执行前后资源 stat，包含许可证。此前未提交的 digest memoization 只减少了重复哈希，没有消除这些职责重叠。
- Backend client 的 request 每次调用 identify，造成 identity + business 两次 HTTP；JSON success 在 renderer/envelope 递归验证两遍。

旧基线的实际计数仅用于问题定位，不充当新基线性能证明。完成后重新测 single-vector 和 multi-view 的真实路径。

## Goals / Non-Goals

**Goals:**

完整验证归输入、准备、发布和显式恢复所有；普通读取保留数据解码、方法兼容、快照一致性和实际读取失败。每条规则有唯一所有者，删除旧入口/重复状态，不建立长期双路径。

**Non-Goals:**

不改变方法选择、向量生成文本、归一化算法、评分/排序、索引 schema、现有 migration、operation 队列或安装驱动索引策略；不新增依赖、持久校验标记、后台巡检、网络 surface 或自动重试。

## Decisions

### 1. semantic index 的轻量读取和完整审计分开

`readSemanticIndexMetadata` 只读取/解析 metadata singleton、版本及标量；不得为了 status/readiness 扫描 vector 表。`openSemanticIndexReaderAt` 和普通 progress/status 不执行全库 integrity。

完整审计保留在 index adapter：检查 SQLite integrity、encoding-input identity、完整向量有限值/L2、metadata 对应 row/practice counts。build/rebuild/publish 在产物成为 ready 前调用；恢复不兼容 progress 的规则继续生效。所有关系查询沿用 Drizzle，不添加服务层原生 SQL。

正常 query 解码 BLOB 时仅做类型、字节长度/维度和必要行 identity 检查，再交给所选 method scorer；原始 native response 仍在接收边界验证有限值和归一化。可信内部 forwarding 不重复做同一轮 L2。原有 encodingId、methodId、representationId、inputDigest、Profile 匹配不可删除。

共享 embedding cache 是构建输入，不属于已发布 artifact 的正常 query/status 读取。构建仅对实际命中的条目保留 finite/L2 验证；损坏条目按 cache miss 重新编码并覆盖，使显式重建仍可自行恢复。这不要求查询状态遍历缓存或增加全库审计。

维护演练：新增 method 只改已有 method recipe/scorer；轻量 reader 和完整 audit 仍使用相同 method-neutral representation，不复制第二套 single-vector 分支。

### 2. Store target 用已有提交身份收尾

Backend runtime 的 Store dependency 明确要求 `readSnapshotIdentity(root)`，不提供以重读完整 corpus 兜底的兼容路径。target 捕获已有 snapshot 的 rootBinding/effectiveRevision；收尾读取轻量、已对账的提交身份，至少要求 rootBinding 和 effectiveRevision 相同。generation/manifest 变化但 effectiveRevision 不变时不要求重复编码；所有实际读取仍由 Engine 的 manifest/SQLite 一致性协议负责。

ProjectContext 保留 resolver 重新发现文件变化，因为这些文件可以由编辑器直接修改，不能拿 Store revision 替代项目检查。完整 corpus 的首次读取仍用于建立内容寻址 target，不引入跨请求语料缓存。

### 3. get 的 locator 读取不再审计 Pack 内容

`verifyEffectivePracticeSources` 改成来源 locator 解析：按当前已提交 manifest 验证 Pack 存在，调用已有 `verifiedCurrentPackRoot`，保留 snapshot fence、journal recovery 和 locator repair；不调用 calculateArtifactDigest/readSealedProjection。

`row-materializer.ts` 对持久化 canonical JSON 保留一次边界解析/shape 与 ID、来源、revision 的自洽检查；source 的 canonicalPractice 直接复用同一个已解析 canonical value，不再 hash/clone 一份。正常读取信任提交时保存的 contentDigest，不重新生成 digest 以查找绕过 API 的篡改。完整 cold-open audit 则对已哈希验证的 projection 与 SQLite canonicalContent/digest/来源进行完整对账；reindex 继续从已验证 artifact 重建，不能因读路径放宽而失去恢复能力。

### 4. 准备结果明确交给 runtime，不靠文件校验缓存

新增一个具体内部值，由 `modules/embedding/model.ts` 定义：

```ts
interface PreparedEmbeddingResources {
  readonly modelPath: string;
  readonly executable: string;
  readonly buildIdentity: string;
}
```

保留低层 `models/prepare.ts` 的模型缓存/下载责任和路径返回值；新增/改造 `runtime/embedding-resources.ts` 的 `prepareEmbeddingResources(config, signal, progress)` 作为完整准备组装：先验证匹配的 native manifest/executable，再调用 prepareModel，最后返回上述值。流式文件大小/digest 校验移到独立资源完整性模块，避免 model prepare 与资源组装循环依赖。

`EmbeddingServiceOptions.prepareModel` 返回该 prepared record，`createRuntime(prepared, preparationId)` 消费同一值；daemon、native integration、benchmark 和 CLI smoke 一起迁移。process 构造器消费 prepared record，不再根据 modelPath 自行 resolve/verify。具体参数组织可沿现有 config/options 保持职责清晰，但不得保留旧 resolver fallback。

准备阶段：缓存/显式文件完整 hash 一次；下载只完整 hash `.part` 一次，通过后原子 rename，返回正式 path。native 运行准备只校验 matching manifest 与 executable；构建/打包的 `verifyNativeArtifact` 仍验证完整文件集和许可证。

删除 `verifiedResources` Map、`resolveEmbeddingResources`、`assertUnchanged`、encode 前后 stat polling，以及只测这些实现细节的测试。新 daemon 的准备不复用持久“验证过”标记。

本地公开模型允许正常可读的 symlink/hardlink，不套用 credential 的 uid/mode/nlink 限制。私有 partial 的创建和写入继续防意外覆盖；credential/runtime state 的叶节点权限和类型保护保持。实际模型读取仍要求普通文件并验证固定大小/digest。

取消/失败：准备或下载失败不构造/启动 runtime；成功交付后，启动/ready/encode/stop 由现有 process lifetime 拥有。保留真实编码 probe、端点 alias/auth、timeout、崩溃恢复和 parent-liveness。

维护演练：下载在校验前取消时只保留 partial，没有 prepared record；准备完成后取消时，service 原有 signal 检查阻止 spawn。不新增独立资源生命周期或 shared daemon mutable slot。

### 5. client 身份属于 client 生命周期

client 首次业务请求执行既有 nonce/HMAC identify，成功后记住已验证 instance/build/protocol；同 client 后续只发携带 Bearer credential 的业务请求。显式 identify 仍重新验证，创建新 client 仍首次接入。严格请求不能因之前允许 build mismatch 的 stop 请求而跳过本地 build 比较。

不为缓存增加持久状态、锁、重连或自动重试。并发首次请求可以各自握手，避免第一位调用者的 signal/deadline 控制其他调用者。认证失败、实例退出/替换仍直接返回现有错误，由现有新 client 接入处理。loopback、Host/Origin、token、受限 body、response 边界和 kill 前 PID/启动时间检查不变。

runtime state 不再逐层拒绝可信父目录 symlink；创建时只建立必要目录，凭据目录/文件叶节点仍保持私有属性。公开模型不使用这套 credential helper。

### 6. 删除内部重复校验与整合已有优化

CLI renderer/envelope 对同一 success data 不递归验证两次；保留一个 JSON 输出边界，text 不重复执行 JSON 序列化前扫描。内部 forwarding/row source 构造复用已验证值，不增加 opaque validity marker、泛型校验框架或另一套 schema。

此前的编译期随机 build identity、native 下载摘要/patch snapshot/recipe identity 单次计算、SealedSnapshot 摘要传递保留。记录在此 change 中并以新 main 全流程重新验收。

## Migration

无磁盘 schema/数据迁移。删掉被替代的 runtime resolver、文件巡检和重复校验入口，迁移所有源码、测试、native integration 和 benchmark 调用者。现有断言“正常 get 必须发现任意 Pack 篡改”“每次 reader/status 必须完整检查所有向量”“每次 encode 必须因许可证变动失败”的测试不重新钉死旧行为；保留完整 audit/build/恢复边界对相应坏数据的有效覆盖。

当前 specs 按 delta 同步；Accepted ADR 不改写历史。维护文档明确本变更取代正常读取中的逐次完整审计假设；中英文站点只说明用户可见的读取保证与恢复方式，不暴露内部计数。

## Risks / Trade-offs

- 用户绕过 API 做逻辑上仍合法的持久数据篡改，正常请求可能不发现；完整审计/重建保留，不能假称保证不变。
- 已发布向量异常只在实际读取/计算或显式重建时暴露，不为每次 status 做 O(全部向量) 工作。
- 再次启动准备会重新校验模型；不预建跨进程缓存。
- 方法/表示/版本不匹配仍必须拒绝或重建，不能拿“可信本机”作为混用算法缓存的理由。
- 真实性能比较分开记录无 instrumentation 的延迟和 throwaway instrumentation 的校验计数；小语料结果不能外推容量。

## Verification

行为覆盖 malformed 外部输入、下载续传/坏摘要不提升、缺 native 下载前失败、正常链接模型可用、方法/Profile 隔离、partial/complete、并发 Store mutation 和 ProjectContext 编辑、错误停机/进程回收、current locator 修复、完整 audit/rebuild 拒绝坏数据。

真实路径在隔离 Store/cache/model/runtime 上执行 install、冷下载/load、single-vector 与 multi-view query、get 和 reload；使用本机固定模型及本地续传源。计数证明：正常 reader/status 无 integrity 全扫；冷下载完整模型 hash 一次；业务 encode 零资源 stat；同 client 多请求只有首次 identify；get 不读 Pack 其他资源；Store-only query 收尾不再物化全 corpus。计数脚本不进入长期测试，永久测试只覆盖消费者可见行为/边界。
