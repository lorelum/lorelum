# Backend 控制 API

当前 Backend control 合同见 [backend runtime](../../openspec/specs/backend-runtime/spec.md)；关联的 retrieval 行为分别见 [retrieval query](../../openspec/specs/retrieval-query/spec.md)、[semantic index](../../openspec/specs/semantic-index/spec.md) 和 [local model runtime](../../openspec/specs/local-model-runtime/spec.md)。本页只说明 HTTP adapter。

所有路径都以 `/internal/v1` 开头。identity 是唯一不要求 Bearer credential 的接口；其余接口必须通过本次 daemon 的 runtime secret 认证。

## Identity

`GET /internal/v1/identity?nonce=<64 位小写十六进制>`

请求不得带 `Authorization` 或 cookie。成功返回当前实例身份和 nonce-bound proof：

```json
{
  "instanceId": "3c6c8d9e-3b52-4e66-a8f5-0a4b8c2e4f7b",
  "buildIdentity": "…",
  "protocolVersion": 3,
  "proof": "…"
}
```

客户端必须用 runtime secret 重算 proof，并检查 instance、record 中的 build 和 protocolVersion。普通 control/business 请求还必须要求 remote build 与当前 CLI build 相同；`backend stop` 可接受当前 CLI build 不同，但仍必须通过 record identity、proof 和 protocol 校验。任一身份校验不匹配时不得继续请求。

## Status

`GET /internal/v1/status`

成功返回 backend 生命周期和模型状态：

```json
{
  "state": "ready",
  "model": "loading",
  "instanceId": "3c6c8d9e-3b52-4e66-a8f5-0a4b8c2e4f7b",
  "buildIdentity": "…"
}
```

`state` 为 `starting`、`ready`、`stopping` 或 `stopped`；`model` 为 `unloaded`、`loading`、`ready`、`unloading` 或 `failed`。status 是只读操作，不启动 backend、下载模型或扫描模型文件。

## Stop

`POST /internal/v1/stop`

此控制接口不要求 body，现有 client 发送无 body 的 POST。服务先关闭新请求准入，再沿同一 shutdown deadline 卸载模型并关闭 HTTP。成功只在 backend 已进入停止流程并返回状态后报告；客户端仍应等待进程记录消失，不得按端口或进程名杀进程。

常见响应：

- `200`：返回 `BackendStatus`，通常为 `stopping`。
- `400`：Host 不符合固定本地 authority，或请求解析失败。
- `401`：credential 缺失或错误。
- `403`：请求带 `Origin`。stop 可重复请求，返回 stopping；它不使用模型/查询接口的 busy 准入规则。

所有控制接口的错误都使用 [统一错误 envelope](README.md)。模型专属状态和错误见 [Embedding API](embedding.md)。

## Semantic index

这些接口与 [Query API](query.md) 共用 canonical context、方法选择和 Profile 隔离规则，不读取 CLI YAML。`retrievalMethod` 只接受 `single-vector` 或实验性的 `multi-view-vector`，省略时默认 `single-vector`；非法方法由 controller 返回 `400` / `usage.invalid`，其他 JSON、未知字段或 wire shape 错误仍为 `backend.invalid-request`。

| 接口 | 请求位置与字段 | 成功响应 |
| --- | --- | --- |
| `GET /internal/v1/index/status` | query string：必填绝对路径 `storageRoot`；可选 `retrievalMethod`、`cacheRoot`、`projectRoot`、`projectStartDirectory` | `200`，当前请求 Profile 的 index status |
| `POST /internal/v1/index/build` | JSON：必填 `storageRoot`；可选顶层 `retrievalMethod`、`cacheRoot` 或 `projectContext` | `202`，已接受或加入的 operation |
| `POST /internal/v1/index/rebuild` | 与 build 相同 | `202`，强制完整构建的 operation |
| `GET /internal/v1/index/operations/:operationId` | 路径中的 UUID；不传当前方法或 context | `200`，该 operation；记录不存在时 `410` / `backend.operation-expired` |

所有路径字段必须为绝对路径。mutation 的 `projectContext` 是 `{ cacheRoot, startDirectory?, projectRoot? }`，至少提供一个 source directory，并与顶层 `cacheRoot` 互斥。status 将同一 context 展平为 `projectRoot` / `projectStartDirectory` / `cacheRoot`；指定 project source 时必须提供 `cacheRoot`。Store-only 省略 cache route 时使用默认用户 cache，不回退 Store-local semantic index。

例如 build 的请求体：

```json
{
  "storageRoot": "/absolute/path/to/isolated-store",
  "retrievalMethod": "multi-view-vector",
  "projectContext": {
    "startDirectory": "/absolute/path/to/project",
    "cacheRoot": "/absolute/path/to/user-cache"
  }
}
```

Backend client 的 `BackendIndexRequestOptions` 在共享 `BackendRequestOptions`（`signal`、`deadline`、`traceId`、`diagnosticLevel`）上增加 `retrievalMethod`、`cacheRoot`、`projectContext`；共享字段是请求控制/诊断 context，不是 JSON body 字段。`BackendQueryRequest` 则把方法放在 query 对象中。调用者应使用同一请求 context 传递取消、deadline 和诊断关联，不应为方法新增 daemon 设置。

operation lookup 只观察原 operation；后来的方法选择不会改绑其 encoding、method recipe、Profile 或 artifact。CLI 状态及 operation 生命周期的解释见 [index maintainer contract](../cli/index.md)，持久化字段见 [persistence guide](../development/persistence.md#semantic-encoding-input-schema)。
