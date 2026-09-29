# Embedding 模型 API

当前可观察合同见 [local model runtime OpenSpec](../../openspec/specs/local-model-runtime/spec.md)；本页说明 Backend HTTP adapter 的模型状态、准备和编码细节。

模型接口复用 backend 的本地认证边界。模型资源准备、native 启动和编码由同一个 service 管理；重复 load 不会创建第二个下载或 native 进程。

## ModelStatus

成功响应包含：

```json
{
  "state": "loading",
  "encodingId": "…",
  "device": "cpu",
  "dimensions": 384,
  "threads": 4,
  "progress": {
    "phase": "downloading",
    "downloadedBytes": 33554432,
    "totalBytes": 66345216,
    "attempt": 1
  }
}
```

`state` 为 `unloaded`、`loading`、`ready`、`unloading` 或 `failed`。`device` 固定为 `cpu`，`dimensions` 固定为 `384`。`threads` 是实际 native 配置；native 以固定的 2048 context 初始化，但 Lorelum 不把它作为用户可配置或输入准入上限。

`progress` 只在加载期间出现，`phase` 为 `resolving`、`downloading`、`verifying` 或 `starting`。字节字段是数值；未知总大小时可以省略 `totalBytes`。状态响应不包含 URL、凭据、缓存路径或私有端口。`encodingId` 绑定模型身份、实现、pooling、normalization 和特殊 token 规则；threads、native 初始化参数与下载策略不改变它。

文件校验失败的 status 仍以 `error` 给出稳定 code，并附可选 `resource: { kind, file, check, expected?, actual? }`。`file` 是相对于 native target 的逻辑名称、`model.gguf` 或 `embedding.modelPath`，不包含绝对路径；预期和实际值仅用于大小或 digest 检查。native 安装失败使用 `embedding.native-resource-invalid`；模型文件失败使用 `embedding.resource-invalid`。

## Load

`POST /internal/v1/model/load`，body `{}`。

- 已经 `ready`：返回 `200` 和 ready status。
- 新任务被接受或已有 loading 任务被复用：立即返回 `202` 和 loading status。
- `unloading`：返回 busy 错误。

202 只表示任务已接受。HTTP handler 不等待下载或 native startup；调用方应轮询 `GET /internal/v1/model/status`，直到 `ready` 或 `failed`。CLI 会执行这段轮询，并只在 stdout 输出最终 JSON envelope；每次进度更新写 stderr。

下载不设置整个任务的总时限。默认连接超时 30 秒，连接建立后 60 秒无字节增长视为 stalled，单次 load 最多尝试 3 次；native `startupTimeoutMs` 从文件准备完成后才开始。下载失败保留 `.part`，下一次 load 从实际长度继续。

## Status

`GET /internal/v1/model/status` 只读取内存状态，不触发下载、验证、启动或文件 hash。加载失败时返回 `state: "failed"` 和允许的 `error` code；资源校验失败还返回 `resource`。成功的 status 不泄露本机路径。

## Unload

`POST /internal/v1/model/unload`，body `{}`。

卸载先切换到 `unloading` 并取消文件准备或 native startup，再等待共享任务和自建进程结束。取消不会删除 `.part`，也不会自动重试。只有确认资源已退出后才返回 `200`、`state: "unloaded"`；清理超时保持 `failed` 并阻止新的 load。

HTTP 客户端断开、CLI 停止等待不会取消共享加载任务；显式调用 unload 才是取消入口。backend stop 复用同一卸载路径和 shutdown deadline。

## Automatic preparation

`POST /internal/v1/model/prepare`，body `{}`，供按需 semantic query、index build/rebuild 和 install-driven index 使用。它立即开始或加入一次 daemon 持有的 configured preparation：先校验随 CLI 安装的 native artifact，缓存缺失时再下载或续传 `.part`，完整模型文件在使用前校验。HTTP handler 不等待传输完成；native 缺失时不会先传输模型。

接受或加入同一准备时返回 `202`：

```json
{
  "preparationId": "<uuid>",
  "status": {
    "state": "loading",
    "encodingId": "…",
    "device": "cpu",
    "dimensions": 384,
    "threads": 4
  }
}
```

`GET /internal/v1/model/preparations/:preparationId` 只轮询该次准备。成功时返回 `200` 与 `ready` status；下载、校验或 native 启动失败时 status 为 `failed` 并附稳定 error code。自动请求和显式 `model load` 共享同一 preparation；显式 load 只是持续等待并呈现进度。unload 或 daemon 重启使旧 `preparationId` 失效，返回 `embedding.preparation-expired`。

## Embeddings

`POST /internal/v1/embeddings`，body：

```json
{
  "kind": "query",
  "inputs": ["原文保持不变。", "code example"]
}
```

`kind` 为 `query` 或 `document`；一次最多 8 条，每条必须非空。输入使用同一个 native tokenizer 和编码路径处理；Lorelum 不按 token 数配置或拒绝输入，也不做 trim 或静默截断。

成功 `200`（示意，向量数必须与输入数相同；每行省略 383 个数值）：

```text
{
  "encodingId": "…",
  "vectors": [
    [0.0123, … 383 more numeric values …],
    [0.0042, … 383 more numeric values …]
  ]
}
```

向量必须与输入数量一致、维度 384、有限且 L2 范数接近 1。模型未 ready 返回 `embedding.not-loaded`；已有编码请求时返回 `embedding.busy`。

## Download errors

下载相关错误 code 为：

- `embedding.download-unavailable`：运行配置中没有可用下载来源（防御性错误；正常配置已内置固定 Hugging Face 来源）。
- `embedding.download-failed`：永久 HTTP、权限、空间或其他不可重试失败。
- `embedding.download-stalled`：连接建立后超过 stall timeout 没有字节增长。
- `embedding.download-range-unsupported`：续传所需的 Range 合同不成立。

摘要不匹配、来源变更或 Range 偏移错误不会自动丢弃已有 `.part`；需要显式清理对应的 `${cacheDirectory}/${sha256}/model.gguf.part` 后重新下载，不要删除 cache directory 下的其他模型或文件。`download.enabled: false` 且缓存缺失时返回 `embedding.not-configured`。

## HTTP 错误映射

- `400`：JSON、字段或空白输入校验失败（`backend.invalid-request`、`embedding.input-invalid`）。
- `401`：缺少或错误的 Bearer credential（`backend.unauthorized`）。
- `403`：请求带 `Origin`（`backend.unauthorized`）。
- `503`：模型 busy、未加载、下载/资源/native 失败或 backend 尚未可用；HTTP body 中返回对应稳定 error code。
