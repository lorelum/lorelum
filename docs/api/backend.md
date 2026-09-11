# Backend 控制 API

所有路径都以 `/internal/v1` 开头。identity 是唯一不要求 Bearer credential 的接口；其余接口必须通过本次 daemon 的 runtime secret 认证。

## Identity

`GET /internal/v1/identity?nonce=<64 位小写十六进制>`

请求不得带 `Authorization` 或 cookie。成功返回当前实例身份和 nonce-bound proof：

```json
{
  "instanceId": "3c6c8d9e-3b52-4e66-a8f5-0a4b8c2e4f7b",
  "buildIdentity": "…",
  "protocolVersion": 1,
  "proof": "…"
}
```

客户端必须用 runtime secret 重算 proof，并检查 instance、build 和 protocolVersion。身份不匹配时不得继续请求。

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
