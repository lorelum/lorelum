# ONNX 本地最小验证

结论：**在本机 Apple M4 / 32 GiB / macOS arm64 上，固定 Granite 97M R2 的 ONNX CPU 路线通过正确性与起步性能标准，适合进入接入规划。** 必须隔离推理执行，并把原生库作为分发资源；不能直接在 Elysia 主线程运行，也不能只交付未经资源处理的单文件。

本次获准执行最小验证，未改产品代码、生产依赖、用户 Store 或用户 config。[结构化结果](./onnx-validation/results.json)保留模型资源摘要、版本、两轮测量与采样口径；[接入计划](../plans/local-backend-stage-2-design.md)基于这些实测更新。

后续 [CPU INT8 补测](./onnx-cpu-quantization-validation.md)：512-token 单条吞吐提升约 13%–28%，常驻 RSS 降低约 42%–48%；小型合成检索集未见指标下降，但不代表量化无损。本轮 FP32 RSS 超过原先 1.5 GiB 假设，原内存结果不能视为稳定上界。

[社区 Q4F16 补测](./onnx-webgpu-q4f16-validation.md)：原文件加载失败，本地修复副本的 WebGPU 吞吐较 FP32 提升约四成，小型检索集未见指标下降。修复修改了执行图，不能当作社区原件直接交付。

## 验证对象

- Bun 1.3.8；onnxruntime-node 1.29.0；@huggingface/tokenizers 0.2.0；CPU，4 个 intra-op threads、1 个 inter-op thread。本节为 CPU 测试，未做线程调优；GPU 补测见后文。
- 固定模型：ibm-granite/granite-embedding-97m-multilingual-r2，revision `835ad14087e140460703cf0fae09f97d469d65c2`。
- 官方未量化 ONNX：390,004,608 bytes，SHA-256 `68e592b160673d30250824c1116bc6ab33f70efb22b97c9e1d7ce1e69c1c9d70`。模型、权重和 tokenizer 下载后与 Hub LFS SHA 核对；其余文件摘要也已记录。
- 独立参考：PyTorch 2.8.0 + Transformers 4.56.2 + NumPy 2.2.6，本地原始 safetensors 权重、CPU float32、eager attention；禁用 remote code，只从本地资源加载。Python 仅用于对照，不属于拟接入运行链。
- ONNX Runtime 为 MIT，JS tokenizer 为 Apache-2.0；使用固定版本，实验依赖与模型均留在被忽略的 `.tmp-onnx-validation/`。未来生产包仍须检查最终解析出的依赖和随包许可证。

验证开始前设定的起步标准：不超过 64 tokens 的查询 p95 < 200 ms，512-token 文档编码 >= 5 条/秒，模型运行进程常驻 RSS < 1.5 GiB。它们用于本次工程可行性判断，不是面向所有设备的产品 SLA。正常卸载和控制响应另行验证，未测 native 硬挂死恢复。

## 正确性：与官方参考一致

中英文、TypeScript 代码、Unicode/组合字符、空文本、纯空白、混合长度 padding 和较长输入共 8 组、10 个向量。输入序列最长 1025 tokens；每组在两个实现中采用同样的 batch。

- JS 与 Python tokenizer 的 input_ids、attention_mask 全部逐项相同。
- 返回维度均为 384；按官方 CLS pooling 后 L2 归一化，所有值有限。
- 源码探针最小余弦相似度为 0.9999999999996696；逐分量最大绝对误差为 3.65e-7。
- 编译后搬到独立目录的探针也重新通过全部对照，具体误差见 results.json。

预设容差为 cosine >= 0.9999、max absolute error <= 1e-3，结果明显优于该阈值。这支持本次模型/版本/输入范围内的数值一致性；不代表已完成全部语言覆盖、检索质量评测或 32K 上下文验收。空输入是数学一致性测试，不意味着产品接口应接受空内容。

## 性能：常驻 CPU 已够进入下一步

下面是两轮独立进程的 p95 范围；包括 JS tokenization、张量组装、推理和向量后处理，不含模型加载。每个 workload 先预热 3 次，短查询采样 60 次，文档 20 次，批量 10 次；64-token 边界在确认轮采样 40 次。

| workload              | p95                 | 吞吐/说明       |
| --------------------- | ------------------- | --------------- |
| 英文短查询，11 tokens | 5.1–5.5 ms          | 单条            |
| 中文短查询，17 tokens | 4.4–8.0 ms          | 单条            |
| 64-token 查询边界     | 7.2 ms              | 确认轮          |
| 256-token 文档        | 30.9–33.6 ms        | 35.0–37.5 条/秒 |
| 512-token 文档        | 75.8–84.8 ms        | 13.6–15.1 条/秒 |
| 8 × 512-token 批次    | 600.4–610.1 ms / 批 | 13.8–14.5 条/秒 |

输入为少量合成样本；长文档用重复文本精确控制 token 数，tokenizer 存在预热效应。它们适合测固定形状的最小计算成本，不是实际 Practice 集合的容量 benchmark，也没有测真正并发用户的排队延迟。批量在本机未显示显著吞吐优势，不据此引入复杂动态批处理。

