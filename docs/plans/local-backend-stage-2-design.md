# 本地后端第二阶段：llama.cpp Q4_0 CPU 常驻接入

状态：**Owner 已授权实施；macOS arm64 首批接入已实现，Windows 与最终跨平台交付尚未完成。** 用户确定使用 llama.cpp + Granite 97M R2 Q4_0 CPU，框架与量化调研结束；GPU 后续单独考虑。Mac 首批实施关联 #101，使用一个 PR，不拆成依赖 PR。

后续调整：Owner 已授权[默认模型交付与 API 文档](./model-delivery-and-api-design.md)，新增可恢复下载、进度与 CPU 参数配置；以下固定参数和不下载约定保留为上一批实现的历史范围。

## 交付目标与边界

用户显式启动 backend、加载模型后，多个编码请求复用同一模型进程，并可查看状态、卸载模型。控制服务固定为 `127.0.0.1:26186`，推理期间仍能响应 status；模型失败不导致 keyword Query 和控制服务失效。

本阶段交付模型常驻、认证编码入口、CLI 控制及可分发运行资源。semantic index、把 `lore query` 接到 semantic、默认查询模式切换、GPU、多模型池、自动下载、登录自启和自动加载均留在后续。不会同时保留 ONNX/Python 运行路线或新增通用 provider 框架。

已有代码是 Bun/Elysia + Zod；`backend.start/status/stop` 和 keyword HTTP 已存在，`backend.status.model` 目前严格为 `unloaded`。共享 YAML 已实现，但 daemon 的进程身份、私有目录检查仍依赖 POSIX，Windows 需要在本阶段补齐并实际验收。

## 固定资源与配置

采用已测产物，完整证据见 [CPU 验证](../research/llama-cpu-validation.md)：

| 项目 | 固定值 |
| --- | --- |
| 源模型 | `ibm-granite/granite-embedding-97m-multilingual-r2`，revision `835ad14087e140460703cf0fae09f97d469d65c2` |
| GGUF | Q4_0，66,345,216 bytes，SHA-256 `18e8ce8ce834790618e90d26bed465cca87362076f3042eb0d8eee0732596f59` |
| 量化来源 | 已校验 F16 GGUF；`--pure --token-embedding-type q4_0 ... Q4_0 4`，不再次量化 Q8/Q4 文件 |
| native 基线 | llama.cpp `b10901`，commit `28ff0958291ce3465fabd7bd679d4b0edd742bd9`；生命周期补丁另记 build 身份 |
| 编码 | GGUF 内置 tokenizer；384 维；CLS + L2；query/document 均无额外前缀，保留原文 |
| CPU 设置 | `--device none --no-op-offload -ngl 0`，threads/threads-batch=4，context/batch/ubatch=2048，parallel=1 |

`~/.lorelum/config.yaml` 只增加当前需要的模型路径：

```yaml
embedding:
  modelPath: /absolute/path/to/granite-q4_0.gguf
```

`@lorelum/config` 提供只读的共享 YAML 读取入口；backend config 校验自己负责的段并产出不可变快照。`modelPath` 必须为绝对路径；不开放模型名、量化选择、endpoint、端口、GPU、可执行文件或任意 native 参数。缺少 embedding 段不妨碍 backend 启动，`model load` 才返回未配置错误。

启动控制端只读一次 YAML，将有界 embedding 配置与现有 settings 一同传入 daemon；daemon、service 和 native client 不再次读取文件或 `process.env`。快照沿现有私有启动记录传递，embedding 快照序列化后最多 2048 bytes，完整记录继续遵守 4096-byte 上限；修改配置后重启 backend 生效。共享 YAML 仍受 16 KiB 上限约束。

native 程序与配套库来自安装目录中的受信 manifest，按 OS/架构解析，不从 PATH、用户配置或 Store 查找。manifest 固定资源摘要、native build 和 GGUF 身份；`load` 前校验文件类型、大小及摘要，读写过程中资源改变则失败，不能只相信文件名。status 不读取或哈希模型文件。

从模型源 revision、GGUF 摘要、编码实现版本、CLS/L2 和无前缀规则生成固定 `encodingId`。它不包含机器路径、端口或 PID；未来 index 必须绑定它，不能混用旧 FP32/Q8 向量。本阶段只返回编码身份，不创建 profile/index 配置。native 固定以 2048 context 初始化，但 Lorelum 不将其作为配置或输入上限。

