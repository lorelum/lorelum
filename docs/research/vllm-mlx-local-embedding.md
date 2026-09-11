# vllm-mlx：Lorelum 本地 embedding 选型调研

调研时间：2026-09-11，Asia/Shanghai。仅查阅一手文档、发布元数据、源码与测试；未安装候选依赖、下载模型权重或运行推理。本文的性能与资源结论不包含本机实测。对应[第二阶段计划](../plans/local-backend-stage-2-design.md)。

## 结论

**暂不将现成 vllm-mlx 作为 Lorelum 固定 Granite 97M embedding 的生产默认方案。** 依据是依赖许可证和具体模型实现差异；不能只凭“支持 ModernBERT”和“支持 embedding”就判定这个组合可用。

本轮发现两个前置问题：

1. vllm-mlx 自身为 Apache-2.0，但其必需依赖 mlx-embeddings 的 v0.0.5、v0.1.0 均为 GPLv3。按本仓库 AGENTS.md，纳入生产依赖前必须取得 maintainer sign-off；研究源码不等于获准引入依赖。直接改用 mlx-embeddings 也不会消除这个问题。[S2][S3]
2. Granite 97M R2 要求 SiLU，而上述两个版本的 mlx-embeddings ModernBERT MLP 硬编码 GELU，并过滤掉 hidden_activation 配置。即使成功加载并输出 384 维向量，也不能据此认定实现正确；先修复这一差异，再验证数值一致性。[S4][S5][S6]

框架仍有可用的服务能力、持续维护和 Apple Silicon 测试。对于纯 embedding，完整服务的安装与生命周期成本需要单独评估；不以其生成模型的 tokens/s 或 continuous batching 宣传推断 embedding 收益。[S1][S7][S8]

## 核查版本，避免把 main 当发行版

| 对象 | 本次核查基线 | 结论边界 |
| --- | --- | --- |
| vllm-mlx 发布版 | v0.4.1，2026-08-12 发布；PyPI 当前也为 0.4.1 | 推荐验证必须绑定的可发布基线；发行资产为 Python wheel/sdist，不是独立 Mac 应用 |
| vllm-mlx 开发分支 | ec8e4932615acbcdd1dcefccbf095ff49b5b7b1e，2026-09-05 | GitHub compare 显示比 v0.4.1 多 54 个提交，但包版本仍写 0.4.1 |
| mlx-embeddings | 必需依赖约束 >=0.0.5；PyPI 当前为 0.1.0 | 两个版本都核查许可证与 ModernBERT 路径；安装结果不能仅由 vllm-mlx 版本推定 |
| Granite 97M R2 | 835ad14087e140460703cf0fae09f97d469d65c2 | 固定模型来源，不能用可漂移的 Hub main 代替 revision |

发布信息来自 GitHub releases API、PyPI JSON API，开发 SHA 来自 GitHub commits API；不是根据 README 中的版本推测。[S1][S2][S11]

v0.4.1 已有模型感知的截断长度和成功推理后的 MLX cache 清理。main 又加入输入长度 ceiling、超长输入 error 策略、默认 4096 padded-token 的子批预算，以及失败时的 finally 清理。**这些新增控制不属于已发布 v0.4.1。** 4096 是子批预算，一个更长的输入仍可能单独执行，不能当作单条输入硬上限。[S8][S9]

## 它与 vLLM、vllm-metal 的关系

vllm-mlx 的独立服务直接使用 MLX、mlx-lm、mlx-vlm，并自行组织 API 和生成调度。上游 vllm 是 optional extra，包也提供 vLLM platform-plugin 入口；因此它不是完全无关的项目，但不能把它的独立服务等同于上游 vLLM 引擎。[S2][S7]

vllm-metal 是 vllm-project 下另一条社区维护的插件路线，由上游 vLLM 提供服务、调度与 block 管理，插件提供 Apple Silicon 执行路径。该项目文档将 text pooling 标为实验性；不能把它的兼容表或 API 能力算到 vllm-mlx 名下。[S12]

vllm-mlx 的 embedding 实际链路是：

```text
/v1/embeddings
  → vllm-mlx 的模型选择、输入/响应适配
  → EmbeddingEngine
  → mlx-embeddings 的 tokenizer 与模型实现
  → MLX 运算
```

源码没有将这条编码路径交给生成模型的 continuous-batching scheduler。它接受同一请求的字符串列表，不代表不同请求能自动连续批处理。[S7][S8]

## Granite：架构名字匹配，算子并不匹配

固定 revision 的官方 config 声明 modernbert、384 hidden size、32768 context、CLS pooling，以及 hidden_activation 为 silu。mlx-embeddings 的 loader 能识别 ModernBERT，pooling 路径也能按配置取 CLS 并归一化，这些是候选成立的条件，但不构成正确性证明。[S4][S5]

本次交叉核对的关键差异：