tokenizer + session 初始化约 0.56–0.80 秒；专属编译子进程从 spawn 到 ready 两次为 0.64、1.48 秒。模型已在本地，未清除 OS 文件缓存；不是下载后首次使用的完整冷启动，且不包含未来生产工件校验的成本。

直接运行探针的稳态 RSS 为 1.12–1.38 GiB，采样峰值约 1.24–1.39 GiB。隔离实验确认轮模型进程采样最大约 1.36 GiB，轻量父进程约 43 MiB。RSS 不是精确权重内存，也不是所有瞬时峰值的上界；不能将这套结果外推到 8 GiB 设备。

## 两个实测限制与已验证解决路径

### 原生推理会阻塞调用线程

onnxruntime-node 1.29.0 的 backend.js 将同步 native run 放进 setImmediate。主线程探针的最大定时器延迟约 602–621 ms；返回 Promise 并没有使这段计算脱离调用线程。

专属编译推理子进程通过 stdio 与一个轻量 Bun HTTP 父进程通信后：

- 小型中文请求包含 HTTP、IPC、编码和响应序列化，p95 为 4.2–4.4 ms。
- 同时执行 8 × 512-token 批次时，健康请求 p95 为 0.47–0.53 ms；两轮观察到的最大值为 2.5、23.4 ms。
- 父进程定时器最大延迟为 3.9、29.8 ms，显著低于直接运行时的约 602–621 ms。
- 模型卸载包含 session.release 和确认进程退出，约 110–126 ms，exit code 为 0。

这是专用探针 HTTP 链路，不是已修改的 Lorelum CLI，也没有包含现有 HMAC 握手和生产错误适配。最终接入仍须在真实 CLI/backend 链路重复验收。session.release 后同一进程 RSS 没有立即回落到基线，因此采用进程退出作为资源回收边界，而不把 release 返回等同于内存全部归还 OS。

### 纯单文件编译缺少动态库

直接 `bun build --compile` 将 .node 提取到临时目录后，无法找到依赖的 libonnxruntime.1.dylib。把整个 npm 包 external 后也遇到编译程序的模块解析问题，不能当作可交付方案。

最小可行探针采用：JS 部分打入二进制，仅将 native binding 改为从可执行文件旁的固定资源目录显式加载。保留匹配版本的 .node 与 .dylib，两者约 42 MiB；探针可执行文件约 58 MiB，模型文件另置。

这个目录被复制到独立临时路径，从无关 cwd 启动，PATH 仅保留系统目录，完整数值对照通过。程序直接执行二进制，未调用外部 Node/Bun/Python。实验构建使用了小型 binding 路径适配，证明资源布局可行；尚未实现正式构建、安装、更新、代码签名或 Windows DLL 分发。

## GPU 补测：WebGPU 能运行，收益取决于输入

实际调用已安装包的 listSupportedBackends，onnxruntime-node 1.29.0 返回 cpu、webgpu、coreml 均 bundled=true。此前仅凭在线 Node 平台表判断 CoreML 未包含并不充分，应以具体分发包核查为准。本次继续使用相同模型、tokenizer、Bun、4 个 CPU threads 和合成输入，无新增运行依赖。[GPU 结构化结果](./onnx-validation/gpu-results.json)

Core ML 测试设置 MLProgram + CPUAndGPU（coreMlFlags=48，排除 ANE），在创建 MLModel 时失败，执行计划构建错误码 -7。该配置尝试分配 49 个 Core ML 分区、746/890 个图节点，但 session 未成功创建，因此没有 Core ML 性能结果。这不证明静态形状、其他选项或模型处理后也无法运行；本轮没有继续扩大 Core ML 调参范围。

WebGPU + CPU fallback 成功运行。profiling 的节点事件显示 MatMul、LayerNormalization、Softmax 等交给 WebGpuExecutionProvider，仍有形状处理等节点在 CPU。不是全量 CPU 回退，也不能称为纯 GPU 执行。8 组向量对照再次通过，最大绝对误差约 4.52e-7，最小 cosine 约 0.99999999999958。

确认轮顺序运行同样的 CPU 和 WebGPU workloads，均为初始化完成且预热后的端到端编码时延：

| workload              | CPU p95       | WebGPU p95    |
| --------------------- | ------------- | ------------- |
| 英文短查询，11 tokens | 3.5 ms        | 7.4 ms        |
| 中文短查询，17 tokens | 3.9 ms        | 7.4 ms        |
| 64-token 查询         | 7.9 ms        | 9.3 ms        |
| 256-token 文档        | 31.2 ms       | 22.8 ms       |
| 512-token 文档        | 75.7 ms       | 52.2 ms       |
| 8 × 512-token 批次    | 617.3 ms / 批 | 445.8 ms / 批 |

按平均编码时间计算，确认轮单条 512-token 吞吐由 14.4 提升到 19.4 条/秒，8 条批次吞吐由 13.9 提升到 19.1 条/秒，约提升 34%–38%。首轮 GPU 的同类吞吐约 19.3 条/秒，方向一致。短请求则没有收益，不以“启用 GPU”推断所有场景更快。