## 分层与调用合同

所有文件按 feature 或运行职责归组，`index.ts` 只做导出。配置校验、HTTP DTO、业务状态和 native 细节分别有明确归属：

| 文件位置 | 唯一职责 |
| --- | --- |
| `packages/backend/src/config/embedding.ts` | embedding 配置 schema、纯解析及快照类型；共享文件读取仍走既有 loader |
| `packages/backend/src/modules/embedding/dto.ts` | Zod 请求/响应 schema，包括 CLI 复用的状态合同 |
| `packages/backend/src/modules/embedding/model.ts`、`errors.ts` | 模型状态、编码身份与 typed error；无 HTTP/进程代码 |
| `packages/backend/src/modules/embedding/controller.ts` | 复用认证边界，解析 DTO、调用 service、转换可见错误 |
| `packages/backend/src/modules/embedding/service.ts` | 唯一拥有状态、共享 load 任务、准入和在途计数 |
| `packages/backend/src/runtime/embedding-process.ts` | 受信资源、spawn、私有端点、子进程身份与终止；不再拥有第二套业务状态机 |
| `packages/backend/src/runtime/llama-client.ts` | 有界 native HTTP、tokenize、embedding 返回校验；不读取 config、不决定重启 |
| `packages/cli/src/backend/model-commands.ts` | CLI registry、JSON envelope 和错误映射；不操作模型句柄 |

内部 service 保持普通数据合同，实际状态 schema 由 dto/model 定义；不用 Elysia Context 或 ChildProcess 穿透业务入口：

```ts
interface EmbeddingService {
  status(): ModelStatus;
  load(): Promise<ModelStatus>;
  unload(): Promise<ModelStatus>;
  embed(kind: "query" | "document", inputs: readonly string[]): Promise<EmbeddingResult>;
}
interface EmbeddingResult {
  readonly encodingId: string;
  readonly vectors: readonly (readonly number[])[];
}
```

`app.ts` 继续做组合：创建 service 后注入 embedding controller；现有 backend service 的 stop 回调负责串接模型卸载和 HTTP 关闭。后端 client 增加对应方法，仍是 fetch-only 边界，不能把 server/native 依赖带入 CLI。

| Lorelum 认证入口 | 行为 |
| --- | --- |
| `POST /internal/v1/model/load`，body `{}` | 显式加载并等待 ready；返回 ModelStatus |
| `GET /internal/v1/model/status` | 只读，不启动 backend 或模型 |
| `POST /internal/v1/model/unload`，body `{}` | 停止准入并等待实际进程退出后返回状态 |
| `POST /internal/v1/embeddings` | body `{ kind, inputs }`；返回 `{ encodingId, vectors }` |

每次最多 8 条输入，每条必须非空；Lorelum 不按 token 数配置或拒绝输入，也不 trim 或静默截断。先持有唯一准入名额，再按统一 native tokenizer/编码路径处理全部文本。8 条文本在当前 single-slot 配置下顺序执行，这是服务合同，不宣称真正模型 batching。

公共请求维持 64 KiB、响应维持 256 KiB 上限。所有流式读取、解析和 native 响应均有截止时间及大小限制；向量验证数量、index 唯一完整、384 维、有限值和 L2 范数，不把 native 任意 JSON 转发给调用方。

## 私有进程、认证与生命周期

Elysia 只管理一个自建 llama-server 子进程，通过私有 IPv4 loopback HTTP 调用它；原生端点不对 CLI 或 Engine 暴露。端口不是公共配置：启动时申请临时端口，native 绑定失败最多重试 3 次且共用 startup 总预算，不扫描/复用已有服务。保留端口后再启动存在竞争，因此不能把端口预检查当成绑定成功。

每次 spawn 生成独立随机 native 凭证，经私有子进程环境传入；只把白名单平台变量、固定 CPU 参数和本次凭证交给 child，不继承用户 `LLAMA_*`、模型仓库配置或代理。HTTP 固定 loopback、禁代理和重定向。确认自建 child 成功绑定、仍存活，并完成认证请求与固定编码探针后才 ready；陌生服务的 health 200 不构成身份或 readiness 证据。

