# Model 命令

Model 命令控制本地 embedding service，不依赖 LocalStore，也不会因为 `--store-root` 改变模型来源。backend 必须先由 `lore backend start` 启动。

## `lore model load`

显式开始模型准备和加载。未指定本地模型且缓存为空时，默认从 Lorelum 的 Hugging Face 仓库下载固定版本，无需手填 URL 或登录。可通过[embedding 配置](../configuration/embedding.md)指定镜像或关闭下载。HTTP 层立即接受共享任务，但 CLI 会轮询 status，直到 `ready`、`failed` 或被显式 unload。

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

相同阶段、百分比和 attempt 不会重复输出。成功 data 是 `ModelStatus`，包含 `state`, `encodingId`, `device`, `dimensions` 和 `threads`，加载完成时 `state` 为 `ready`。native 以固定的 2048 context 初始化，但该参数不出现在 CLI 或 config 合同中。重复执行会加入同一个 loading task，不会创建第二个下载或 native 进程。

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

| 字段         | 说明                                                  |
| ------------ | ----------------------------------------------------- |
| `state`      | `unloaded`、`loading`、`ready`、`unloading`、`failed` |
| `encodingId` | 绑定模型、实现、CLS/L2 和特殊 token 规则的稳定身份    |
| `device`     | 当前固定为 `cpu`                                      |
| `dimensions` | 当前固定为 `384`                                      |
| `threads`    | 实际 native `-t/-tb` 设置                             |
| `progress`   | loading 阶段和数值字节进度                            |
| `error`      | failed 状态下的稳定错误 code                          |

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
- `embedding.deadline-exceeded`
- `embedding.failed`

错误不会回显下载 URL 查询参数、runtime secret、缓存绝对路径或 native 私有端口。配置字段与缓存生命周期见 [Embedding 配置](../configuration/embedding.md)。

native 固定以 2048 context 初始化；该实现参数属于运行时内部细节，不是用户可配置的 token 上限或错误条件。
