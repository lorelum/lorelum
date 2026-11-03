## 1. 实现

- [x] 1.1 在统一 native recipe 默认启用 60 秒空闲休眠，保留所有编码参数、签名和资源所有权；由真实 native 验收证明，禁止仅断言参数文本的测试。
- [x] 1.2 添加隔离 Backend/native 回归入口：短、长、重复长、短、idle、唤醒、同形 batch、状态/load 不唤醒、显式 unload/reload；macOS 同时记录 footprint 与 RSS，断言显著释放和完整向量，不修改共享服务。
- [x] 1.3 更新中英文 model 用户页、API/CLI 维护说明、native/integration 验收指引，并将已实施规则同步到当前 local-model-runtime spec；核对所有引用与实际实现。

## 2. 验证

- [x] 2.1 运行相关 Backend 单测、类型与 lint 检查；所有新增回归入口均受类型检查，修正实际失败而不削弱行为覆盖。
- [x] 2.2 在目标构建与真实固定模型上完成实际 60 秒阈值的 idle 回归，记录短/长/重复/短/idle 的 footprint 与 RSS、唤醒耗时、批处理关联和数值一致性、unload/reload；对同机基线说明构建与输入边界，保留精炼验证记录。