WebGPU 首次编码约 48–50 ms，CPU 对照约 7 ms；两轮 GPU session/ tokenizer 加载共约 0.50–0.59 秒。OS 与驱动缓存未清除，不能据此宣称 GPU 冷启动成本固定。

WebGPU 直接运行仍造成约 482–485 ms 主线程定时器延迟，因此没有取消隔离推理的理由。其 RSS 已记录，但本轮没有单独测量 GPU/统一内存分配、设备利用率或功耗，不把 RSS 较低写成总内存更省。

本轮没有重做 GPU 的编译资源布局、专属进程 HTTP 链路或 Windows/GPU 验证。单凭这次小样本时延比较，不足以定稿默认 CPU；后续吞吐与执行路径对照见下一节。

## 持续负载与 MPS 对照：初次 GPU 测量不能代表效率上限

用户指出原测试没有证明 GPU 被充分利用。本次补测固定 512-token 输入、batch 1/8/32，先 tokenization 后计时，WebGPU 每项持续测量至少 10 秒；另用相同权重、FP32 的 PyTorch 2.8.0 / Transformers 4.56.2 MPS + SDPA 作对照，每项至少 8 秒。实验依次运行，避免两个探针同时争抢 GPU。[结构化证据](./onnx-validation/gpu-saturation-results.json)

MPS 明确禁用 CPU fallback，并重新通过全部向量校验。计时前后调用 torch.mps.synchronize，CLS+L2 向量返回 CPU，避免只记录异步提交时间。

| batch × 512 tokens | ONNX / WebGPU 吞吐 | PyTorch / MPS 吞吐 |
| ------------------ | ------------------ | ------------------ |
| 1                  | 19.9 条/秒         | 31.8 条/秒         |
| 8                  | 21.4 条/秒         | 29.3 条/秒         |
| 32                 | 20.7 条/秒         | 28.9 条/秒         |

MPS 吞吐按总处理条数/总测量时间计算。MPS 使用设备端输入和设备端 CLS/L2，只返回小向量；当前 ONNX 接口返回整个 hidden state 后在 host 取 CLS。Attention 与融合实现也不同。因此表格比较的是两条执行路径，不是控制所有其他变量后的纯硬件对比；这些差异正是后续优化要检查的部分。

扩大 batch 没让当前 WebGPU 路径吞吐继续增长，但另一路径能更快，说明不能以原来的 WebGPU 小样本结果判定 GPU 能力或整个框架选择。也不能把 MPS 比较结果直接转换成引入 Python 运行时的决定。

同步读取了 IORegistry 的设备级 Device Utilization。WebGPU 测量窗口均值约 98%–99%，MPS 大批量约 99%；开始前全设备基线已经约 49%。这是包含桌面/其他程序的全设备活跃度，不是本进程独占利用率或计算单元 occupancy，不能据此宣称“算力吃满”。系统 powermetrics 需要管理员权限，本轮未获得 GPU 瓦数、频率或温度，因此既不能用温度观感证明未使用 GPU，也不能用活跃度 99% 宣称效率达到上限。

**当时的修正决策：保留 CPU 已可用的结论，暂缓“默认 CPU”选型定稿。该暂停已被后续 llama.cpp Q4_0 CPU 的选定替代。** 下一步应有界检查 ONNX 的输出回传、Attention/算子融合与更高效的 GPU 执行路径，并保持权重、精度、tokenizer、数值容差一致。无需为诊断结果马上增加新的生产框架，也不自动驻留 CPU/GPU 两套 session。

## 可复现范围与保留材料

本地实验目录保留：

- download.py 与 model/manifest.json：固定 revision 下载、资源摘要。
- fixtures.json 与 reference/reference.py、reference/results.json：官方 CPU 对照及 token 序列。
- probe.ts：数值对照、初始化/常驻计时、RSS 和主线程定时器采样。
- build-portable.ts、portable/：编译路径适配及原生资源目录。
- isolation.ts：专属子进程、stdio、HTTP 健康请求和退出验证。
- bun.lock、reference/dependencies.txt：实验版本记录。

这些实验脚本没有变成生产模块，模型权重、运行环境、二进制和完整向量结果不入库。结构化摘要只包含合成数据指标与公开资源身份。实施时应提炼必要的验收脚本，避免为了复现最小实验而建立新的通用 benchmark 框架。

尚未完成：Windows/其他硬件、GPU 的正式分发与隔离链路、真实 Practice 文本集合、native 卡死与父进程异常退出、连续多次加载卸载的资源曲线、正式分发签名以及完整 CLI 冷启动收益。它们不影响本次“进入接入规划”的判断，但不能被写成已通过。

> 归档说明：选型结束后已清理 `.tmp-onnx-validation/` 中的临时模型、环境、脚本和原始日志。本文对该目录的描述为实验时状态；保留的公开证据以本文链接的结构化摘要为准。选定的 Q4_0 模型及回归参考仅留在忽略的本地验收缓存，不随仓库提交。
