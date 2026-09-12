# CLI 首次发布与安装方案

状态：**已确认，关联 #105；已实现 macOS arm64 的本地构建、打包和安装基础。** 日期：2026-09-11。

建议按平台发布一个包含 `lore`、native runtime 和许可证的压缩包，再提供 `install.sh` 自动下载安装。模型继续在 `lore model load` 时按需下载。用户不需要安装 Bun、Node.js、npm、CMake 或编译工具，也不需要 sudo。

仓库尚未发布 CLI，本方案从首次交付开始设计。首批只交付通过真实运行验收的 macOS arm64；Windows 的 PowerShell 安装入口随 Windows runtime 验收一起交付，不能只编译出 `lore.exe` 就宣称支持 Windows。

## 已确认的现状

- [`build:cli`](../../package.json) 用 Bun compile 生成 `dist/lore`，当前本机构建约 60 MB；它没有把 `dist/native` 自动带入产物。仓库和 CI 已锁定 Bun 1.4.2；它的 compiled executable 默认自动读取当前目录的 `.env` 和 `bunfig.toml`，而现有 backend 会读取指定的 `LORELUM_BACKEND_*` 环境变量。这会让用户所在目录意外影响 Lorelum 配置。
- [`build-embedding.ts`](../../scripts/native/build-embedding.ts) 独立构建带父进程退出补丁的 CPU-only `llama-server`，输出到 `dist/native/darwin-arm64/`，同时生成许可证、第三方声明和 manifest。当前 native 可执行文件约 12.6 MB；这些是未压缩的本机参考值，发布包大小必须实测。
- [`embedding-resources.ts`](../../packages/backend/src/runtime/embedding-resources.ts) 在编译模式下从 `process.execPath` 所在目录寻找 `native/<platform>-<arch>`，要求磁盘 manifest 与 CLI 编入的固定 manifest 完全相等，再验证文件大小、SHA-256 和使用前未被替换。当前只接受 darwin-arm64。
- [`模型交付方案`](./model-delivery-and-api-design.md) 已实现进程内 got 下载：固定 Hugging Face revision 的 Q4_0 模型为 66,345,216 bytes，支持续传和摘要校验。安装器无须再次实现模型下载。
- [`@lorelum/config`](../../packages/config/src/paths/lorelum.ts) 已独立管理 `~/.lorelum/config.yaml`。运行状态、模型缓存和 Store 不属于安装包。
- [后续 backend 设计](./local-backend-stage-2-design.md) 记录了 Windows native 与端到端交付尚未完成。当前 macOS 构建参数包含 macOS 13.3 和 CPU 指令要求；它们是验收输入，不能代替最低系统和硬件的实际支持证明。

## 为什么选平台压缩包

打包内容和安装入口是两个决定：`install.sh` 可以下载任何一种包，它本身不解决 runtime 的配套和校验问题。

| 方案 | 用户实际得到什么 | 主要代价 | 当前判断 |
| --- | --- | --- | --- |
| CLI、native、许可证放在同一平台包 | 下载、解压后即有执行代码，模型按需下载 | 每次下载安装都包含 native | **推荐**；约 12.6 MB native 换取完整、配套的执行环境 |
| native 嵌入 CLI，启动时释放 | 表面只有一个文件，运行时仍需 native 落盘执行 | 增加释放目录、并发写入、权限与清理逻辑，许可证仍需可取得 | 当前没有必须只分发单文件的需求，暂不选 |
| CLI 首次使用时动态下载 native | 初始 CLI 更小 | 首次运行多一个联网故障点，增加 native 下载、缓存及版本绑定机制 | 节省有限；已有 native 与 CLI 强绑定，暂不选 |
| CLI、native、模型全部放进包 | 模型加载也无需联网 | 增加约 66.35 MB 下载，即使只用 keyword 也必须取得模型 | 先保留现有模型按需下载；有明确离线交付需求后再设计 |

安装器只负责平台识别、下载、校验、解压和入口设置，不安装系统依赖。首次发版先提供可手动解压的同一压缩包；`install.sh` 是降低安装步骤的便利入口，不另造一套产物。

