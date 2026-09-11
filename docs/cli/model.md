# Model 命令

Model 命令控制本地 embedding service，不依赖 LocalStore，也不会因为 `--store-root` 改变模型来源。backend 必须先由 `lore backend start` 启动。

## `lore model load`

显式开始模型准备和加载。HTTP 层立即接受共享任务，但 CLI 会轮询 status，直到 `ready`、`failed` 或被显式 unload。

```sh
lore backend start
lore model load 2>model-load.progress.log
```

stdout 只输出最终 JSON envelope；stderr 输出阶段和数值进度，例如：

```text
model: resolving
model: downloading 50% (attempt 1)
model: verifying
model: starting
```

相同阶段、百分比和 attempt 不会重复输出。成功 data 是 `ModelStatus`，包含 `state`, `encodingId`, `device`, `dimensions`, `threads` 和 `maxTokens`，加载完成时 `state` 为 `ready`。重复执行会加入同一个 loading task，不会创建第二个下载或 native 进程。

## `lore model status`

只读取当前 daemon 的模型状态，不启动 backend、不触发下载、不扫描或 hash 模型文件：

```sh
lore model status
```

loading 时会返回 `progress.phase`，可选 `downloadedBytes`、`totalBytes` 和 `attempt`；unloaded、ready、failed 状态不伪造进度。没有 verified backend 时返回 `backend.unavailable`。

## `lore model unload`

```sh
lore model unload
```

卸载会取消文件准备或 native startup，并等待资源和自建进程退出。`.part` 下载片段会保留以便下一次 load 续传。只有确认清理成功才退出 `0`；超时或清理失败会返回 `embedding.deadline-exceeded`/`embedding.failed`，状态保持 failed。

摘要、Range 或来源错误不会自动清除部分文件。需要手动删除对应 `${cacheDirectory}/${sha256}/model.gguf.part` 后重试；不要清空 cache directory 下的其他文件。

## Status fields

| 字段         | 说明                                                             |
| ------------ | ---------------------------------------------------------------- |
| `state`      | `unloaded`、`loading`、`ready`、`unloading`、`failed`            |
| `encodingId` | 绑定模型、实现、CLS/L2、特殊 token 规则和 `maxTokens` 的稳定身份 |
| `device`     | 当前固定为 `cpu`                                                 |
| `dimensions` | 当前固定为 `384`                                                 |
| `threads`    | 实际 native `-t/-tb` 设置                                        |
| `maxTokens`  | 实际 tokenizer/native context 上限，当前允许 512/1024/2048       |
| `progress`   | loading 阶段和数值字节进度                                       |
| `error`      | failed 状态下的稳定错误 code                                     |

## Errors

除通用 backend 错误外，CLI 可能返回：

- `embedding.not-configured`
- `embedding.download-unavailable`
- `embedding.download-failed`
- `embedding.download-stalled`
- `embedding.download-range-unsupported`
- `embedding.resource-invalid`
- `embedding.not-loaded`
- `embedding.busy`
- `embedding.input-invalid`
- `embedding.input-too-long`
- `embedding.deadline-exceeded`
- `embedding.failed`

错误不会回显下载 URL 查询参数、runtime secret、缓存绝对路径或 native 私有端口。配置字段与缓存生命周期见 [Embedding 配置](../configuration/embedding.md)。

已验证的参考样本（每档 5 条计时样本，非性能 SLA）：512/4 threads 平均 55.70 ms、RSS 581.4 MiB；1024/2 threads 平均 204.75 ms、RSS 936.1 MiB；2048/4 threads 平均 354.18 ms、RSS 1666.7 MiB。每档的 maxTokens 与 `maxTokens + 1` 边界、384 维和 L2 范数均已验证。
