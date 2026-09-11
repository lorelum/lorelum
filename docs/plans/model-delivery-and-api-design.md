# 默认模型交付、加载进度与接口文档

状态：本阶段设计，2026-09-11。用户已授权本地规划与实施；提交、发布和资源托管仍按仓库流程处理。本文承接 [第二阶段 backend 设计](local-backend-stage-2-design.md)，只调整默认模型交付、CPU 配置、加载合同和文档组织。

本阶段让 `lore model load` 在缺少默认模型时取得文件，持续显示进度，网络中断后保留已下载内容。控制 API 接受加载后立即返回，CLI 等待最终结果；下载时间不消耗 native 启动预算。384 维、CLS pooling、L2 normalization 和固定 Q4_0 身份保持不变。GPU、semantic index/query 接入、Windows 支持和模型自动更新不在本阶段。

## 现状与交付前提

当前 `embedding/service.ts` 统一拥有模型状态与共享加载任务；`runtime/embedding-process.ts` 校验资源后启动受管 native 子进程。`model/load` HTTP 请求和 CLI 都等待加载完成，默认启动预算为 10 秒。配置只接受绝对 `modelPath`；未配置时报错。native 固定 4 线程、512 tokens，token 上限参与 `encodingId`。现有测试覆盖并发加载、加载中卸载及失败后的资源所有权。

固定模型在 `native/embedding/build-config.json` 中只有文件名、大小和摘要：66,345,216 bytes，SHA-256 `18e8ce8ce834790618e90d26bed465cca87362076f3042eb0d8eee0732596f59`。它是本地生成的 Q4_0 文件，当前 manifest 没有可下载 URL。不能把同名上游 GGUF 当作相同资源。

**Required input：**取得与上述大小和 SHA-256 完全一致、可稳定访问并支持 Range 的模型来源。允许通过 `download.url` 配置该固定文件的 HTTPS 镜像，但目前没有可写入代码的默认 URL；缺失时返回 `embedding.download-unavailable`。默认来源仍待用户提供托管地址或授权发布位置，不擅自上传模型。来源确定前可完成下载器、接口与故障测试，但不能宣称默认自动下载端到端交付完成。若只能取得不同文件，须重新验证模型及更新固定身份，不能静默替换。下载来源与 native executable 来源分别管理，不能让模型 config 选择可执行程序。

## 责任与最小边界

保持现有 controller → service → runtime 分层。service 是状态、共享任务和取消的唯一所有者；模型文件准备负责受信来源、缓存和完整性；下载适配器负责成熟传输工具的调用及进度转换；native runtime 只接收已准备的路径和 CPU 参数。

```ts
interface ModelProgress {
  phase: "resolving" | "downloading" | "verifying" | "starting";
  downloadedBytes?: number;
  totalBytes?: number;
}
interface ModelPreparation {
  ensure(signal: AbortSignal, progress: (value: ModelProgress) => void): Promise<string>;
}
// service 内部 load 仍返回共享完成 Promise；HTTP 通过 beginLoad 接受任务。
interface ModelLoading {
  beginLoad(): ModelStatus;
  load(): Promise<ModelStatus>;
  status(): ModelStatus;
  unload(deadline?: number): Promise<ModelStatus>;
}
```

`ModelStatus` 保留现有 state/device/dimensions/error，增加实际 `threads`、`maxTokens` 和可选 `progress`。`encodingId` 根据生效的 token 上限生成；线程和下载策略不影响编码身份。状态只返回数值进度及允许的错误码，不包含下载凭据、URL 查询参数、私有端口或本机路径。status 不扫描或哈希模型文件。

按已批准的一个默认模型范围实现具体准备模块，不新增下载任务数据库、插件体系或通用作业平台。HTTP、CLI 复用同一个 service，不各自维护一份下载任务。

## 下载、恢复与超时

优先复用成熟下载工具承担 HTTP/Range 与中断恢复。当前 Mac 范围选择系统 `/usr/bin/curl`，适配集中在 `download/curl.ts`；不新增第三方运行依赖。使用 `-q` 禁止读取 curlrc，限制 HTTPS 及 HTTPS 重定向，按 `.part` 实际长度续传；连接超时 30 秒、`speed-time=60/speed-limit=1`，不传 `max-time`。Lorelum 只保留固定资源身份、落盘、状态和取消适配。直接手写 HTTP 下载器会增加 Range、重定向和连接故障处理负担，本阶段不优先采用。

未显式指定 `modelPath` 时，在独立于 Store 和运行目录的 `cacheDirectory`（默认 `~/.lorelum/models`）中按摘要定位资源。已有完整文件验证通过便复用；显式 `modelPath` 继续表示用户管理的固定模型，只校验，不覆盖或自动下载到该路径。`model status`、`model unload` 和 backend 启动都不触发下载；网络操作只由显式 model load 开始。

