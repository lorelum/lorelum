# Embedding 配置

`embedding` section 可省略。显式 `model load` 时，若没有指定本地模型且缓存为空，会从 Lorelum 的 Hugging Face 仓库下载固定 Q4_0 文件。`backend start` 和只读命令不会下载模型；`download.enabled: false` 可禁用下载，缺少缓存时返回 `embedding.not-configured`。

```yaml
embedding:
  # 可选：用户管理的固定模型文件；必须是绝对路径
  modelPath: /models/granite-q4_0.gguf
  # 默认 ~/.lorelum/models；必须是绝对路径
  cacheDirectory: /models/lorelum-cache
  threads: 4
  download:
    enabled: true
    # 可选：覆盖默认下载源的 HTTPS 镜像
    url: https://mirror.example.test/granite-q4_0.gguf
    connectTimeoutSeconds: 30
    stallTimeoutSeconds: 60
    maxAttempts: 3
```

## 字段合同

| 字段 | 默认值/范围 | 说明 |
| --- | --- | --- |
| `modelPath` | 无；绝对路径 | 使用用户管理的固定文件，只验证大小和 SHA-256，不覆盖、不自动下载到该路径 |
| `cacheDirectory` | `~/.lorelum/models`；绝对路径 | 未指定 `modelPath` 时按固定摘要缓存模型；独立于 Store 和 runtime directory |
| `threads` | `4`；整数 1–64 | 同时设置 native `-t` 和 `-tb`，不改变 encodingId |
| `download.enabled` | `true` | false 时不联网；缺少完整缓存返回 `embedding.not-configured` |
| `download.url` | 下方固定版本地址；HTTPS | 固定模型的镜像地址；必须稳定支持续传并交付固定 SHA-256，不能指定 native executable |
| `download.connectTimeoutSeconds` | `30` | DNS、TCP 和 TLS 各连接阶段的超时 |
| `download.stallTimeoutSeconds` | `60` | 连续没有收到文件字节的时间 |
| `download.maxAttempts` | `3` | 短暂网络错误的最大尝试次数；不设置整个下载总时限 |

当前固定模型身份：Q4_0、66,345,216 bytes、SHA-256 `18e8ce8ce834790618e90d26bed465cca87362076f3042eb0d8eee0732596f59`。同名但摘要不同的文件不是可接受替代品。

默认下载地址固定到仓库 commit，不跟随 `main`，无需 Hugging Face 登录或 token：

```text
https://huggingface.co/Lorelum/granite-embedding-97m-multilingual-r2-GGUF/resolve/7a8af1473a747268bbb3968b77d5b822a6506667/granite-q4_0.gguf
```

已有 config.yaml 未填写 URL 时也会使用该默认值，无需删除或重新初始化配置。自定义镜像仍需交付相同大小和 SHA-256 的文件。

## 下载和恢复

未指定 `modelPath` 时，load 在 `cacheDirectory` 下按摘要定位完整文件。`.part` 与最终文件相邻；中断、取消或可重试失败会保留 `.part`，下一次 load 按实际长度续传。完成后先验证大小和 SHA-256，再原子改名；未验证文件不会交给 native。

不支持 Range、远端偏移不匹配、来源变更或摘要失败都要明确报错，不自动删除 `.part` 并从零重试。只有确认数据损坏或决定放弃不兼容的续传时，先执行 `model unload`，再手动删除对应 `${cacheDirectory}/${sha256}/model.gguf.part`，不要清理 cache directory 下其他文件。权限、磁盘空间和永久 HTTP 错误不循环重试。下载使用随 CLI 打包的 got npm 包，无需安装 curl。下载没有总超时；DNS、TCP、TLS 各连接阶段默认上限 30 秒，连续无文件字节进展默认上限 60 秒。取消会等待文件流关闭，再允许下次续传。

native 固定以 2048 context 初始化；该参数不暴露为 config 字段，也不作为 Lorelum 的输入 token 上限。

## 生效与隐私

backend 启动时读取一次共享 YAML，形成不可变 config snapshot；daemon、service、download adapter 和 native client 不再次读取 YAML 或 `process.env`。模型状态不返回 URL 查询参数、下载凭据、缓存绝对路径或私有端口。
