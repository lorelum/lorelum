# Backend 配置

`~/.lorelum/config.yaml`：

```yaml
backend:
  startupTimeoutMs: 10000
  requestTimeoutMs: 5000
  shutdownTimeoutMs: 5000
```

三个值都是 1–120000 的整数，单位为毫秒：

| 字段 | 默认值 | 用途 |
| --- | --: | --- |
| `startupTimeoutMs` | `10000` | backend daemon 启动、模型 native 启动各自的预算；模型文件准备不消耗 native 启动预算 |
| `requestTimeoutMs` | `5000` | 普通控制、status、embedding 请求的单次请求预算 |
| `shutdownTimeoutMs` | `5000` | 模型卸载和 backend stop 共用的 shutdown deadline |

环境变量可以覆盖对应值：

- `LORELUM_BACKEND_STARTUP_TIMEOUT_MS`
- `LORELUM_BACKEND_REQUEST_TIMEOUT_MS`
- `LORELUM_BACKEND_SHUTDOWN_TIMEOUT_MS`

daemon 会保留启动时的 settings snapshot；修改 YAML 或环境变量不会改变正在运行的实例。`status`、`stop` 和 model 命令不会写配置文件。
