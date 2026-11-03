## Why

Issue [#305](https://github.com/lorelum/lorelum/issues/305) 证实一次长 embedding 后 native CPU 计算内存会保留高水位，短请求和闲置不会回收。引入默认空闲休眠，避免这部分内存伴随 Backend 生命周期长期占用，同时保留长输入和批处理语义。

## What Changes

- native 连续空闲 60 秒后销毁模型和计算 context，保留受控服务进程；下一次 embedding 自动重载并继续处理。
- 模型 `ready` 表示能够接受编码，不承诺权重持续驻留。状态查询、重复 `model load` 不唤醒、不固定驻留；显式 unload 仍停止进程。
- 保持现有线程、2048-token physical batch、两个 slots、认证、向量身份、请求超时、取消和失败回收行为。不增加新配置、协议字段、后台轮询、重试或二次文件校验。
- 增加实际 native/Backend 回归验收，测量 physical footprint、RSS、唤醒延迟和同形 batch 向量一致性；更新用户与维护者说明。

本变更引入新的默认资源生命周期，不是单纯记录既有行为。体验见 [product.md](product.md)。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-model-runtime`：空闲时自动归还 native 模型/context，后续请求透明唤醒；明确 ready 与显式 load/unload 的边界。

## Impact

生产改动集中在 `packages/backend/src/runtime/llama-options.ts` 的统一 native recipe。复用固定 llama.cpp 已提供的 `--sleep-idle-seconds`；不修改 native patch、manifest 或发布流程。API/CLI schema、索引和 `encodingId` 不变；用户不需要重建 index。60 秒是本次选择的固定起步值，用于避免请求间短暂停顿反复重载，又限制长期闲置占用，不宣称经工作负载统计优化。
