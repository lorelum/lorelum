# 配置实现说明

此页面向维护者，说明全局配置包、初始化和 runtime 目录的实现边界。用户应在[配置指南](https://lorelum.com/zh/docs/configuration)查看可编辑字段、环境变量和恢复步骤；不要在本目录复制这些用户说明。

Lorelum 使用共享的 `~/.lorelum/config.yaml`。每个模块只读取自己负责的顶层 section；backend 在启动控制端只读取一次并把结果作为不可变快照传入 daemon。修改配置后重启 backend 才生效。

Agent 共用的 `agent` section 由 CLI 在支持会话身份注入的宿主 Hook 调用时读取，不需要重启 Backend；没有对应 Hook 的宿主不受影响。CLI 不修改现有用户文件，行为边界见 [Host Hook ABI](../cli/hook.md)。

Registry source catalog 是 CLI 的另一条用户级状态边界：`~/.lorelum/registries.yaml` 由
`@lorelum/config` 的 Registry catalog store 所有，供 `lore registry` 与 Pack install/update
选择 named/default Registry。它不是 `config.yaml` 的 section，也不是 project `.lorelum/config.yaml`
或 LocalStore 数据；`--store-root` 不会改变它。catalog 只保存已校验的 remote Git locator 或
canonical local-Git worktree root，不保存 credentials。local worktree path 属于私有配置，CLI
的公开 result 不回显它。

Backend 配置优先级是：默认值 → YAML section → 允许的环境变量 → 内部测试注入。backend/embedding 的无效 section、未知字段、超出范围或违反大小限制会返回 `backend.config-invalid`，不会静默回退。Agent Hook 的无效配置则在消费它的 Hook 边界输出非阻塞 no-op 和不含配置内容的诊断，不会扩大注入范围。

- [Embedding 配置实现](embedding.md)：模型路径、缓存、下载和 CPU 参数的运行时边界。

## Query 前台预算

semantic query 的等待和 partial coverage 策略属于用户级 `query` section：

```yaml
query:
  maxWaitMs: 3000
  minCoveragePercent: 0
```

`maxWaitMs` 是 `0` 到 `120000` 的整数毫秒；Backend 接受 query 后，它只限制当前命令观察 model preparation 和 index progress 的时间，operation 会在后台继续。它不是本地 Backend 启动、连接或 RPC 的 deadline，因此 `0` 表示不额外等待 progress，仍会安全提交或加入 operation，并返回 ready、`preparing` 或 `indexing`。`minCoveragePercent` 是 `0` 到 `100` 的整数百分比；只要已验证 current progress 达到该值，query 就可以返回带 `coverage: "partial"` 和完成/总数的成功结果。`--max-wait-ms`、`--min-coverage-percent` 覆盖一次命令，`--require-complete` 等价于 `100`，且不能与后者同时使用。

配置文件和模型缓存独立于 LocalStore；`--store-root` 不改变它们。

## 首次运行与目录

无需预先创建配置。第一次显式执行 `lore backend start` 时，由 CLI 应用组装层调用全局初始化入口，初始化缺失的 `.lorelum/config.yaml`，写入可编辑的 backend/embedding 默认值，再启动服务。已有文件原样保留，包括注释、其他模块字段和用户权限；空文件继续使用默认值，损坏文件明确报错，不被覆盖。并发初始化不会互相覆盖。

全局根目录与 config.yaml 路径由独立的 `@lorelum/config` 包解析。backend 从根目录派生自己的运行目录和模型缓存：

```text
~/.lorelum/
├── config.yaml         # 共享用户配置，首次 start 创建
├── registries.yaml      # CLI-owned named/default Registry catalog（按需创建）
├── cache/               # 可删除、可重建的 query artifact 与共享向量
├── run/backend/        # 私有运行记录，由服务生命周期创建和清理
└── models/<sha256>/    # 模型缓存，首次使用时创建；停止服务后保留
```

配置文件创建为 0600，新目录为 0700。`help`、`describe`、`backend status/stop` 和 `model status` 不会为了读取默认值创建配置。基础包的根路径解析也供默认 LocalStore root 使用；显式 `--store-root` 仍只影响 Store。

Registry catalog 同样使用私有文件边界、严格 schema、bounded lock 和 atomic replacement。读取损坏
catalog 不等价于“没有 catalog”，因此 CLI 不会静默切回 `official`；CLI 将其映射为
`registry.catalog-invalid`。并发 mutation 在有限等待后以 `registry.catalog-busy` 失败，调用方可
重试。`registry list` 只读取 catalog，不为了展示 source 访问远端；用户操作与恢复见站点
[安装与管理 Pack](https://lorelum.com/zh/docs/packs)。

## 派生 query cache

项目 `.lorelum/` 和 LocalStore 都是 canonical source；keyword artifact、semantic artifact、semantic progress 与共享 embedding vector 都只存在用户级 cache，默认位置为 `~/.lorelum/cache`。因此同一仓库开多个 worktree，或两个普通目录恰好解析出相同的 active Practice 语料时，可以复用同一个 artifact，而无需把 index 写进 Git 工作区或新增 `.gitignore`。

```text
~/.lorelum/cache/
├── semantic/v1/vector-cache.sqlite
└── query-artifacts/v1/
    ├── artifact-cache.sqlite
    └── artifacts/
        ├── keyword/<artifact-id>/active.sqlite
        └── semantic/<artifact-id>/{progress.sqlite,active.sqlite}
```

artifact ID 只来自 index 版本、Profile（semantic）和当前 active `(practiceId, contentDigest, projectionDigest)` 清单；不会包含 Git、worktree、项目路径、branch、commit、mtime、Store path 或 source provenance。`projectRootId` 仅用于把同一目录的连续编辑合并成最新 background target，不参与 artifact ID。

运行 `lore cache status` 可以查看 artifact、progress、共享 vector 和字节数；运行 `lore cache prune` 会显式清理未被 query/build 使用的派生数据。清理不改 `.lorelum`、Git metadata 或 LocalStore；下次 ProjectContext query 会从当前 canonical source 重建需要的部分。若某个 artifact 正在构建或被 partial query 读取，清理会跳过它而不是中断用户操作。

初始化文件不写机器绝对路径，包含固定版本的 Hugging Face 模型下载地址。未填写 URL 的已有配置也会使用默认来源；首次确实需要 embedding 的 semantic 操作会在缓存为空时自动开始下载并校验模型，不会长时间等待传输完成。安装目录仍需包含配套 native 资源。

## 包边界与直接读取

`@lorelum/config` 不依赖 backend、CLI 或 Engine。它处理全局路径、YAML 文档读取、幂等初始化以及
Registry catalog 的严格读写边界；catalog API 不访问 HTTP，也不需要 backend 正在运行。CLI、
LocalStore 和 backend 都可以直接依赖它，但只有 CLI 拥有 Registry source 选择和命令协议。

```ts
import { loadConfig, resolveLorelumPaths } from "@lorelum/config";

const paths = resolveLorelumPaths();
const document = await loadConfig();
// 消费方用自己的 schema 校验 document.cli / document.store 等已定义的 section。
```

上述包名导入用于已声明 workspace 依赖的模块。基础包不会新增尚未定义的 CLI/Store 设置。backend config loader 只读并解析 backend/embedding 字段，query loader 只读并解析 query 字段；即使某个 section 无效，其他消费者仍有各自的边界。YAML 文档本身损坏时，所有消费者都会收到通用 ConfigError。

首次初始化的模块默认值在 CLI 的 `config/initialize.ts` 组装。当前只有 backend/embedding 默认字段，来自该模块导出的 defaults；默认值的所有权仍归消费方，文件初始化的所有权归全局 config。未来已实现的模块可在应用组装处加入自己的默认段，不需要修改基础包或访问 backend 服务。