native 日志只进入有界诊断通道，禁止记录原始输入、向量、凭证或完整本机路径；native 错误栈转换为固定错误码。私有运行记录按现有安全规则保存 daemon instanceId、子进程身份和 native build，供清理使用，不保存用户文本或 native 凭证。旧模型进程不能被新 daemon 自动接管。

状态为 `unloaded/loading/ready/unloading/failed`。重复 load 共享同一任务，ready 时幂等；unloading 时 load 返回 busy。loading 时 unload 取消启动并回收对应 child，用操作代次避免过期启动结果覆盖新状态。只允许一个编码请求在途，额外请求返回 busy，不建立无界队列或自动重启循环。

unload 先关闭准入，再等真实在途计算结束，随后终止 child 并确认退出。从关闭准入开始共享 shutdown 总预算，到期强制终止自己创建且身份仍匹配的进程；未确认退出就保持 failed，不能返回 unloaded 或再次 load。HTTP 取消/超时不等于 native 已停算：一旦编码已提交又失去结果，转 failed 并回收 child，确认退出后才允许用户重新 load。

backend stop 将相同 deadline 传给模型卸载和 HTTP 关闭，不分别重新获得一份完整超时预算。模型崩溃拒绝当前请求、转 failed，控制服务继续可用。禁止按端口或进程名杀进程；陈旧记录只在身份核对后清理，PID 复用不得伤及其他进程。

**daemon 异常退出时的自动回收是实施任务，不是已有能力。** 普通 child、`detached:false` 或 SIGTERM 回调不能覆盖父进程 SIGKILL。固定 native 构建增加最小父进程存活管道支持：独立线程在模型加载前开始监听继承的只读管道，EOF 时直接退出本 native 进程，不等待推理线程或普通清理锁；daemon 独占写端并保持到 child 已退出。正常 unload 仍走终止/等待流程。

这项支持以固定 llama.cpp 源码上的小范围补丁交付，不新增常驻 Bun guardian 或通用进程平台；补丁、构建参数和依赖必须进入 native build 身份。首个实施任务证明父进程在启动中或编码中被强制终止、native 编码不响应时仍会退出；之前官方二进制的正常退出实验不能代替该验收。最终补丁构建须重跑 tokenizer、Q4_0 向量和资源回归，不能沿用原归档 SHA 宣称已验证。

## CLI 与分发

新增 `lore model load/status/unload`，沿用现有命令 registry、发现 schema、单行 JSON envelope 和错误退出约定。三个命令都不隐式启动 backend；用户先执行 `lore backend start`。backend 未运行时返回 `backend.unavailable`，status/unload 不创建运行目录。命令不依赖 LocalStore，`--store-root` 不改变模型来源。

`ModelStatus` 给出状态、固定 encodingId、CPU/384 维等必要信息；失败只返回允许的错误码，不输出私有端口、PID、路径或凭证。`backend.status.model` 扩为模型状态枚举，保持 backend 状态与模型状态分开；模型失败时 backend 仍可 ready。固定新增错误涵盖未配置、资源不匹配、未加载、busy、输入超限、执行超时和 native 失败，CLI/HTTP/client 使用同一映射。

CLI、BackendClient、DTO 和 discovery schema 按最终合同一起实现。当前尚未发布 release，内部协议统一为 version 1，不维护开发中间版本兼容或设计升级流程；所有请求一致校验实例、build 和协议。

安装资源采用 CLI/控制服务加平台 native 目录的布局；native 程序、库、许可证和 manifest 配套，GGUF 外置且由显式路径引用。构建可复现地取得固定资源，开发/验收无需把用户数据送出；模型下载器、资源自动更新器不在本阶段。接入允许新增必要的构建脚本，release/publish workflow 的变更仍遵守仓库单独授权边界。

Windows 任务同时处理现有 `processIdentity` 的 ps 依赖、POSIX uid/mode 与 Windows 私有 ACL/当前用户校验的差异、平台环境白名单的 SystemRoot/WINDIR/TEMP/TMP，以及管道/终止语义。只在已有进程/私有文件边界增加平台实现，不放松权限检查来绕过测试。Mac 和 Windows 都按完整 backend→native 链路验收；缺 Windows 运行环境只阻塞 Windows 验收，不阻塞独立 Mac 工作，也不能宣布跨平台交付完成。Linux 及其他架构另列后续支持范围。