下载写入最终文件旁的 `.part`，失败和取消保留可继续使用的数据。完成后先验证大小与 SHA-256，再原子改名；未验证文件不能进入 native。来源变更、远端不支持 Range、偏移不匹配、完整性失败应给出明确错误，禁止自动丢弃已有部分文件并从零重试。损坏部分文件与普通断网不同，文档说明需要显式清理后重新下载。

重试只针对短暂网络故障，默认最多尝试 3 次并有界等待；每次尝试从 `.part` 的实际字节数继续。部分文件跨 load 和 daemon 重启保留。永久 HTTP 错误、权限失败、空间不足和摘要不匹配不循环重试。不要把“有重试参数”等同于已经证明可续传，须用断开连接后的 Range 请求与最终摘要验收。

不设置整个下载的总时限。连接建立无响应受 `connectTimeoutSeconds` 限制；连接建立后持续没有字节增长受 `stallTimeoutSeconds` 限制；有进度的慢下载可持续运行。native 的 `startupTimeoutMs` 从文件准备成功后才开始；推理与卸载继续使用各自现有预算。CLI 的每次状态请求有普通请求超时，轮询等待不设下载总时限。

## HTTP、CLI 与取消合同

| 入口 | 行为 |
| --- | --- |
| `POST /internal/v1/model/load`，`{}` | 接受或加入当前加载任务，立即返回 202 和 ModelStatus；已经 ready 返回 200；unloading 返回 busy |
| `GET /internal/v1/model/status` | 返回当前状态和阶段进度；不触发模型工作 |
| `POST /internal/v1/model/unload`，`{}` | 取消文件准备或 native 启动，等待实际资源退出；成功返回 unloaded |
| `POST /internal/v1/embeddings` | 保持请求格式；用实际 maxTokens 校验全部输入，超限拒绝，不截断 |
| `lore model load` | 发起加载后轮询，直到 ready、failed 或被卸载；stdout 仅最终 JSON envelope，进度写 stderr |
| `lore model status/unload` | 保持只读查询/显式卸载语义，复用 HTTP 状态合同 |

HTTP 202 只表示接受，不表示模型已可编码。下载失败通过状态的 `failed/error` 表达；CLI 将它转换为现有失败 envelope 和非零退出。轮询中看到 unloaded 表示任务被显式取消，不得报告 load 成功。HTTP 客户端断开、CLI 停止等待不自动取消共享后台任务；`model unload` 是明确取消入口。

业务状态仍为 `unloaded/loading/ready/unloading/failed`，phase 只是 loading 的细分。重复 load 加入同一任务，不启动第二个下载。unload 先改为 unloading 并 abort，确认准备任务和自建进程结束后才能 unloaded；过期进度或完成回调不能覆盖新状态。清理失败时保持 failed 和资源所有权，阻止新 load。backend stop 复用相同卸载路径与同一 shutdown deadline。

异步 load、status 字段和动态编码身份影响严格客户端校验，因此控制和业务协议同步从 2 升至 3，路由前缀暂保留 `/internal/v1`。旧 CLI 先停旧 daemon，再安装并启动新版本；不能假定新客户端可接管旧实例。同步更新 DTO、client、CLI discovery schema 和错误映射，覆盖新旧版本拒绝行为。

## Config 与 CPU 验证

共享 YAML 的 `embedding` 配置仍在 backend 启动时解析一次，形成不可变快照；运行模块不再次读取 YAML 或环境变量，修改后重启生效。允许省略整个 embedding section 并使用默认配置，保留显式 `modelPath` 兼容路径。

| 配置 | 约束与用途 |
| --- | --- |
| `modelPath` | 可选绝对路径；提供时使用用户管理文件 |
| `cacheDirectory` | 默认 `~/.lorelum/models`；显式配置必须为绝对路径 |
| `threads` | 1–64 的整数，默认 4；同时设置 native `-t/-tb` |
| `maxTokens` | 512/1024/2048，默认 512，包含特殊 token；1024/2048 必须通过本阶段实测 |
| `download.enabled` | 默认 true；false 时缺失文件明确报错，不联网 |
| `download.url` | 可选 HTTPS 镜像，只能交付固定摘要资源；暂没有默认来源 |
| `download.connectTimeoutSeconds` | 默认 30；连接无响应的超时 |
| `download.stallTimeoutSeconds` | 默认 60；低于 1 byte/s 的持续时间 |
| `download.maxAttempts` | 默认 3；有限重试次数，不提供下载总超时 |

`maxTokens` 同时用于 tokenizer 准入及 native `-c/-b/-ub`，不能只放宽输入检查。实际模型与正式 native 构建验证 1024、2048 附近的输入，记录成功/拒绝、向量维度与范数、耗时和 RSS。上限加大不代表吞吐或质量提升；仅据实测开放配置，不据模型宣传的最大上下文推断。不同 maxTokens 产生不同 encodingId，避免未来 index 混用；本阶段不创建 index。

## 文档目录与实施验收

按读者任务和稳定业务领域拆分，目录 README 只索引与说明共同规则，避免所有未来命令或 endpoint 累积在一个长文件。