| 项目 | 官方模型/参考实现 | mlx-embeddings v0.0.5、v0.1.0 |
| --- | --- | --- |
| MLP 激活配置 | Granite 指定 SiLU | ModelArgs 没有 hidden_activation |
| 配置读取 | Transformers 读取 config.hidden_activation | BaseModelArgs.from_dict 只保留构造签名中的参数，该字段被忽略 |
| MLP 计算 | ACT2FN 按配置选激活 | 固定 nn.GELU |
| 向量维度与 pooling | 384 维、CLS、归一化 | 维度和 pooling 可匹配，但无法抵消 MLP 差异 |

这是**源码确认的计算语义差异**，不是根据一次低分 benchmark 推测“不支持”。本轮没有测量它导致的向量误差或检索损失，也没有证明除此之外不存在其他差异。[S4][S5][S6]

后续若继续这条路径，应先由上游修复或批准维护补丁，再用官方 Transformers 输出作参考，固定同一权重、tokenizer、输入投影和精度比较。先比较未量化模型，再评估量化；不能通过随意改 pooling、归一化或模型 revision 让测试通过。

## 服务能力与 Lorelum 接入成本

### 现成能力

发布版有 OpenAI 风格的 /v1/embeddings，支持单条/批量输入、顺序 index 与 usage。请求时模型选择有 allowlist；ModernBERT 示例在列表中，但 Granite 不在其中。自定义模型须启动时明确指定 embedding-model，此后锁定同一模型。使用已准备好的本地目录可避免把 Hub 模型名当成固定资源身份。[S7][S10]

### 标准 serve 并非专门的 embedding-only 启动器

v0.4.1 与本次 main 都要求主 MODEL 或 models-config。embedding-model 是额外加载项；正常启动还会走主生成模型的加载/注册流程。不能把“存在 embeddings endpoint”理解为已有一个只加载 embedding、无需额外组装的 CLI 模式。[S7]

Python 中直接使用 EmbeddingEngine 是项目文档提供的路径；若自己组装仅 embedding 的进程，可以避免加载无关的主语言模型。但这需要我们拥有启动协议和资源释放，且正常安装 vllm-mlx 仍会解析完整必需依赖，不能以只 import 一个类推断安装体积很小。[S2][S10]

### 卸载与响应性不能套用生成模型承诺

EmbeddingEngine 没有独立公开的 unload 方法。main 的模型复用依据全局 embedding engine，生成模型的 residency manager、idle unload 和 shutdown 代码不等于已管理了 embedding 生命周期。清理 MLX allocator cache 也不等于释放仍被模型对象引用的权重。[S7][S8][S9]

编码在 async HTTP handler 内同步执行；源码没有把这段工作移交独立 executor。这意味着需要验证推理期间 Python 控制接口的响应性。把它放到 Bun 后端之外能隔离 Bun 事件循环，但不能自动证明 Python 内部健康检查和超时能及时执行。[S7]

如果选择完整服务适配，Lorelum 仍应保留 127.0.0.1:26186 作为唯一产品入口，内部模型进程只能由后端拥有。加载等于启动并验证模型进程、卸载可用终止专属进程回收全部资源；需验证在途请求、超时、父进程退出、异常崩溃以及孤儿进程回收。内部连接方式需单独定稿，不能把一个新的用户可配 endpoint 偷加进 config。

## 平台、分发与维护

vllm-mlx 声明 Python >=3.10、macOS Apple Silicon，插件检查 darwin/arm64。它不是当前 Windows 或 Intel Mac 的通用 backend 方案。macOS arm64 的项目 CI 有 MLX 与 embedding 相关测试，但这些不能代替 Lorelum 的 Granite 实测。[S2][S7][S13]

安装依赖除 MLX、mlx-embeddings 外，还包含 mlx-lm、mlx-vlm、Transformers、Gradio、OpenCV、torchvision、FastAPI/Uvicorn 等。发布 wheel 是 Python 包；Bun 编译为单文件不会将这个 Python/Metal 运行环境自动打包进去。实际下载体积、磁盘占用和 RSS 本轮均未测量，不能用 wheel 文件大小代替整个安装成本。[S1][S2]

多个依赖只设置下限；复现实验必须同时固定 Python、依赖解析结果、runtime 与模型 revision。只记录 vllm-mlx==0.4.1 不足以复现。

项目不是停止维护的仓库：本次 main 与 Apple Silicon CI 有近期更新，发布中也修复了 embedding 资源问题。不过项目 metadata 仍为 Alpha，且已发布版本与 main 存在明显差异。这里不据此推断生产故障率。[S1][S2][S13]

## 许可证结论的边界

本次确认的是：vllm-mlx 为 Apache-2.0；mlx-embeddings v0.0.5/v0.1.0 的 LICENSE 和 metadata 都声明 GPLv3；它是 vllm-mlx 的必需依赖，而不是只有选某个额外功能才安装的 extra。[S2][S3]

