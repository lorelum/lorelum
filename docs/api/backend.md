# Backend 控制 API

当前 Backend control 合同见 [backend runtime](../../openspec/specs/backend-runtime/spec.md)；关联的 retrieval 行为分别见 [retrieval query](../../openspec/specs/retrieval-query/spec.md)、[semantic index](../../openspec/specs/semantic-index/spec.md) 和 [local model runtime](../../openspec/specs/local-model-runtime/spec.md)。本页只说明 HTTP adapter。

所有路径都以 `/internal/v1` 开头。identity 是唯一不要求 Bearer credential 的接口；其余接口必须通过本次 daemon 的 runtime secret 认证。

Backend 内部协议为 `4`；CLI JSON envelope 的 `protocolVersion` 为 `2`，两者不能互换。

## Identity

`GET /internal/v1/identity?nonce=<64 位小写十六进制>`

请求不得带 `Authorization` 或 cookie。成功返回当前实例身份和 nonce-bound proof：

```json
{
  "instanceId": "3c6c8d9e-3b52-4e66-a8f5-0a4b8c2e4f7b",
  "buildIdentity": "…",
  "protocolVersion": 4,
  "proof": "…"
}
```

客户端必须用 runtime secret 重算 proof，并检查 instance、runtime record 中的 build 与 protocolVersion。远端 build 对 record 的精确匹配用于确认实例归属；客户端另检查远端协议与 record 及自身支持的协议一致。它不要求远端 buildIdentity 等于本地 CLI buildIdentity：不同 build 只要使用兼容的 Backend protocol 4，普通 query、model、index 和 control 请求都可以复用该实例。协议不兼容仍返回 `backend.protocol-mismatch`，不得向该实例发送业务请求。

## Status

`GET /internal/v1/status`

成功返回 backend 生命周期和模型状态：

```json
{
  "state": "ready",
  "model": "loading",
  "instanceId": "3c6c8d9e-3b52-4e66-a8f5-0a4b8c2e4f7b",
  "buildIdentity": "…",
  "backendProtocolVersion": 4,
  "build": {
    "toolVersion": "0.1.0-alpha.6",
    "revision": "…",
    "dirty": false,
    "buildKind": "compiled"
  }
}
```

`state` 为 `starting`、`ready`、`stopping` 或 `stopped`；`model` 为 `unloaded`、`loading`、`ready`、`unloading` 或 `failed`。status 是只读操作，不启动 backend、下载模型或扫描模型文件。

运行中的 status 含 daemon 启动时冻结的 build provenance。若 revision 或 dirty 状态无法读取，对应值为 `null`。`stopped` 只包含 `state: "stopped"` 和 `model: "unloaded"`，不伪造远端身份。`lore backend status` 会另外组合本地 CLI provenance、`sameBuild` 与 `protocolCompatible`；这些 CLI 字段不属于 HTTP response。

## Stop

`POST /internal/v1/stop`

无 body 或 `{}` 的 POST 是普通显式 stop，服务关闭新请求准入并开始 shutdown。Backend protocol 4 还接受严格 body `{ "ifIdle": true }`，用于安全 handoff；带其他字段或值的 body 不属于该合同。旧 protocol 3 不支持 v4 idle-stop 语义。

v4 guarded stop 先在认证后的 app admission 边界同步阻止新业务请求并检查已准入请求计数。已有请求时返回 `{ "state": "deferred", "reason": "active-long-task" }`；在途为空时才于既有 activity lock 下检查后台 model preparation、index operation 与有效 task lease，并在 idle 时写入 handoff marker。Identity、status 和 stop 本身不计为业务请求。Lease 只在 `expiresAt > now` 时有效；过期 lease 不保留占用，模型仅仅已加载、另一个 Agent/聊天正在工作也不算活动。损坏或归属不明的 activity 会返回 `unknown-activity`，不会按 idle 处理。

v3 的旧私有 guard 没有在途请求 admission 保护；其旧过期 lease 规则可能把过期 lease 判为 unknown。因此协议迁移不能承诺对旧 daemon 的所有普通请求具有 v4 的原子准入保证。成功 stop response 只表示 daemon 已进入停止流程；客户端仍应等待进程记录消失，不得按端口或进程名杀进程。

常见响应：

- `200`：返回 `BackendStatus`，通常为 `stopping`。
- `200` guarded stop defer：`{ "state": "deferred", "reason": "active-long-task" | "unknown-activity" }`；该结果不会启动 shutdown。
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
