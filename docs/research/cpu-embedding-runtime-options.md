# CPU embedding：更小量化与 llama.cpp 候选

选型已收口：用户确认采用 **llama.cpp + Q4_0 CPU**，停止本轮框架与量化调研，GPU 留待后续。以下保留当时的比较结果和建议；实施以[第二阶段接入计划](../plans/local-backend-stage-2-design.md)为准。

2026-09-11。用户已确定本阶段采用 CPU 路线，GPU 不再作为接入前置验证。后续获准的 [llama.cpp CPU 对照已完成](./llama-cpu-validation.md)：Q8 与显式全四位 Q4_0 有温和性能和内存收益，Q4_K_M 不适合作为默认。下文保留选型前的候选资料；实际结果以补测报告为准。

选择 CPU 的理由是部署、兼容和维护成本，而不是已经证明其准确度更好。此前 Q4F16 修复副本与 FP32 在 30 个合成查询上检索指标相同，向量均值余弦 0.9903；官方 CPU INT8 均值约 0.9738。不能把这批结果解释为 GPU 精度下降更多，也不能用不同导出路线推导硬件本身影响质量。

## 文件体积与内存是两个问题

已测官方 INT8 ONNX 98,247,878 bytes，另有约 25.3 MB tokenizer；运行完整负载后 RSS 约 888–911 MiB。模型文件继续缩小不意味着进程 RSS 按比例下降。下一轮应同时测模型、完整分发资源、加载后和实际负载后的 RSS。

本地检查 ONNX initializer 得到：180,000 × 384 的词嵌入表在官方 INT8 中占 69,120,000 bytes；此前 Q4F16 的这张表仍为 FP16，占 138,240,000 bytes。因此 Q4F16 虽有四位矩阵权重，文件仍有 154 MB。想明显压小这个模型，不能只量化 Transformer 矩阵，也需要覆盖词嵌入表。

| 候选，十进制 MB | 实际文件大小 | 已知限制 |
| --- | --- | --- |
| 官方 ONNX quint8_avx2 | 98.25 | M4 CPU 已实测；本阶段基线 |
| tooape GBQ4 ONNX | 61.25 | 作者说明把词嵌入 Gather 和矩阵都量化到四位；面向 WebGPU，当前 CPU 加载、速度和质量未实测 |
| mykor GGUF Q4_K_M | 105.47 | 使用 llama.cpp 生态；不比当前 INT8 小，不能凭 Q4 名称推断内存和速度 |
| mykor GGUF Q3_K_L | 103.12 | 更低位宽也没有明显缩小；质量未实测 |
| cstr GGUF IQ4_XS / Q4 imatrix | 97.07 / 97.29 | 仓库明确面向 CrispEmbed，GGUF metadata 为 bert；不能当作已确认 llama.cpp 兼容产物 |

tooape 连 tokenizer 约 86.55 MB；ONNX Runtime 当前主线 CPU kernel 注册中有 GatherBlockQuantized，说明存在 CPU 实现，但不等于本机已安装版本与该图已验证兼容。其作者发布的检索数字包含私有样本，不代替本项目的测量。

## llama.cpp 值得测的优势与代价

主线 `df03399b885831b2a1603b3abb0d8c156808e363` 的 `src/models/modern-bert.cpp` 明确处理 Granite R2 的 SiLU/SwiGLU 差异；需同时固定包含 97M 多语言 tokenizer 支持的构建。模型卡明确指出旧版本会报 unknown pre-tokenizer，不能只看到支持 ModernBERT 就认为任意旧发行包可用。

llama.cpp 为 MIT，提供 Apple ARM NEON/Accelerate 和 x86 指令优化、CPU 构建及跨平台构建说明。它有直接的 embedding 服务、CLS pooling 和 L2 normalization 能力；这些是候选能力，不是本机性能或 Windows 已验收。