这已经足以触发仓库的依赖引入审批规则，但不等于本报告对所有分发方式作出了法律结论。单独使用、随产品分发、维护修改版，以及通过 IPC/HTTP 交互的许可义务需要按实际交付方式评审；不能把“隔一个进程”当作许可问题已解决。

本轮只做源码研究，没有引入生产依赖，也不请求立即批准例外。若不准备接受这条依赖的许可与维护成本，就应停止这条生产选型分支，继续核查其他 runtime，而不是先集成再补手续。

## 下一步怎么决策

| 问题 | 当前判断 | 继续条件 |
| --- | --- | --- |
| 是否证明 MLX 路线有本地 embedding 能力 | 有项目与源码证据 | 不代表 Granite 已正确运行 |
| 是否直接采用标准 vllm-mlx serve | 不建议作为本阶段默认方案 | 先证明仅 embedding 的进程和依赖成本可接受 |
| 是否直接采用它包装的 mlx-embeddings | 当前也不建议直接纳入 | 同样先解决许可证及 SiLU 实现差异 |
| 是否改用其他 embedding 模型绕开问题 | 本轮不改既有模型合同 | 更换模型需要单独对齐，且不会消除 GPL 依赖 |
| 是否现在做完整性能 benchmark | 不值得先投入 | 许可路径和模型计算正确性先成立 |

建议 T1 先完成“运行包许可与精确模型实现”筛选，再对通过筛选的候选进行同权重输出对照、加载/复用耗时、批次内存和真实退出验证。本轮不选定替代框架；其他候选也必须用同样的源码与依赖标准审查。

若获准继续验证 vllm-mlx，最小实验清单为：固定全部版本；本地模型目录断网可加载；无额外主 LLM；与官方输出对照；两个独立客户端复用；长短混合批次有界；模型进程失败不拖死 Bun 控制服务；卸载/停止后无遗留进程。内存回收和响应时延用实测判定，不只检查返回了 HTTP 200。

## 一手证据索引

以下 URLs 绑定 tag/commit，除明确注明的元数据与模型卡外，不以漂移的 main 支撑发布版结论。

- S1 发布与资产：`https://github.com/waybarrios/vllm-mlx/releases/tag/v0.4.1`；`https://pypi.org/pypi/vllm-mlx/json`。
- S2 依赖、Python、许可证与 vLLM extra：`https://github.com/waybarrios/vllm-mlx/blob/v0.4.1/pyproject.toml`，约 8–114 行。
- S3 传递依赖许可证：`https://github.com/Blaizzy/mlx-embeddings/blob/v0.0.5/LICENSE`、`https://github.com/Blaizzy/mlx-embeddings/blob/v0.1.0/LICENSE`；相同 tag 下 pyproject.toml 也声明 GPLv3。
- S4 Granite 固定配置：`https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2/blob/835ad14087e140460703cf0fae09f97d469d65c2/config.json`。本次通过官方 resolve URL 直接读取 JSON 核查。
- S5 ModernBERT 与字段过滤：`https://github.com/Blaizzy/mlx-embeddings/blob/v0.1.0/mlx_embeddings/models/modernbert.py`（ModelArgs、ModernBertMLP、pooling）；同目录 base.py 的 BaseModelArgs.from_dict；v0.0.5 同路径复核。
- S6 官方参考计算：`https://github.com/huggingface/transformers/blob/v4.56.2/src/transformers/models/modernbert/modeling_modernbert.py`，ModernBertMLP。
- S7 发布版入口与生命周期：`https://github.com/waybarrios/vllm-mlx/blob/v0.4.1/vllm_mlx/cli.py`（serve_command）；同目录 server.py（load_embedding_model、create_embeddings、lifespan）。
- S8 发布版 embedding：`https://github.com/waybarrios/vllm-mlx/blob/v0.4.1/vllm_mlx/embedding.py`。
- S9 开发分支 embedding：`https://github.com/waybarrios/vllm-mlx/blob/ec8e4932615acbcdd1dcefccbf095ff49b5b7b1e/vllm_mlx/embedding.py`；同 SHA 的 cli.py/server.py。
- S10 发布版 embeddings 指南：`https://github.com/waybarrios/vllm-mlx/blob/v0.4.1/docs/guides/embeddings.md`；加载路径：`https://github.com/Blaizzy/mlx-embeddings/blob/v0.0.5/mlx_embeddings/utils.py`。
- S11 版本差异：`https://github.com/waybarrios/vllm-mlx/compare/v0.4.1...ec8e4932615acbcdd1dcefccbf095ff49b5b7b1e`；模型 revision 来自 Hugging Face 官方 models API。
- S12 vllm-metal 的不同架构：`https://github.com/vllm-project/vllm-metal` 与其 docs/supported_models.md；仅作项目区分，未做其完整选型审查。
- S13 CI 配置与运行：`https://github.com/waybarrios/vllm-mlx/blob/ec8e4932615acbcdd1dcefccbf095ff49b5b7b1e/.github/workflows/ci.yml`；`https://github.com/waybarrios/vllm-mlx/actions/runs/33979875060`。