| 位置 | 内容 |
| --- | --- |
| `docs/api/README.md` | API 范围、认证与版本约定、领域索引 |
| `docs/api/backend.md` | identity/status/stop 合同、状态和通用错误 |
| `docs/api/embedding.md` | load/status/unload/embeddings、202 轮询、进度、取消和错误 |
| `docs/cli/README.md` | CLI discovery、envelope、退出码和命令组索引 |
| `docs/cli/backend.md`、`model.md` | 各命令参数、前置条件、示例、输出与失败处理 |
| `docs/configuration/README.md` | 配置位置、优先级、生效时机和领域索引 |
| `docs/configuration/backend.md`、`embedding.md` | 对应 schema 的字段、默认值、范围和生命周期 |

API 文档不复制 CLI 参数表；CLI 文档链接配置说明；开发指南只保留入口和开发专用步骤。新增领域时增加对应页面，文档目录无需先建立尚未实现命令的占位页。

实施先落配置与文件准备边界，再接 service 进度和 HTTP/client/CLI，最后同步文档与真实资源验证。每步都在本阶段范围内；来源缺口只阻塞生产默认下载验收。

验收覆盖：完整缓存复用、缺失下载、连接失败、慢但持续有进度、停滞、断线续传、Range 不兼容、错误摘要、权限/磁盘失败、取消后续传、重复 load、backend stop、旧回调隔离与失败所有权。用本地测试服务器和临时目录模拟网络，单元测试不访问真实 registry。另用固定真实模型验证完整下载及 512/1024/2048 CPU 编码，记录未验证范围。

完成标准是用户在受支持 Mac 环境从缺失默认模型走到 ready，有可见进度且中断后恢复；所有相关测试、typecheck、lint 和文档合同检查通过。没有稳定模型来源或真实下载证据时，明确报告准备能力已实现而默认资源交付仍待完成，不把 fixture 测试当作生产分发成功。

## 本地实施结果

- 配置、HTTP 202 加载、status 进度、CLI 轮询和 stderr 进度已实现。CLI 的 model 命令归 `packages/cli/src/model/`；backend 仍按 config、modules/embedding、models、download、runtime 分工。
- curl 承担传输和 Range；复用 SQLite 锁串行准备文件。下载 guardian 在原子持久化进程身份后才接收启动许可；崩溃恢复先等待旧 writer 退出，避免 daemon 的锁释放早于 curl 停止造成双写。取消时由 guardian 回收 curl，准备任务在确认退出前不结算，卸载仍受 service 的 deadline 约束。
- 本机真实 66,345,216-byte Q4_0 文件在传输 1 MiB 后断开，第二次请求从该位置续传；大小、SHA、缓存复用和下载后 native 编码均通过。该实验使用本地服务器，不代表公开下载源已交付。
- 512/1024/2048 三档的 token 上限及上限加一、384 维和 L2 校验通过。M4 本机每档 5 条计时样本：512/4 threads 平均 55.70 ms、RSS 581.4 MiB；1024/2 threads 平均 204.75 ms、RSS 936.1 MiB；2048/4 threads 平均 354.18 ms、RSS 1666.7 MiB。线程数不同、样本小，不能据此比较缩放效率或承诺 SLA；默认仍为 512。
- 编译 CLI 在隔离 HOME、含空格安装目录和精简 PATH 下验证了进度、1024-token 配置、HTTP 编码、损坏 YAML 时卸载与正常停止。
- **尚缺默认模型稳定 HTTPS 来源**，因此没有启用虚构的默认 URL，也没有上传模型。配置 `download.url` 可使用固定摘要的托管文件；来源确定后仍需执行一次真实 HTTPS 下载验收。

## 首次使用的配置初始化

用户进一步要求空 HOME 安装后无需手动创建配置。`shared/config` 统一解析 `.lorelum`、config.yaml、backend 运行目录和模型缓存目录，提供独立的幂等初始化入口；普通读取仍不写文件。backend config 负责提供自己拥有的默认字段，CLI 只在显式 `backend start` 时请求初始化，不在 help、describe、status、stop 或 model status 中创建配置。

初始化只处理不存在的配置文件，写入可编辑的 backend/embedding 默认值，不固化机器绝对路径、不填写未知下载地址。先写同目录临时文件并同步，再以不覆盖目标的方式发布；并发启动只有一个创建者。已有配置的字节、注释、其他模块字段和权限保持不变；损坏配置继续明确报错，不以默认配置覆盖。文件创建为 0600，新目录为 0700，模型缓存仍在首次实际使用时创建。

这项初始化解决目录与配置生命周期，不能代替 native 资源安装或提供不存在的模型托管地址。PR 要分别记录空 HOME 的已验证体验、已有配置的兼容性，以及默认模型来源尚未交付的事实。

初始化已通过空 HOME 编译 CLI 验收：帮助/发现/status/stop 不创建 `.lorelum`；start 创建 0600 配置及默认值；重复 start、stop 保留文件；用户注释和其他模块配置不变；缺下载源明确报错；配置模型路径后能加载 1024-token 模型。全量 597 项测试、typecheck、lint 和编译通过。
