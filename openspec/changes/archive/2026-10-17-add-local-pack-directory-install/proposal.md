## Why

Pack 作者和团队开发者经常已经拥有一个本地 Pack 目录，却必须先建 Git Registry、发布 ref，或绕行内部测试 API，才能把它安装到真实 LocalStore。这个额外分发步骤降低了本地迭代、离线开发和验收的可用性。

本 change 引入从一个显式本地 Pack directory 安装或更新的产品行为。它与“本地 Git Registry”不同：directory source 不需要 `.lorelum/registry.yaml`、Git repository、release tag 或网络；本地 Git Registry 则仍由 `add-named-registry-sources` 管理。

## What Changes

- 支持 `lore pack install --path <directory>` 与 `lore pack update --path <directory>`，直接解码一个本地 Pack root。
- `--path` 与 Pack specifier、`--registry` 互斥，且必须是非空值。Pack name/version 只来自被验证的 `pack.yaml`，调用方不能在同一调用中伪造名称或版本。
- local directory **source acquisition** 复用 `decodePackDirectory()`、LocalStore `install`/`upgrade`、格式校验、幂等、`pack.update-required`、Store recovery 与 cleanup 语义，不需要 Git、Registry 或远程 source access；canonical install 成功后仍遵循现有 `indexSync` 合同，因此 Backend/模型准备是否使用网络不因 source 类型改变。`pack update` 保持当前不触发 indexSync 的合同。
- 成功 JSON result 标识 `source.type: "directory"`，但不得把 source directory 的输入或 canonical path 写入 result、错误、LocalStore manifest 或可公开 Pack metadata；既有 Store `packRoot` 输出语义不变。directory 不被保存为 Registry、default 或项目配置。
- 补充目录可用性/格式失败的恢复边界、CLI protocol、英文/中文用户文档和测试。

## Capabilities

### New Capabilities

- `local-pack-directory-source`: 从显式本地目录验证、读取与安装 Pack 的 source contract。

### Modified Capabilities

- `pack-management`: install/update 扩展为 Registry release 与本地 Pack directory 两条互斥 source route，同时保持既有 replacement boundary。

## Impact

- 受影响代码：`packages/cli` 的 install/update parsing、source route、JSON schemas/error mapping、index-sync 组装与 command tests；复用 `@lorelum/engine` 的 `decodePackDirectory`。
- 受影响合同：`pack install` 与 `pack update` 的参数组合、source-specific success result 与错误恢复。
- 受影响文档：英文/中文 site Pack guide/reference，以及 maintainer-facing CLI documentation。
- 不新增 Git requirement、Registry state、project discovery、递归目录扫描、自动 watch/reinstall、LocalStore path provenance 或本地目录同步功能。
