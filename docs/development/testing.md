# 测试与验收指南

[文档首页](../README.md) · [开发环境](setup.md) · [当前验证状态](../status.md)

测试按核心逻辑、浏览器交互、原生宿主和真实服务分层。通过其中一层不能推导其他层也通过。

## 测试矩阵

| 命令 | 主要范围 | 环境和副作用 |
| --- | --- | --- |
| `npm test` | 元数据、身份、原子写入、恢复、布局、AI 协议、设置等 | Node；临时测试文件/仓库，接口替身；不需真实微信账号 |
| `npm run check` | TypeScript 类型检查 | 不生成生产产物 |
| `npm run build` | 类型检查、生产 bundle、release 同步 | 修改根目录 main.js 与 release/ |
| `npm run test:wechat-ui` | 真实工作台/排版组件、Canvas、裁剪、异步和 CSS | Chromium + Obsidian API 替身；不等于真实宿主 |
| `npm run test:publishing-ui` | 备份/诊断/传输确认窗口 | Chromium + 可控文件读取替身 |
| `npm run test:wechat-native` | 原生 Markdown、图像、布局与系统加密 | 正在运行的 Obsidian CLI；临时内存插件，测试不写笔记、不请求微信 |
| `npm run test:hexo-native` | 真实宿主与兼容博客联动 | 会创建/清理测试笔记；必须使用标记过的可丢弃博客副本 |
| `npm run test:wechat-download-native` | 宿主网络图片成功、超限、超时 | 会向测试图片源发网络请求，不请求微信草稿接口 |

入口和选项以 [package.json](../../package.json)、[run-wechat-native.mjs](../../tests/run-wechat-native.mjs) 及各测试文件为准。

## 核心测试

`tests/run-tests.mjs` 将核心测试打包，在 Node 中运行并清理临时产物。测试覆盖失败注入，不只检查正常路径。修改 IO 时应验证目标内容、备份字节和失败后的状态，不能只断言函数抛错。

新增排版保存测试在 [wechat-layout-commit-ui.mjs](../../tests/wechat-layout-commit-ui.mjs)，通过主浏览器套件执行，直接使用真实工作台回调。覆盖读取阶段和宿主元数据回调前取消、重复打开、工作台保存互斥、失败重试和历史数量，避免只测一个简化的 Modal 回调。

## 浏览器准备

安装锁定 Playwright 版本所对应的 Chromium：

```bash
node node_modules/playwright-core/cli.js install chromium
```

Linux CI 使用 `install --with-deps chromium` 安装所需系统依赖。本地已有环境不必随意修改系统软件。

macOS/Linux 运行示例：

```bash
EASYPUB_USE_BUNDLED_CHROMIUM=1 npm run test:wechat-ui
npm run test:publishing-ui
```

PowerShell 示例：

```powershell
$env:EASYPUB_USE_BUNDLED_CHROMIUM = '1'
npm run test:wechat-ui
npm run test:publishing-ui
```

`EASYPUB_CHROME_PATH` 可指定浏览器可执行文件。未启用 bundled 模式时，微信套件尝试常见本机路径；发布窗口套件默认使用匹配的 Playwright Chromium。

可选截图：`EASYPUB_UI_SCREENSHOT` 指定工作台截图文件；`EASYPUB_LAYOUT_SCREENSHOT` 指定排版截图文件，并生成窄屏版本。输出目录应已存在。截图用合成文章，审查宽度、滚动、焦点、禁用状态与错误状态，不能只看静态首页。

## 原生 Obsidian 测试

先打开独立 Sandbox Vault，并确认命令行 `obsidian` 可调用。CLI 路径可用 `OBSIDIAN_CLI` 覆盖，Vault 名称用 `EASYPUB_TEST_VAULT` 指定，默认 `Sandbox`。

```bash
EASYPUB_TEST_VAULT=Sandbox npm run test:wechat-native
```

运行器把临时测试插件装入宿主内存并在 finally 清理，不用测试构建覆盖已安装插件。仍需核对测试输出是否完整，以及当前宿主/Vault 是否正确。

Hexo 原生测试必须先阅读 [tests/hexo-native.ts](../../tests/hexo-native.ts) 的测试副本与标记要求，再设置 `EASYPUB_TEST_HEXO_REPO`；不要把真实博客目录交给该测试。网络下载测试可以通过 `EASYPUB_TEST_IMAGE_URL` 指定公开 PNG，仍须满足生产下载策略。

## 真实服务验收

真实账号、模型和平台编辑器行为不能由 mock 覆盖。明确测试范围后，用可删除的合成稿件和测试账号逐项记录：

