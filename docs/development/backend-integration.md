# Backend integration 验收

这些脚本验证真实 native 模型、HTTP 和进程生命周期；普通 `bun test` 不会下载模型或启动这些验收。backend 的 `typecheck` 会检查 integration 代码。

先按 [native 构建说明](../../native/embedding/README.md)准备匹配的 native 资源，并提供固定 Q4_0 模型的绝对路径。以下命令从仓库根目录执行，模型路径请替换为实际文件。脚本按顺序运行，避免不同验收同时占用 CPU，影响观测数据。

```sh
bun packages/backend/integration/embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
bun packages/backend/integration/daemon-embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
bun packages/backend/integration/model-download.integration.ts /absolute/path/to/granite-q4_0.gguf
```

| 入口 | Review 时关注的场景 |
| --- | --- |
| `embedding.integration.ts` | HTTP 认证调用、占用编码槽时的控制响应与 busy 拒绝、重复加载/卸载 |
| `daemon-embedding.integration.ts` | 常驻进程复用、native 无响应回收、native 崩溃、daemon 崩溃后的子进程回收和重启 |
| `model-download.integration.ts` | 本地传输在 1 MiB 后断开，按真实落盘偏移续传，校验后编码并复用缓存 |

每个入口先组装环境，再调用命名场景，最后清理自己拥有的资源。`integration/support/` 只放重复的 native fixture、进程等待/RSS 采样、断流服务器和冻结参考比较，不包含业务实现。

busy 场景通过编码入口的显式同步点占住请求，不依靠 sleep 猜测推理耗时；daemon 无响应场景暂停本次启动的 native 进程，让请求确定超时，再确认实际进程退出。这些是故障注入，不是性能测量。daemon 端口仍由现有 supervisor 合同决定，端口竞争会明确失败，不会改绑未知服务。

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