对当前 Bun/Elysia 后端，潜在接入收益是由原生执行程序负责 GGUF、tokenizer 和编码，不再需要 Bun worker 加载 ONNX Node binding、额外 JS tokenizer 并处理 ORT 动态库加载路径。可考虑由现有服务管理一个私有 llama-server 子进程，继续由 Elysia 承担对外认证、准入、配置和状态；产品入口仍为 127.0.0.1:26186。这是候选结构，不是已接受的最终 IPC 合同。

代价仍然存在：按 OS/架构提供原生程序及其库，固定 CPU 指令兼容范围，处理进程生命周期、私有端点与认证、错误、输入限制和资源版本。llama-server 自带 HTTP 会引入私有监听端点；嵌入 C API 则会引入 FFI 或自建原生 worker。先用现成 server 验证，不同时实现两条接入路线，也不把 llama.cpp 接到现有主进程里造成新的阻塞风险。

以下是实测前的线索，现已由本机补测替代，不能继续当作待验证结论。ATF 的模型卡报告 F16 CPU RSS 约 299 MB、单请求约 23 ms，但缺少与本机同等的完整工作负载条件；这里只当作值得验证的线索，不能和本机 INT8 的约 900 MiB 直接比较或宣布三倍内存改善。量化越低不一定越快，CPU 算子、解量化和批量工作方式都会影响结果。

## 建议的有界比较

1. 固定包含该模型完整支持的 llama.cpp 构建，显式禁用 GPU 执行；用可溯源 F16 GGUF 验证 tokenizer、CLS、L2 和已有数值样例，先确认实现正确。
2. 在同一构建下比较 Q8 与 Q4；不先追 Q3/Q2。沿用 ONNX INT8 CPU 的线程和 token 长度，补齐相同端到端计时、冷加载、RSS、batch 和 40 文档/30 查询的冻结评测。更小的 GBQ4 ONNX 只作为体积优先时的候选，不无限扩展框架矩阵。
3. 若 llama.cpp 在资源或交付复杂度上有明确收益、质量与稳定性可接受，再替换阶段二计划中的 ORT worker 细节；否则直接用已验证 ONNX INT8 完成 CPU 常驻接入。保持一个模型进程、一个实施 Issue 和一个 PR，不同时交付多个 runtime。

本篇最初为选型调研；后续已在忽略目录安装并运行 llama.cpp 对照，详见补测报告。仍未实施产品功能。

## 可追溯来源

以下为本轮读取的原始模型卡/API/上游源码，文件大小来自 HF API，而非四舍五入的模型卡表格。

- [官方模型 API](https://huggingface.co/api/models/ibm-granite/granite-embedding-97m-multilingual-r2?blobs=true)，revision `835ad14087e140460703cf0fae09f97d469d65c2`。
- [tooape GBQ4](https://huggingface.co/tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX)，revision `54db88c5667bd79b4aea24ea6027a7ef45a7bbb5`。
- [mykor GGUF](https://huggingface.co/mykor/granite-embedding-97m-multilingual-r2-GGUF)，revision `45ce642d3fab2033d167ec09641a159010f7d9d9`。
- [cstr GGUF](https://huggingface.co/cstr/granite-embedding-97m-multilingual-r2-GGUF)，revision `a2964fb2078779d378c94747f536aa0090d9b52e`。
- [ATF 可溯源 F16 与作者验证](https://huggingface.co/atfai/granite-embedding-97m-multilingual-r2-GGUF)，revision `cb3a901538f0b154ff9df54186fef4b3f52f0600`。
- [llama.cpp ModernBERT 实现](https://github.com/ggml-org/llama.cpp/blob/df03399b885831b2a1603b3abb0d8c156808e363/src/models/modern-bert.cpp)、[server 合同](https://github.com/ggml-org/llama.cpp/blob/df03399b885831b2a1603b3abb0d8c156808e363/tools/server/README.md)、[构建](https://github.com/ggml-org/llama.cpp/blob/df03399b885831b2a1603b3abb0d8c156808e363/docs/build.md)。
- [ORT CPU kernel 注册](https://github.com/microsoft/onnxruntime/blob/main/onnxruntime/contrib_ops/cpu/cpu_contrib_kernels.cc)，仅作为上游有实现的证据，非本机产物兼容性验证。