## 发布包与安装过程

建议 Unix 产物命名为 `lore-<version>-darwin-arm64.tar.gz`，目录内容如下。当前 CLI 从 `packages/cli/package.json` 读取 `toolVersion`，值为 `0.0.0`；发布实现应以该版本为唯一来源，让发布 tag、安装目录、包名和 CLI 输出一致，不另设一份可能漂移的版本。首次版本号由 Owner 确定。

```text
lore-<version>-darwin-arm64/
  lore
  LICENSE
  THIRD_PARTY_NOTICES.txt
  native/darwin-arm64/
    llama-server
    manifest.json
    LICENSE.*
    THIRD_PARTY_NOTICES.txt
```

根目录声明覆盖 Lorelum、编入 CLI 的运行时和实际随包分发的依赖；native 子目录沿用现有声明。发布前根据最终包补齐许可证归属，不把“编译进去了”当作无需声明的理由。根目录 `LICENSE` 复制现有内容，不修改许可证。

建议安装到 `~/.local/share/lorelum/versions/<version>/`，由 `~/.local/bin/lore` 指向该版本内的真实 `lore`。版本目录只容纳安装资源，配置仍由 `@lorelum/config` 按原规则管理。手动安装也必须保留整个相邻 `native` 目录，不能只复制 `lore`。

安装器无参数时安装 GitHub 上最新的稳定 Release；`--version <version>` 固定安装指定版本，适用于复现或安装预发布版本。两种路径都下载同一份版本化 archive 和校验清单。安装器按以下顺序执行：

1. 识别系统、架构和发布支持条件，不支持时在下载前明确退出。检查下载工具、解压工具、SHA-256 工具和目标目录写权限；Unix 可使用 curl 或 wget，缺少时给出手动下载路径，不静默安装工具。
2. 无参数时从 GitHub Releases 的 latest 接口读取 tag，并只接受合法的语义化版本；随后从 API 返回的精确 tag 下载资产。显式版本则直接验证输入并使用约定的 `v<version>` tag。发布页同时提供 SHA-256 清单和手动安装说明；下载失败或摘要不符时不执行包内文件。
3. 下载到安装根目录内的临时目录，验证摘要并限制解压路径，拒绝越出临时目录的条目、意外符号链接和不符合预期的包布局。
4. 校验完整布局、执行权限和版本信息后，将目录移到最终版本位置，再通过同目录临时链接与 rename 切换 `~/.local/bin/lore`。下载、解压或检查失败均不得留下一个指向半成品的命令入口。
5. 输出安装位置及 PATH 设置方法；不自动修改 shell 启动文件。入口已存在且不属于此次安装目录时退出并说明冲突，不覆盖其他工具或开发入口。同版本内容一致时重复执行可直接成功，内容不一致则拒绝覆盖。

首次安装完成后，用户可执行：

```sh
sh install.sh
sh install.sh --version 0.1.0
lore --help
lore backend start
lore model load
lore model status
```

安装不自动启动常驻后端或下载模型。运行时模型下载继续使用 CLI 内的 got，不需要 curl；安装前的 shell 下载阶段则尚无可用 CLI，因此允许使用系统下载工具，这两个依赖边界不同。

必须增加从符号链接启动的真实验证，并将资源定位明确为 `dirname(await realpath(process.execPath))` 后的相邻目录。不能假定每个运行平台都会把 `process.execPath` 解析为同一种路径形式。

安装脚本只负责落盘程序和设置命令入口，不管理 daemon。显式执行 `backend start` 时才使用现有的实例身份和端口检查。当前实现不加入自动升级、后台更新服务或历史版本迁移逻辑。

## 构建必须绑定同一批字节

当前 native 脚本生成新的磁盘 manifest，而 backend runtime 保留一份开发模式使用的 manifest。CI 编译器、工具链标签或文件字节可能不同；只按“构建 native，再执行现有 build:cli”操作，并不能保证生成可运行的发布包。

建议保留现有严格运行时验证，调整构建输入的交接：

