# 配置文档

Lorelum 使用共享的 `~/.lorelum/config.yaml`。每个模块只读取自己负责的顶层 section；backend 在启动控制端只读取一次并把结果作为不可变快照传入 daemon。修改配置后重启 backend 才生效。

配置优先级是：默认值 → YAML section → 允许的环境变量 → 内部测试注入。无效 section、未知字段、超出范围或违反大小限制都会返回 `backend.config-invalid`，不会静默回退。

- [Backend 配置](backend.md)：服务启动、请求、停止的超时和环境变量。
- [Embedding 配置](embedding.md)：显式模型路径、缓存、下载和 CPU 参数。

配置文件和模型缓存独立于 LocalStore；`--store-root` 不改变它们。

## 首次运行与目录

无需预先创建配置。第一次显式执行 `lore backend start` 时，由 CLI 应用组装层调用全局初始化入口，初始化缺失的 `.lorelum/config.yaml`，写入可编辑的 backend/embedding 默认值，再启动服务。已有文件原样保留，包括注释、其他模块字段和用户权限；空文件继续使用默认值，损坏文件明确报错，不被覆盖。并发初始化不会互相覆盖。

全局根目录与 config.yaml 路径由独立的 `@lorelum/config` 包解析。backend 从根目录派生自己的运行目录和模型缓存：

```text
~/.lorelum/
├── config.yaml         # 共享用户配置，首次 start 创建
├── run/backend/        # 私有运行记录，由服务生命周期创建和清理
└── models/<sha256>/    # 模型缓存，首次使用时创建；停止服务后保留
```

配置文件创建为 0600，新目录为 0700。`help`、`describe`、`backend status/stop` 和 `model status` 不会为了读取默认值创建配置。基础包的根路径解析也供默认 LocalStore root 使用；显式 `--store-root` 仍只影响 Store。

初始化文件不写机器绝对路径或虚构模型地址。默认模型稳定下载源尚未提供，首次 model load 仍可能返回 `embedding.download-unavailable`；初始化配置与完成模型资源分发是两件独立的交付事项。

## 包边界与直接读取

`@lorelum/config` 不依赖 backend、CLI 或 Engine。它只处理全局路径、YAML 文档读取与幂等初始化，不验证具体 section。CLI、LocalStore 和 backend 都可以直接依赖它，读文件不需要 HTTP，也不需要 backend 正在运行。

```ts
import { loadConfig, resolveLorelumPaths } from "@lorelum/config";

const paths = resolveLorelumPaths();
const document = await loadConfig();
// 消费方用自己的 schema 校验 document.cli / document.store 等已定义的 section。
```

上述包名导入用于已声明 workspace 依赖的模块。基础包不会新增尚未定义的 CLI/Store 设置。backend config loader 只读并解析 backend/embedding 字段；即使 backend 某字段无效，其他模块仍可读取和校验自己的 section。YAML 文档本身损坏时，所有消费者都会收到通用 ConfigError。

首次初始化的模块默认值在 CLI 的 `config/initialize.ts` 组装。当前只有 backend/embedding 默认字段，来自该模块导出的 defaults；默认值的所有权仍归消费方，文件初始化的所有权归全局 config。未来已实现的模块可在应用组装处加入自己的默认段，不需要修改基础包或访问 backend 服务。
