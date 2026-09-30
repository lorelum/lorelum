# Tasks: unify-cli-error-messages

## 1. 统一失败契约

- [x] 1.1 删除未合并的 `error.details` 类型、schema、CLI/Backend 透传和压缩渲染；验证协议 fixture、类型检查及全文检索只保留必要的历史引用。
- [x] 1.2 在统一错误响应路径处理单行、有界、安全的 `message`，保留 error code、exit code、traceId、recovery 和 allowlist 降级；验证 JSON/text 与控制字符回归测试。

## 2. 所有普通命令的可纠正失败

- [x] 2.1 在命令解析层生成具体类别与所选命令的 Help 下一步；已知枚举错误指出参数与允许值，且不回显原始输入。在所有已注册普通命令上做非法调用矩阵；验证 `bun test packages/cli/src/main.test.ts`。
- [x] 2.2 将各命令 owning validator 已知的 option、范围、互斥、必填和 Pack 规则写入 message，不退回固定的无事实文案；验证相关命令单测。
- [x] 2.3 将 query/Backend 等已知配置错误映射为可修正的 key/来源消息，未知或秘密仍安全降级；验证 CLI 与 Backend 配置测试。

## 3. 文档与完成验证

- [x] 3.1 更新维护者 CLI 文档与站点英/中页面，移除旧 details 说明并展示 message-only 的 text/JSON 示例；验证站点构建及双语一致性。
- [x] 3.2 跑 CLI/Backend 测试、typecheck、lint、OpenSpec strict validation 和差异/敏感信息检查；确认旧活跃 change 不再出现在最终文件树。
