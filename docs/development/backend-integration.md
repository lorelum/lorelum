# Backend integration 验收

这些脚本验证真实 native 模型、HTTP 和进程生命周期；普通 `bun test` 不会下载模型或启动这些验收。Backend 与 CLI 的 `typecheck` 都会检查各自的 integration 代码。

先按 [native 构建说明](../../native/embedding/README.md)准备匹配的 native 资源，并提供固定 Q4_0 模型的绝对路径。以下命令从仓库根目录执行，模型路径请替换为实际文件。脚本按顺序运行，避免不同验收同时占用 CPU，影响观测数据。

```sh
bun packages/backend/integration/embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
bun packages/backend/integration/daemon-embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
bun packages/backend/integration/model-download.integration.ts /absolute/path/to/granite-q4_0.gguf
bun run build:native
bun run test:native-smoke -- /absolute/path/to/granite-q4_0.gguf
```

| 入口 | Review 时关注的场景 |
| --- | --- |
| `embedding.integration.ts` | HTTP 认证调用、占用编码槽时的控制响应与 busy 拒绝、重复加载/卸载 |
| `daemon-embedding.integration.ts` | 常驻进程复用、native 无响应回收、native 崩溃、daemon 崩溃后的子进程回收和重启，以及 current CLI 对 protocol-mismatched daemon/native child 的 graceful 与 force 回收 |
| `model-download.integration.ts` | 本地传输在 1 MiB 后断开，按真实落盘偏移续传，校验后编码并复用缓存 |
| `project-context-native-smoke.integration.ts` | 通过 CLI command registry、真实 HTTP Backend 和 native 模型验证两个独立场景：ProjectContext 的冷启动、partial/strict/complete、目录复用、单条增量、rebuild、cache prune、model unload/reload 和坏 Practice fallback；检索方法的默认/实验往返、临时 mode、配置不写回及 operation 身份 |

每个入口先组装环境，再调用命名场景，最后清理自己拥有的资源。`integration/support/` 只放重复的 native fixture、进程等待/RSS 采样、断流服务器和冻结参考比较，不包含业务实现。

`test:native-smoke` 的 Store、ProjectContext、derived cache、Backend journal 和模型 cache 都在临时目录；它以调用方提供的模型文件作为只读本地下载源，不访问公网，也不启动、停止或复用用户 Backend。该 smoke 输出单机 `observations`，用于发现功能回归和保留可比较样本，不设置跨机器的性能通过阈值。

busy 场景通过编码入口的显式同步点占住请求，不依靠 sleep 猜测推理耗时；daemon 无响应场景暂停本次启动的 native 进程，让请求确定超时，再确认实际进程退出。这些是故障注入，不是性能测量。daemon 端口仍由现有 supervisor 合同决定，端口竞争会明确失败，不会改绑未知服务。

## CLI 原生 smoke 的场景边界

- [入口](../../packages/cli/integration/project-context-native-smoke.integration.ts)只选择场景、汇总结果，并在 finally 释放环境；默认依次运行两个场景。
- [原生环境](../../packages/cli/integration/support/native-smoke.ts)拥有临时目录、本地断流下载源、一个真实模型/runtime 和 HTTP Backend。每个场景的会话有独立的 Store、derived cache 和配置目录；只复用原生资源与调度，不共享语料或配置状态。
- [ProjectContext 场景](../../packages/cli/integration/scenarios/project-context-native.ts)使用足够发布多个批次的语料，显式阻塞第一批成功编码后的下一批，验证 partial/strict/complete 和单条增量；初次模型准备导致的失败尝试不计作已发布批次。
- [检索方法场景](../../packages/cli/integration/scenarios/retrieval-methods-native.ts)从自己的新语料开始，覆盖真实编码的跨批次路径，不依赖 ProjectContext 场景的下载、继承或增量编辑结果。临时方法返回后与配置切回后的查询使用零等待，避免后台重建掩盖 artifact 复用回归。

第三个参数可选 `all`、`project-context` 或 `retrieval-methods`。例如只运行检索方法场景：

```sh
bun run test:native-smoke -- /absolute/path/to/granite-q4_0.gguf retrieval-methods
```

观测值按场景区分：`projectContextDocumentBatches` 和 `methodDocumentBatches` 分别记录各自的文档编码调用次数；`documentBatches` 是整个运行的总调用次数，包括模型尚未就绪时的失败尝试。`initialDocumentEmbedding` 与 `incrementalDocumentEmbedding` 只统计 ProjectContext 的对应阶段，不混入多视角编码。

## 冻结参考回归

HTTP 脚本可额外接收参考目录，包含 `q4-reference.json`、`fixtures.json`、`fp32-reference.json`：

```sh
bun packages/backend/integration/embedding.integration.ts /absolute/path/to/granite-q4_0.gguf /absolute/path/to/reference-directory
```

参考文件先做结构校验，再比较固定向量、Top1 和 nDCG@5。缺失 fixture ID、维度不匹配、空相关标签会明确报错。未提供参考目录时不会执行这一场景；不能将普通 HTTP 验收当作参考回归通过。

## 如何读输出

成功行包含 `scenario` 和 `status: "passed"`。某个场景通过不代表后续场景已完成，应同时检查脚本退出码。失败由断言及其命名函数定位。

耗时、吞吐和 RSS 放在 `observations` 中，代表本次机器上的采样，没有性能通过阈值。settings 各档线程数不同，不能据此宣称缩放效率；`statusWhileBusyMs` 在受控编码阻塞下观测，也不能当作真实高负载延迟指标。

当前这些真实模型验收依赖 macOS arm64 native，RSS 采样使用 macOS `ps`，故障注入使用 POSIX 信号；不以这组结果宣称 Windows 支持。脚本的临时运行目录和下载缓存会清理，用户模型与参考文件只读。
