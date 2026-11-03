# Issue #305 验证记录

## 验证状态与环境

本记录对应 `reclaim-idle-model-memory` 的本地工作树实现：统一 native recipe 启用 `--sleep-idle-seconds 60`，其余生产编码参数与协议不变。未发布、未替换全局安装或用户共享 Backend。

- 本机：Apple M4、32 GiB、macOS 15.7.1（24G231）、arm64；Bun 1.4.2。
- 固定模型：66,345,216 bytes，SHA-256 `18e8ce8ce834790618e90d26bed465cca87362076f3042eb0d8eee0732596f59`。
- native：llama.cpp b10901，commit `28ff0958291ce3465fabd7bd679d4b0edd742bd9`，build identity `d513b061f4739adc6e3e0873da8e7c2a15ca63aa72093ae1ed035936ad9b5a42`。
- 基线与修改后使用同一个本地 native candidate、同一模型、4 threads、CPU、2048 batch/microbatch 和两个 slots。基线仅禁用 sleep；修改后由目标工作树的真实隔离 Backend 使用生产默认参数启动。
- 公共核心输入是 `" memory"` 重复 2,000 次（native usage 实测 2,002 tokens），以及加上 `工程知识检索与实现验证。` 的 2,012-token 混合 batch。两侧短热身文本不同；修改后另有 slot 布局参考准备，因此不据此比较吞吐或宣称峰值降低。

## 内存与延迟

单位为 MiB；基线 footprint 由 macOS 整数显示，修改后按 footprint bytes 换算。RSS 与 footprint 同时采样，不能互相替代。

|阶段|基线 footprint|修改后 footprint|修改后 RSS|
|---|---:|---:|---:|
|首次 2,002-token 长请求后|约 1,545|1,508.11|1,234.44|
|重复长请求后|约 1,546|1,508.19|1,098.53|
|后续短请求后|约 1,546|1,508.44|1,077.73|
|混合 batch 与参考准备后、idle 前|约 1,555|1,552.99|1,534.77|
|idle 回收后|65 秒后仍约 1,555|29.74|70.72|
|唤醒混合 batch 后|—|1,512.61|1,296.97|
|第二轮 idle 回收后|—|32.77|104.64|

修改后两轮均在最后编码结束约 61 秒的采样中观察到回收；采样约每 2 秒一次，不代表精确释放时刻。第一轮相对 idle 前 footprint 降低约 98.1%。基线 idle 65 秒时 RSS 已降至约 195.95 MiB，但 footprint 仍约 1,555 MiB。

首次唤醒的 2,012-token 混合 batch 总耗时 **1,002.35 ms**，包括模型重载与编码，使用产品默认 **5,000 ms** 请求预算。相同混合 batch 的热请求观察到约 319–495 ms。以上是单机样本，不是延迟 SLA 或跨机器性能保证。

## 行为验收

执行：

```sh
bun packages/backend/integration/idle-memory.integration.ts /absolute/path/to/model.gguf
bun packages/backend/integration/embedding.integration.ts /absolute/path/to/model.gguf
```

结果均为 `status: passed`。

- 完整短、长、重复长、短、idle、唤醒、第二轮 idle、显式 unload/reload 序列通过。
- 休眠和唤醒保留同一个 native 进程身份；状态保持 ready；状态查询与 ready 时重复 load 后，footprint 持续保持约 29.74 MiB，没有重新加载。
- 睡眠状态显式 unload 停止 owned native 并清除记录；reload 创建新的进程身份并成功编码。
- 所有输出为完整、按输入关联的 384 维有限归一向量。唤醒与显式 reload 相对于对应活跃 slot 布局的参考：最小 cosine 1、最大分量差 0。
- 既有 HTTP batch 验收通过 64 次输入关联比较、14 次标注语义检索检查、置换/重复输入，以及 8 条长输入超过 aggregate token budget 时的调度；三轮 unload/reload 通过。未提供冻结参考目录，因此没有执行该脚本可选的冻结 FP32/Q4 参考验收。

## 中途失败与定位

首轮 idle 验收已观察到约 1,554 MiB 降至 33.83 MiB，但直接比较相同 HTTP array 的向量触发 cosine > 0.999 断言。诊断日志显示休眠清空了 slot 历史，长短输入对应的 native slots 互换，底层 token 顺序随之改变。

在完全禁用休眠的同一个 native 进程中，通过两条长输入及短输入调整 slot 历史，复现相同差异：长向量 cosine `0.9989099718620785`，最大分量差 `0.006313011050224304`。该无休眠布局的向量与休眠后的对应向量逐元素一致。故没有改变生产编码参数或放宽严格阈值；回归改为先收集两种已存在的活跃布局参考，再匹配整组参考并检查严格容差和输入关联。已有 batch 语义检索验收仍保留。

额外尝试独立 HOME 下的 source CLI 命令未完成：临时目录路径经过 `/var` 符号链接，配置初始化保护拒绝该路径；随后清理命令因固定端口上已有非本次运行的服务而返回 port-conflict。没有停止或替换该服务。成功的主要验收使用现有 supervisor 的隔离 daemon、真实认证 HTTP client 和 native，不依赖该额外 CLI 尝试。

## 静态与单测

- `bun test packages/backend`：310 pass、2 skip、0 fail。
- `bunx tsc --noEmit -p packages/backend/tsconfig.json`：通过。
- `bunx oxlint packages/backend/src/runtime/llama-options.ts packages/backend/integration/idle-memory.integration.ts`：通过。
- 新集成脚本已按仓库 formatter 格式化；变更文档的 18 个本地链接目标检查通过。
- `openspec validate reclaim-idle-model-memory --strict` 与 `openspec validate --specs`：通过；当前 24 个 specs 无失败。

## 未覆盖与边界

没有验证 Linux/Windows、原 Issue 的 M5/macOS 26.3、长期高并发或发布安装包。只证明本机目标工作树的空闲回收、继续编码和所列语义场景；不会降低长请求执行期间的峰值内存，也不证明不存在其他泄漏。所有本次隔离进程与临时模型/runtime 目录均沿 finally 清理，模型文件只读；临时基线脚本已移除。
