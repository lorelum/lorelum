# 默认模型交付、加载进度与接口文档

状态：本阶段设计，2026-09-11。用户已授权本地规划与实施；提交、发布和资源托管仍按仓库流程处理。本文承接 [第二阶段 backend 设计](local-backend-stage-2-design.md)，只调整默认模型交付、CPU 配置、加载合同和文档组织。

本阶段让 `lore model load` 在缺少默认模型时取得文件，持续显示进度，网络中断后保留已下载内容。控制 API 接受加载后立即返回，CLI 等待最终结果；下载时间不消耗 native 启动预算。384 维、CLS pooling、L2 normalization 和固定 Q4_0 身份保持不变。GPU、semantic index/query 接入、Windows 支持和模型自动更新不在本阶段。

## 现状与交付前提

当前 `embedding/service.ts` 统一拥有模型状态与共享加载任务；`runtime/embedding-process.ts` 校验资源后启动受管 native 子进程。`model/load` HTTP 请求和 CLI 都等待加载完成，默认启动预算为 10 秒。配置只接受绝对 `modelPath`；未配置时报错。native 默认 4 线程并以固定 2048 context 初始化；该运行时参数不暴露为 Lorelum 配置、状态字段或输入限制，也不参与 `encodingId`。现有测试覆盖并发加载、加载中卸载及失败后的资源所有权。

固定模型在 `native/embedding/build-config.json` 中只有文件名、大小和摘要：66,345,216 bytes，SHA-256 `18e8ce8ce834790618e90d26bed465cca87362076f3042eb0d8eee0732596f59`。它是本地生成的 Q4_0 文件，现已按 Owner 授权发布到 Lorelum 的 Hugging Face 组织。不能把同名上游 GGUF 当作相同资源。

**默认来源：**`Lorelum/granite-embedding-97m-multilingual-r2-GGUF`，固定 revision `7a8af1473a747268bbb3968b77d5b822a6506667`，文件 `granite-q4_0.gguf`。config 内置该 commit 的 HTTPS resolve 地址，允许 `download.url` 覆盖为交付相同大小、摘要且支持 Range 的镜像。已匿名完整下载验证与本地文件一致。下载来源与 native executable 来源分别管理，模型 config 不能选择可执行程序。

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

`ModelStatus` 保留现有 state/device/dimensions/error，增加实际 `threads` 和可选 `progress`。`encodingId` 绑定固定模型、实现和编码规则；线程、native 初始化参数和下载策略不影响编码身份。状态只返回数值进度及允许的错误码，不包含下载凭据、URL 查询参数、私有端口或本机路径。status 不扫描或哈希模型文件。

按已批准的一个默认模型范围实现具体准备模块，不新增下载任务数据库、插件体系或通用作业平台。HTTP、CLI 复用同一个 service，不各自维护一份下载任务。

## 下载、恢复与超时

下载使用 `got` npm 包，适配集中在 `download/file.ts`，不依赖系统 curl、shell 或下载子进程。got 负责 HTTP、重定向和分阶段连接超时；Lorelum 在写入前验证状态、Content-Range 和固定大小，按 `.part` 实际落盘长度续传。每次尝试在 pipeline 完全关闭后才能重试或结束取消，默认仅允许 HTTPS 及 HTTPS 重定向，禁用解压以保持模型字节身份。连接阶段默认 30 秒，连续 60 秒没有收到文件字节触发停滞；有进展的下载没有总时限。

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
| `POST /internal/v1/embeddings` | 保持请求格式；按统一 tokenizer/native 编码路径处理全部输入，不按 token 数拒绝或截断 |
| `lore model load` | 发起加载后轮询，直到 ready、failed 或被卸载；stdout 仅最终 JSON envelope，进度写 stderr |
| `lore model status/unload` | 保持只读查询/显式卸载语义，复用 HTTP 状态合同 |

HTTP 202 只表示接受，不表示模型已可编码。下载失败通过状态的 `failed/error` 表达；CLI 将它转换为现有失败 envelope 和非零退出。轮询中看到 unloaded 表示任务被显式取消，不得报告 load 成功。HTTP 客户端断开、CLI 停止等待不自动取消共享后台任务；`model unload` 是明确取消入口。

业务状态仍为 `unloaded/loading/ready/unloading/failed`，phase 只是 loading 的细分。重复 load 加入同一任务，不启动第二个下载。unload 先改为 unloading 并 abort，确认准备任务和自建进程结束后才能 unloaded；过期进度或完成回调不能覆盖新状态。清理失败时保持 failed 和资源所有权，阻止新 load。backend stop 复用相同卸载路径与同一 shutdown deadline。

异步 load、status 字段和动态编码身份按最终合同同步更新 DTO、client、CLI discovery schema 和错误映射。当前尚未发布 release，内部协议统一为 version 1，与 `/internal/v1` 路由一致，不将开发中间实现视作需要兼容的历史版本。身份、build 和协议校验对所有请求一致。

