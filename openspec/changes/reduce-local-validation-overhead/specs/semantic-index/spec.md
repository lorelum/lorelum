## ADDED Requirements

### Requirement: Published semantic artifacts have a bounded read boundary

正常 complete reader、index status 与 progress 状态读取 SHALL 只验证必要 metadata、index format、所选 method/Profile 兼容性及实际消费行的 representation 结构，MUST 不为了打开或查状态执行全库 integrity 或遍历所有向量做数值质量审计。构建/重建产物在发布为 complete 前 MUST 完成既有完整 integrity、encoding-input identity、向量数值与 row/practice count 校验。查询仍 MUST 处理实际读取损坏和不兼容，而不得伪报成功。

#### Scenario: Ready status does not inspect all vector payloads

- **WHEN** 调用方读取已发布且 metadata 兼容的 complete index 状态
- **THEN** 系统 SHALL 读取必要状态数据，不为报告 ready 遍历全部 encoding-input BLOB 或执行全库完整性诊断

#### Scenario: A corrupt candidate is not published

- **WHEN** build/rebuild 的未发布产物存在非法 input identity、向量维度/数值或数量不一致
- **THEN** 构建 MUST 拒绝发布该产物，且此前 ready artifact 和 canonical Store MUST 保持可用

#### Scenario: Methods remain isolated after lighter validation

- **WHEN** single-vector 与 multi-view-vector 对同一 canonical corpus 请求状态、构建或查询
- **THEN** 系统 MUST 继续按各自 method/Profile/representation 选择 artifact 和兼容 encoding inputs，不得因减少审计混用另一方法的缓存或结果