```ts
// 仅构建脚本内部的交接示意；不新增用户可配置的 native 路径。
type VerifiedNativeBuild = {
  target: "darwin-arm64";
  directory: string;
  manifestPath: string;
};
async function buildAndVerifyNative(): Promise<VerifiedNativeBuild>;
async function compileCli(native: VerifiedNativeBuild, output: string): Promise<void>;
async function packageRelease(cli: string, native: VerifiedNativeBuild): Promise<string>;
```

native 构建脚本拥有源码 revision、补丁、编译参数、工具链记录和文件摘要。构建验证必须先核对固定 recipe 输入、实际动态依赖和 native 行为，再把本次生成的 manifest 作为 CLI 编译输入；不能接受一个任意磁盘 manifest 后仅凭它自己的 hash 自证可信。

CLI 构建脚本通过构建专用生成模块绑定该 manifest；发布构建缺少输入时失败，不退回本机历史产物。该生成模块留在临时构建目录，不把每次 CI 的文件摘要回写到源码。源码开发继续使用明确的开发产物输入，发布产物必须经过上述绑定路径。

发布专用的 Bun compile 还必须传入 `--no-compile-autoload-dotenv` 和 `--no-compile-autoload-bunfig`。这不会取消调用者显式传入的环境变量：shell、launchd 或 CI 仍可设置已经约定的 `LORELUM_BACKEND_*` 值；它只禁止 executable 根据调用目录自动发现额外配置文件。`~/.lorelum/config.yaml` 继续是文件配置来源。发布验收要在含无关 `.env` 与 `bunfig.toml` 的工作目录运行，证明其不能改变 Lorelum 行为。

打包脚本只收集这次构建的 CLI、native 和许可证，保留可执行权限，生成最终 archive SHA-256。若采用签名，顺序必须是：签 native，再生成 manifest 和 hash，再把该 manifest 编入 CLI，然后签 CLI，最后完成公证相关处理并计算最终 archive 摘要。任何改变受校验文件字节的处理都必须发生在对应摘要生成之前；最后用解压后的成品重跑加载与校验。

发布渠道是下载信任起点：固定仓库的 HTTPS Release 页面及其资产提供包与清单。清单可检测下载损坏，不能独立证明发布账户未受侵害；当前实现不自建签名平台。macOS 首发前必须实际检查浏览器下载后的 Gatekeeper 行为，并据结果确定签名/公证要求，不能把建议关闭系统安全检查当作安装流程。

## Draft 验证最终资产，不重新构建

构建和公开是两个不可混淆的操作。首次发行前由人工触发的构建流程创建 GitHub draft Release；完成安装验收后，Owner 直接在 GitHub 页面公开同一份 draft。构建只接受明确的版本和源码 commit，并先验证 `packages/cli/package.json` 的版本、tag、包名、CLI `--version` 输出一致。

draft 至少包含以下同一批构建输出：

```text
lore-<version>-darwin-arm64.tar.gz
SHA256SUMS
release-metadata.json
```

`release-metadata.json` 记录版本、目标平台、源码 commit、Bun 版本、native `buildIdentity`、native manifest 摘要、CLI 摘要和 archive 摘要。它不是新的运行时配置，也不替代包内 manifest；它用于让发布者和验收者判断“这个 draft 究竟来自哪次构建”。构建日志和集成测试输出保留为 CI artifact，不混入用户安装包。

安装验收必须下载 draft 中的 archive，并记录 release id、target commit、三项资产名和 `SHA256SUMS` 的复算结果。Owner 在 GitHub 页面点击 Publish 前再次核对这些值；Publish 只改变 draft 状态，不重新编译或上传替代文件。这既避免“测试的是 A、发布的是 B”，也不需要在尚未发布的项目中虚构升级、迁移或回滚协议。

## 代码归属

沿用现有 Bun 构建能力、native 构建脚本、平台压缩工具和 GitHub Releases。首版增加少量组合脚本，避免引入负责多包发布的框架；如果后续确实要同时维护多个包管理器渠道，再评估统一发行工具。

