# 产品体验：omp 自动适配 shell

## 普通路径

用户在 omp 的普通 Bash 工具运行 `lore get <id>`，无需配置；Windows 上也使用 Bash 前缀。命名服务或可用本地 PTY 使用外部 shell 时，集成在可识别时读取 omp 的有效 shell 设置。成功读取在 Backend 已运行时关联到当前会话；不改变 get 正文。

## 可选覆盖

识别不到实际 shell 或宿主使用特殊终端时，可在现有 `~/.lorelum/config.yaml` 中覆盖：

```yaml
agent:
  omp:
    shell: powershell # bash 或 powershell
```

删除字段恢复自动选择。下一次 Hook 读取设置，无需重启 Backend；宿主自己的 shell 设置生效时间由宿主决定。覆盖不会修改宿主 shell。

## 失败及边界

普通 Bash 与外部终端可能混用；一个显式覆盖作用于所有 omp shell 调用，不应误认为逐调用检测。宿主选择不可识别时使用 Bash 前缀。无效覆盖跳过该次身份改写，不阻塞原命令和审批；修正或删除字段后重试。没有 Backend 时，get 仍按现有行为返回正文。
