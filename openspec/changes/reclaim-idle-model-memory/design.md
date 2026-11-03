## Context

Observed：Issue #305 的固定大小请求平台化，符合 ggml workspace 按需增长且 allocator 生命周期内不缩减的源码行为。`llamaArguments()` 固定 CPU、2048 batch/microbatch、两个 slots。`createEmbeddingService()` 在成功编码后清除 in-flight 状态但保留 runtime；`unload()` 等待在途结束并停止进程。固定 llama.cpp b10901 已提供 idle sleep：无任务时清理整个模型/context，普通 embeddings 请求等待重新加载；health 可在睡眠中返回 200。

独立 alpha.7 native 实验观察到，额外启用 2 秒 sleep 后，2002-token 请求后的 footprint 从约 1482 MiB 降至 25 MiB，首个短请求约 421 ms，认证混合 batch 与并发唤醒成功。同形 batch 在睡前/睡后逐元素一致。这不是当前默认产品行为或跨平台保证。

## Goals / Non-Goals

**Goals:** 默认及时释放闲置高水位内存；保留长输入、原有批处理、进程归属和失败回收；以真正 native/Backend 路径证明回收和继续编码。

**Non-Goals:** 降低计算峰值、确认无限泄漏、修改量化图、支持新的设备、增加可配置策略、扩充协议状态或自动重试。

## Decisions

### 1. 由 native 的任务队列拥有休眠

唯一生产改动是在 `packages/backend/src/runtime/llama-options.ts` 的统一参数列表加 `--sleep-idle-seconds 60`。固定 60 秒避免短请求间隔反复 reload，又不会让一次长请求的工作区常驻到 Backend 退出；这是保守起步值，不是统计优化值。无需修改 native patch、信任 manifest 或创建 Backend timer。保留 microbatch=2048、np=2；ub256 实测拒绝 2002-token 输入，因此不选降低 ubatch。

现状请求链：CLI/Engine 调用 Backend embedding HTTP，controller 校验输入后进入 `createEmbeddingService().embed()`；service 创建请求 deadline，`createEmbeddingProcess().encodeBatch()` 调用 `createLlamaClient()` 的认证 `/v1/embeddings`；native 调度并返回按 index 关联的向量；service 清除在途状态。目标复用整条链，只由启动参数启用 native 内部的空闲释放与自动唤醒。新请求由 native sleep queue 同步重载，Backend 不重复探测/校验，不添加请求前 health 或磁盘 hash。

`llamaArguments(modelPath, port, alias, options): string[]` 签名不变；`EmbeddingRuntime`、`ModelStatus`、controller/client 均不新增接口。runtime 资源仍由 `createEmbeddingProcess` 单一持有，睡眠不退出 native 进程；显式 `unload`/Backend shutdown 仍由现有 `stop(deadline)` 回收。

### 2. ready 表示可接受请求，而非驻留承诺

休眠是 ready runtime 内部资源状态，不新增 sleeping DTO、轮询或状态缓存。`model status` 只读；ready 时重复 `model load` 仍幂等返回，不强制唤醒或 pin 住内存。显式 unload 停止进程，不等同于内部休眠。Backend task lease 保持原职责，不阻止 native 无任务时释放内存。

### 3. 保留既有 deadline 与错误

唤醒计入 `requestTimeoutMs`，不额外加宽限或重试。若 native 重载/编码失败，现有 client 错误映射和 service `recover()` 停止该 runtime；取消、unload 及进程退出沿现有路径。模型文件在正常产品路径中由准备阶段验证，唤醒不增加目录扫描或 hash；用户绕过产品修改正在使用的模型文件不属于新检测承诺。

### 4. 回归必须经过真实 native 与 Backend

新增聚焦的真实集成验收，使用生产参数和实际 60 秒阈值，不增加仅为测试缩短时间的生产参数。沿既有隔离 daemon/native fixture 约定，覆盖短、长、重复长、短、idle、唤醒、同形 batch、显式 unload/reload；检查 384 维有限归一、输入顺序、相同输入同形 batch 的向量容差、native 进程身份以及休眠后状态仍 ready。macOS 同时记录 footprint 与 RSS，并要求长输入后 idle 显著释放（至少 50%），不固定某台机器的 MiB 值或延迟阈值。无可达 native 的普通单测不能证明回收，不增加只断言参数复制/默认值的单测。

实际验收发现：相同 HTTP array 不保证相同 native slot 布局。休眠会重置 slot 历史，长短输入的 slot 顺序可互换；在禁用休眠的同一 native 进程内，通过两条长输入及短输入重新分配 slots，也能复现完全相同的量化差异（长向量 cosine 约 0.99891、max delta 约 0.006313；与休眠后对应布局逐元素一致）。因此验收先在不休眠的运行期采集两种 slot 布局的同输入参考，再以最接近的整组参考执行原有严格 cosine > 0.999 和行关联检查，不放宽该阈值或已有冻结参考。另运行现有 HTTP batch 的独立语义检索与置换验收；不把仅有相同外部数组误称为底层同形计算。

主 Agent 负责最终目标构建的真实运行和效果测量；实现 Agent 不重复运行验收。真实客户端调用应保留产品默认 5 秒编码预算，单机唤醒耗时仅为观测；既有跨平台/慢机验收预算不能被当作产品延迟保证。基线与修改后以相同模型/输入和同机测量比较，报告二者构建边界；不把 native smoke 当作全平台性能保证。

### 5. 迁移、维护与文档

不保留旧参数双路径或别名，无用户数据/索引迁移，`encodingId` 不变。当前 spec 添加空闲资源规则，API/CLI 维护说明链接产品站点的用户体验。站点中英文 model 页面解释 ready、首次唤醒延迟与显式 unload。集成维护文档只说明如何验证及测量，避免重复用户流程。

维护演练：调整空闲阈值只修改统一 runtime recipe 与相应行为文档，所有 production/native test 调用者复用它；编码取消或唤醒失败不新增资源所有者，仍落到 service recover 和 process stop。只有实际慢机证明既有 deadline 无法承载唤醒，或真实使用证明 60 秒造成明显重载抖动时，再评估对应合同，不预建策略框架。

## Risks / Trade-offs

- idle 仅回收闲置内存，不降低长请求执行时的约 1.5 GiB 峰值；不能将其宣传为低峰值模式。
- 下一次请求承担重载成本；默认 5 秒预算不变，macOS 观测不能证明所有 CPU 都足够快。
- health 200 不是模型驻留证据；生产 readiness 已用认证编码，不改成 health。
- 等待 native 主循环观察空闲，阈值不是精确释放 SLA。长任务/在途请求不由外部定时器打断。