| 位置（拟新增或调整） | 责任 |
| --- | --- |
| `scripts/native/build-embedding.ts` | 构建、验证 native 并输出本次产物清单 |
| `scripts/release/build.ts` | 读取唯一版本和目标平台，编排 native 验证、清单绑定、CLI 编译 |
| `scripts/release/package.ts` | 收集完整安装目录、许可证、打包并生成 archive 校验值 |
| `install.sh` | 仓库根目录的公开 Unix 安装入口：无 Bun 前提下下载、校验、解压、设置用户命令入口 |
| `.github/workflows/release-draft.yml` | 手动构建指定源码、做成品验收并创建可核验的 draft Release |
| `packages/backend/src/runtime/embedding-resources.ts` | 按真实 CLI 路径定位配套文件，保留运行时完整性校验 |

根目录的 `install.sh` 是用户发现和执行的稳定入口；构建、归档和 CI 专用逻辑继续放在 `scripts/release/`，不把下载实现复制到两个目录。`install.ps1` 在 Windows 运行链完成后同样放在仓库根目录；当前不增加无法兑现的 Windows 入口。config 层只管理用户设置，native 来源与版本由发布构建确定，不把可执行程序 URL 开放成普通 config。

## 首批交付与验收

| 工作项 | 可观察的完成标准 |
| --- | --- |
| 1. 绑定构建产物 | 干净构建目录产出 CLI 与 native；CLI 编入的 manifest 与包内一致。替换 native 或 manifest 后加载明确失败；native 的实际动态依赖只在审查过的 macOS 系统库允许范围内；CI 工具链变化能产生自洽的新产物 |
| 2. 产出平台包 | 无 Bun、npm、CMake 和源码的受支持 macOS arm64 环境中，解压即可启动后端、下载模型并达到 ready；动态依赖只来自声明的系统范围，包内许可证齐全 |
| 3. 提供安装入口 | 空安装目录、重复安装、路径含空格、PATH 未设置、已有同名入口、下载中断、摘要错误、解压失败均有明确结果；失败不留下半安装入口；通过符号链接仍能加载 native；调用目录的 `.env` 与 `bunfig.toml` 不能改变 Lorelum 配置 |
| 4. 验证生命周期和分发体验 | 安装后的 CLI 可正常 start/status/stop；模型下载续传、摘要检查和 native 父进程退出回归通过；安装不自动启动 daemon 或下载模型；浏览器下载的包在真实 macOS 安全策略下完成安装 |
| 5. 建立手动发布流程 | 经单独授权后新增手动触发的 CI：固定源码和版本生成 draft Release，记录包大小、SHA、工具链、测试结果及支持范围。验收从 draft 下载并复核资产与 target commit；Owner 审查后在 GitHub 页面公开同一批已验证资产 |

当前交付完成 macOS arm64 的本地构建、归档和安装验收。Windows 后续沿用同一平台包责任划分，提供 ZIP 与 PowerShell 下载入口，但必须先完成 native 构建、进程身份与退出管理、文件校验及干净 Windows 环境验收；Linux 和 Intel Mac 也按同样证据要求决定是否发布，不因 Bun 能交叉编译而直接列入支持矩阵。

本设计对应已存在的 #105。本 PR 实现不触及 GitHub Release 的本地成品构建与安装验收；手动 draft workflow 和真正公开发布尚未单独规划或实现。修改 release workflow 和公开发布分别遵守仓库明确的授权边界。

## 参考依据

- [Bun 独立可执行文件文档](https://github.com/oven-sh/bun/blob/main/docs/bundler/executables.mdx)：编入运行时和导入依赖；资源内嵌得到 Bun 虚拟文件路径，不能据此假定任意 native 文件自动打包、自动执行。实现以仓库固定的 Bun 1.4.2 为准。
- [uv 官方安装入口](https://github.com/astral-sh/uv#installation)：同一产品分别提供 Unix shell 与 Windows PowerShell 安装入口，是本方案区分安装脚本和实际程序包的参考。
- [cargo-dist 的构建与分发职责](https://github.com/axodotdev/cargo-dist#building)：归档、安装器与发布编排可交给现成工具；当前只有一个平台及现有自定义 native 构建，不直接引入完整发行框架。