1. 账号只读连接检查；记录宿主与代理环境，不记录密钥。
2. 创建草稿、更新同一草稿 ID、图片素材复用与双比例封面回读。
3. 远端内容有修改时取消/另建/覆盖选择；不确定结果人工恢复。
4. AI 显示目标与完整载荷，确认后请求；验证锁定与正文保真。
5. 公众号后台和手机预览分别确认标题、卡片、列表、表格、代码、图片与封面。
6. 插件重载后关联和凭据恢复；与完整应用/系统重启区分。

真实验收不默认包含群发或正式发布。不要把接口回读成功写成视觉验收成功，也不要把一种风格的验收推广到全部风格。

## 按改动选择检查

| 改动 | 必需重点 |
| --- | --- |
| 源稿身份、目标写入、备份 | 核心故障注入；相关发布窗口浏览器测试 |
| 工作台、排版弹窗、CSS | 微信浏览器测试；新异步分支必须有延迟/关闭/失败用例 |
| Markdown 渲染或图像转换 | 核心 + 浏览器 + 原生测试；影响输出时考虑真实平台复验 |
| 微信写入协议 | 模拟接口故障测试，必要时授权的测试账号验收 |
| 只有 Markdown 文档 | 相对链接、标题锚点、命令/默认值核对、Mermaid 语法和渲染检查 |

CI 当前为三系统 Node 20 核心/构建，以及 Linux 浏览器任务。CI 校验已提交产物与构建结果一致。原生测试和真实服务测试不在普通 CI 内。

## 不启动外部浏览器的工作台预览

```bash
node tests/preview-workbench.mjs
```

只监听 `127.0.0.1:4197`，使用合成正文与图片，不访问真实公众号。使用应用内浏览器访问终端显示的本机地址；提供 320px、360px 和 920px 的布局切换。停止服务使用 Ctrl+C。

`tests/hexoFormatting.test.ts` 覆盖补空行、幂等、CRLF、Front Matter 和特殊结构；`tests/publishingWorkbench.test.ts` 覆盖空状态快捷入口、固定稿件、旧读取结果丢弃，以及排版取消后的文件与备份字节。它们通过 `npm test` 执行。

`tests/attachmentImport.test.ts` 覆盖附件目录上下文、同名避让、索引延迟、图片字段自动填入、批量部分失败、关闭期间取消和磁盘错误重试；同时通过真实发布编排校验公众号封面相对路径与裁剪重置。预览页的“生成稿件并添加图片”提供本地文件选择器验收入口。

## 常驻面板稳定性原生验收

```bash
EASYPUB_TEST_VAULT=Sandbox EASYPUB_TEST_HEXO_REPO=/absolute/disposable-blog node tests/run-wechat-native.mjs --workbench
```

必须使用 `Sandbox` 和含 `.easypub-test-copy` 标记的可丢弃博客副本。临时内存加载组件，使用合成笔记与图片，不替换已安装插件或保存账号设置。覆盖附件目录与同名避让、固定面板、裁剪保存/过期/关闭、单图片解码、博客排版、备份字节与恢复；结束后清理本次创建的数据。系统文件选择器需要交互式原生验收，入口见下文。已记录的宿主结果见 [workbench-stability-native.json](../verification/workbench-stability-native.json)。

`node tests/publishing-ui.mjs --bundle-only` 仅验证浏览器模式打包，不启动浏览器；不能替代完整发布管理浏览器测试。本机禁止启动外部 Chrome/Chromium 时使用该入口，完整套件由 GitHub Actions 运行。


## 真实系统文件选择器验收

```bash
EASYPUB_TEST_VAULT=Sandbox node tests/run-wechat-native.mjs --file-picker
```

终端显示合成 PNG 路径，并在 Sandbox 打开独立验收窗口。点击“上传封面”，在真实操作系统文件对话框中选取该 PNG，再预览并确认。验收核对附件字节和属性引用并清理测试数据；不确认其他已打开的生成窗口。两分钟无操作会取消测试窗口。Mac 实测记录见 [attachment-picker-native.json](../verification/attachment-picker-native.json)。


## 性能回归夹具

`npm test` 包含 100/1,000/5,000 稿件定位、20/100/300 区块、0/5/20 JPEG、预览复用失效和控件保留断言。结果与真实宿主压力测试的区别见 [性能与交互改进记录](../performance-stabilization.md)。当前工作区要求通过应用内浏览器使用上述预览服务器，禁止启动外部 Chrome/Chromium；完整 Playwright 套件在允许的 CI 环境执行。