## Config 与 CPU 验证

Lorelum config 是独立于 backend 的本地基础能力，包边界和首次初始化见本文末节。共享 YAML 的 `embedding` 配置仍在 backend 启动时解析一次，形成不可变快照；运行模块不再次读取 YAML 或环境变量，修改后重启生效。允许省略整个 embedding section 并使用默认配置，允许通过显式 `modelPath` 使用用户管理的模型文件。

| 配置 | 约束与用途 |
| --- | --- |
| `modelPath` | 可选绝对路径；提供时使用用户管理文件 |
| `cacheDirectory` | 默认 `~/.lorelum/models`；显式配置必须为绝对路径 |
| `threads` | 1–64 的整数，默认 4；同时设置 native `-t/-tb` |
| `download.enabled` | 默认 true；false 时缺失文件明确报错，不联网 |
| `download.url` | 默认使用固定 revision 的 Hugging Face URL；可用相同摘要的 HTTPS 镜像覆盖 |
| `download.connectTimeoutSeconds` | 默认 30；连接无响应的超时 |
| `download.stallTimeoutSeconds` | 默认 60；低于 1 byte/s 的持续时间 |
| `download.maxAttempts` | 默认 3；有限重试次数，不提供下载总超时 |

native 固定以 2048 context 初始化；Lorelum 不暴露 token 上限配置，不按 token 数拒绝或截断输入，且该运行时参数不参与 `encodingId`。本阶段不创建 index。

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

实施先落配置与文件准备边界，再接 service 进度和 HTTP/client/CLI，最后同步文档与真实资源验证。每步都在本阶段范围内；默认来源已发布，验收使用真实 HTTPS 文件。

验收覆盖：完整缓存复用、缺失下载、连接失败、慢但持续有进度、停滞、断线续传、Range 不兼容、错误摘要、权限/磁盘失败、取消后续传、重复 load、backend stop、旧回调隔离与失败所有权。用本地测试服务器和临时目录模拟网络，单元测试不访问真实 registry。另用固定真实模型验证完整下载及 CPU 编码，记录未验证范围。

完成标准是用户在受支持 Mac 环境从缺失默认模型走到 ready，有可见进度且中断后恢复；所有相关测试、typecheck、lint 和文档合同检查通过。没有稳定模型来源或真实下载证据时，明确报告准备能力已实现而默认资源交付仍待完成，不把 fixture 测试当作生产分发成功。

## 本地实施结果

- 配置、HTTP 202 加载、status 进度、CLI 轮询和 stderr 进度已实现。CLI 的 model 命令归 `packages/cli/src/model/`；backend 仍按 config、modules/embedding、models、download、runtime 分工。
- got 在 backend 进程内传输，SQLite writer lock 串行保护准备与发布。取消时销毁 HTTP 流并等待文件 pipeline 关闭；进程崩溃后由操作系统关闭文件和 socket、释放锁，不再有独立 curl writer。下载 guardian、进程身份记录及其等待逻辑已删除。
- 本机真实 66,345,216-byte Q4_0 文件在传输 1 MiB 后断开，第二次请求从该位置续传；大小、SHA、缓存复用和下载后 native 编码均通过。该实验使用本地服务器，不代表公开下载源已交付。
- 编译 CLI 在隔离 HOME、含空格安装目录和精简 PATH 下验证了进度、HTTP 编码、损坏 YAML 时卸载与正常停止。
- **默认模型 HTTPS 来源已补齐**：Owner 授权发布到 Lorelum 组织；内置固定 commit URL，匿名完整下载后的大小与 SHA-256 一致。配置缺少 URL 时同样使用默认值；镜像覆盖和关闭下载保留。

## Lorelum config 的包边界与首次初始化

**调整前的耦合：**此前 `shared/config` 同时提供 Lorelum 根目录和 backend/runtime/model 路径，`loadBackendConfig({ initialize: true })` 还负责创建共享配置。虽然 LocalStore 已从 shared 获取根目录，初始化仍经 backend loader 触发；CLI 自己读取配置不应要求导入 backend 或连接 daemon。

**本阶段调整：**将基础能力迁到独立 workspace 包 `@lorelum/config`。它拥有 Lorelum 根路径、config 文档读取和幂等初始化，不依赖 backend、engine 或 CLI。继续复用现有 YAML 解析与原子创建实现，不新增配置注册框架；消费者自行验证各自 section，基础包只保证文档是合法、有界的映射。