## 实施任务与验收

以下为本阶段完整验收范围，前置失败只暂停依赖步骤，不重开框架选型。当前进展见本节后的实施记录；不能将 Mac 首批通过等同于全部任务完成。

| Task | 交付内容 | 完成标准 |
| --- | --- | --- |
| T1 固定 native 与退出保证 | Q4_0 manifest、固定 CPU native 构建、父进程存活管道补丁 | CPU-only、父进程在加载/编码中强制退出、native 不响应时的回收；补丁构建数值回归通过，资源 hash 可复核 |
| T2 config 与模型进程 | 配置快照、受信资源解析、私有端点与认证、service 状态和准入 | 缺配置/错资源/端口竞争、并发 load、加载中 unload、崩溃/超时和 PID 复用；失败后可显式重试且无遗留进程 |
| T3 编码入口与分层 | DTO、controller/service/native client、统一编码与向量校验 | 空白、特殊 token、多条排序、超大/损坏响应；推理期间控制接口响应；无隐式截断或代理请求 |
| T4 CLI 与协议 | model 命令、BackendClient、状态 schema/发现输出、错误与调用说明 | 不启动型命令无副作用；错误实例、build 和协议均拒绝请求；keyword 和 Store resolver 行为保持 |
| T5 平台与分发 | Mac/Windows native 资源、进程身份和私有文件平台实现、安装布局 | 无关 cwd/精简 PATH、含空格路径、缺库/错架构/错版本、权限拒绝；两个系统完整链路实测，未测试平台不标支持 |
| T6 交付验收 | 正式产物端到端、文档、Issue checklist 和一个 PR | 连续加载/编码/卸载及失败恢复，无残留；固定样本复测、性能与 RSS 抽样、控制响应；相关测试/lint/typecheck 通过 |

单元测试 mock 文件/网络/native 进程；真实进程与模型只在显式集成验证中运行，使用隔离运行目录，不使用用户 Store。保留有行为价值的并发、超时和跨进程测试，不为每层转发机械补测试。

现有 M4 Q4_0 约 21 条/秒、负载后 626–627 MiB 只是回归参考；正式 native 补丁与 Elysia 接入后重新采样，不能把这组数字写成所有平台 SLA。模型质量的大规模评测留在既有后续任务，不重新成为框架选型阶段。

完成本阶段后，用户得到可显式管理、可重复编码、可正常和异常回收的 CPU 模型服务。下一阶段再让 semantic index/query 消费此编码入口；GPU 不进入本阶段依赖或验收。

## 2026-09-11 实施记录

- T1–T4 的 Mac 路径已落地：固定 CPU native 构建与父进程管道，config 快照，分层 embedding 模块，私有认证连接，model CLI 与协议版本 2。
- 资源加载会核对受信 manifest、文件大小和 SHA-256；加载期间及编码前后检查文件是否被替换或修改。private runtime record 记录模型子进程身份和 native build，不保存 native 凭证。
- 私有连接增加每次启动独立的 model alias；它只传给自建 native，客户端核对响应中的 alias，不将它写进编码请求，避免仅以通用健康响应认领服务。
- Mac 真进程验证覆盖复用、超时回收、模型崩溃后显式重载、daemon SIGKILL 后回收、干净重启；独立 native 测试覆盖加载前、编码期间和主线程永久阻塞时的父进程死亡。
- 编译版 CLI 已在包含空格的迁移目录、精简 PATH 下实际加载/卸载；backend 不在时 model status 不创建运行目录；daemon 运行中 YAML 被改坏时 model unload 仍使用既有快照完成卸载。
- T5 **未完成**：当前只打包并选择 macOS arm64 资源。Windows 的 native 构建、进程身份/私有 ACL 实现和整链路验收仍缺少 Windows 运行环境；环境变量白名单已准备，但不能因此声明 Windows 支持。Linux/其他架构仍不在本阶段。
- T6 已完成本地 Mac 验证；验证命令和 CR 结论记录在实施 PR。Windows 与正式分发验收仍未完成，未发布或修改 release workflow。
