# 配置文档

Lorelum 使用共享的 `~/.lorelum/config.yaml`。每个模块只读取自己负责的顶层 section；backend 在启动控制端只读取一次并把结果作为不可变快照传入 daemon。修改配置后重启 backend 才生效。

配置优先级是：默认值 → YAML section → 允许的环境变量 → 内部测试注入。无效 section、未知字段、超出范围或违反大小限制都会返回 `backend.config-invalid`，不会静默回退。

- [Backend 配置](backend.md)：服务启动、请求、停止的超时和环境变量。
- [Embedding 配置](embedding.md)：显式模型路径、缓存、下载和 CPU 参数。

配置文件和模型缓存独立于 LocalStore；`--store-root` 不改变它们。

## 首次运行与目录

无需预先创建配置。第一次显式执行 `lore backend start` 会初始化缺失的 `.lorelum/config.yaml`，写入可编辑的 backend/embedding 默认值，再启动服务。已有文件原样保留，包括注释、其他模块字段和用户权限；空文件继续使用默认值，损坏文件明确报错，不被覆盖。并发初始化不会互相覆盖。

默认目录由 shared config 层统一解析：

```text
~/.lorelum/
├── config.yaml         # 共享用户配置，首次 start 创建
├── run/backend/        # 私有运行记录，由服务生命周期创建和清理
└── models/<sha256>/    # 模型缓存，首次使用时创建；停止服务后保留
```

配置文件创建为 0600，新目录为 0700。`help`、`describe`、`backend status/stop` 和 `model status` 不会为了读取默认值创建配置。共享路径解析也供默认 LocalStore root 使用；显式 `--store-root` 仍只影响 Store。

初始化文件不写机器绝对路径或虚构模型地址。默认模型稳定下载源尚未提供，首次 model load 仍可能返回 `embedding.download-unavailable`；初始化配置与完成模型资源分发是两件独立的交付事项。