| 所有者 | 责任与依赖 |
| --- | --- |
| `packages/config/src/paths/lorelum.ts` | `resolveLorelumPaths(homeDirectory?)` 仅返回 `rootDirectory` 和 `configFile`，无文件写入 |
| `packages/config/src/document/load.ts`、`packages/config/src/document/initialize.ts` | 有界 YAML 读取、ConfigError、显式幂等初始化；不解析 backend/CLI/Store 字段 |
| backend config | 从基础包读取文档，验证 backend/embedding section，导出自己拥有的初始默认值；从根目录派生 `run/backend`、`models` |
| Engine LocalStore | 直接依赖 `@lorelum/config` 获取默认根路径；不经过 backend，不读取模型配置 |
| CLI composition | 直接读取 Lorelum config，按需要解析 CLI section；组合现有模块默认值并在已确定的命令入口执行初始化 |

基础包保留以下已有能力，类型不引用业务包；`index.ts` 只导出接口：

```ts
interface LorelumPaths { readonly rootDirectory: string; readonly configFile: string; }
interface LoadConfigOptions { readonly homeDirectory?: string; readonly filePath?: string; }
resolveLorelumPaths(homeDirectory?: string): LorelumPaths;
loadConfig(options?: LoadConfigOptions): Promise<Readonly<Record<string, unknown>>>;
initializeConfig(options?: LoadConfigOptions, initialDocument?: Readonly<Record<string, unknown>>)
  : Promise<{ readonly created: boolean; readonly filePath: string }>;
```

以上签名是模块合同示意。CLI 的组合顺序是：确认执行显式 `backend start` → 使用 backend 导出的 backend/embedding 默认 section 构造初始文档 → 调用基础包 `initializeConfig` → 调用纯读的 backend config loader → 启动 supervisor。默认值仍由对应模块定义，CLI 只组装，不复制数值；目前没有已定义的 CLI 默认字段，就不向初始 YAML 添加虚构字段。CLI 可独立 `loadConfig()` 并取得 `document.cli`，已有 CLI 消费者负责其校验，无需 backend HTTP。

移除 `loadBackendConfig` 的 `initialize` 选项及写入副作用；初始化不藏在 loader、路径解析器或 LocalStore 构造过程中。help、describe、status、stop、model status 和直接 `loadConfig` 保持只读。backend/embedding 仍在启动时生成不可变快照；迁包不引入热重载。LocalStore 默认根目录和全局 `--store-root` 的现有优先级保持，不新增 Store root 配置项。

初始化只处理不存在的配置文件，写入当前模块可编辑的默认值，不固化机器绝对路径，下载地址采用已验证的固定版本。先写同目录临时文件并同步，再以不覆盖目标的方式发布；并发启动只有一个创建者。已有配置的字节、注释、其他模块字段和权限保持不变；损坏配置继续明确报错，不以默认配置覆盖。文件创建为 0600，新目录为 0700；backend 运行目录和模型缓存由各自的实际使用路径创建。

迁移时将现有 shared/config 源码及测试移入新包，更新 workspace 依赖和所有 import；同一仓库内部引用一次迁完，不保留两套实现。基础包保留 `filePath`/`homeDirectory` 注入以供隔离测试；backend runtime/model cache 路径在 backend 内派生。配置迁包不新增命令或修改 CLI envelope、HTTP endpoint。

此前初始化实现已通过空 HOME 编译 CLI、注释/权限保留与 597 项测试；这只能证明迁移前行为，不能作为新边界已经完成的证据。迁移验收补充：基础包无业务包依赖；无 backend 时 CLI 直接读取共享文档；LocalStore 默认路径与覆盖行为保持；只读命令不创建 `.lorelum`；并发初始化仅一方创建且文件完整；backend loader 单独调用不写入。重跑受影响测试、typecheck、lint 和空 HOME 编译 CLI 验收。

配置生命周期独立后，用户仍可在空 HOME 显式启动并编辑默认配置。默认模型已具备公开 HTTPS 来源；native 资源安装仍需单独完成。

抽离后验证：全量 600 项测试、所有 workspace typecheck、lint、frozen-lockfile 安装与 CLI 编译通过；编译 CLI 在隔离 HOME 下再次验证首次初始化、只读无写入、已有 CLI section 保留、模型 load/unload。配置基础包测试允许 backend section 含无效业务字段，CLI/Store 仍可读取各自合法 section；由 backend 消费时才报该模块配置错误。

默认来源接入验收：编译 CLI 在空 HOME 下首次启动初始化配置，model load 经公开 HTTPS 下载完整模型，显示进度并通过大小/SHA 校验后达到 ready；unload 后再次 load 复用缓存。602 项测试、typecheck、lint 和编译通过。

下载库替换验收：got 16.0.0 在 Bun 1.3.8 源码与编译 CLI 下通过完整 HTTPS 下载及从 1 MiB partial 续传，大小/SHA 一致并达到 native ready；本地服务器覆盖 Range 错误、取消后无追加、停滞、慢速持续进展、重试与进程崩溃恢复。全量 608 项测试、typecheck、lint、冻结依赖安装和编译通过。下载层无系统 curl/shell 依赖，Windows native 与端到端验收仍未交付。
