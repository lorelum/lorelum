# 空闲模型自动回收

## 用户路径

用户照常执行 `lore query "如何划分资源生命周期责任"` 或构建语义 index。首次准备、下载和进度显示不变。模型完成工作后继续处理后续请求；连续 60 秒没有 native 工作时，自动释放模型和计算内存，Backend 和受控 native 进程继续运行。无需设置新配置或定期运行卸载命令。

下一次 semantic query 或 index 编码自动唤醒模型，再执行原来的输入。首个请求多出本地重载耗时；不是重新下载、重新建立索引或创建第二个模型进程。回收只降低闲置内存，不降低处理长输入时的峰值。

`lore model status` 仍返回原有 JSON envelope，其中 `data.state` 可以保持 `"ready"`。这个状态表示编码入口可用，不表示模型持续驻留。状态查询不触发唤醒。重复 `lore model load` 对 ready runtime 返回 ready，不承诺阻止空闲回收。需要立即彻底释放模型进程时，继续执行 `lore model unload`；成功后为 unloaded，下次需要模型时走原来的准备流程。

## 支持的情形

- 连续 query 或 index batches：native 仅在没有待处理或正在执行的任务时休眠，不中断编码，不截断输入，也不改变行与输入的关联。
- 长时间思考后继续 query：首个 embedding 等待本地模型重载，之后照常返回结果；其余短间隔请求复用已唤醒模型。
- 仅查看状态或保留 Backend task lease：不会因为这些操作强制模型驻留；lease 继续只保护 Backend 停止边界。
- 长输入与多输入 batch：保留原来的 batch 与 slot 设置，不能通过缩小 microbatch 或拆分单条文本换取回收效果。原有模型本身的输入限制不变。
- 显式卸载或 Backend 停止：沿原来的在途请求收尾、deadline 和进程归属路径完成；休眠不是停止 daemon。

## 失败与恢复

唤醒耗时计入既有 embedding 请求 deadline，不新增重试或延长超时。若重载或编码失败，仍返回现有模型错误并通过现有 runtime 回收路径处理；用户可在修正模型来源后执行 `lore model load` 重试。不会自动删除模型缓存、Pack、index 或重新下载模型。内存回收发生在 native 主循环观察到空闲后，60 秒不是精确到秒的释放 SLA。

## 保持不变

固定模型身份、384 维向量、pooling、归一化、量化 batch 数值容差、认证、索引格式和 CLI/API 字段均不变。无需迁移用户数据或重建 index。本次不提供低峰值内存模式、不修改 CPU/GPU 执行方式，也不将有限平台化观测称为无限内存泄漏。
