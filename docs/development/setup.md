# 开发环境与仓库结构

[文档首页](../README.md) · [架构](architecture.md) · [测试](testing.md) · [贡献约定](contributing.md)

## 获取和构建

CI 当前使用 Node.js 20，在 Linux、Windows、macOS 执行核心测试和构建。请使用支持当前锁文件和依赖的 Node/npm 环境；CI 配置见 [.github/workflows/build.yml](../../.github/workflows/build.yml)。

```bash
git clone https://github.com/threeyang3/easyPub.git
cd easyPub
npm ci
npm test
npm run build
```

`npm ci` 按 package-lock.json 安装。生产依赖包括 gray-matter 和 mdast-util-from-markdown；Obsidian、Electron 与 Node 内置模块由运行环境提供。不要在用户发布流程中隐式下载安装 Hexo CLI。

## 仓库地图

```text
main.ts                   生命周期、命令和发布编排
settings.ts / types.ts    配置 UI 与公共类型
modals/                   确认、配置、诊断、恢复和排版窗口
views/                    公众号工作台与 Hexo 预览
utils/                    存储、身份、图片、渲染和远端协议
styles.css                插件界面样式，按根容器隔离
tests/                    核心、浏览器和原生宿主测试
docs/                     用户、开发、运维与历史证据
.github/workflows/        跨平台构建和浏览器 CI
main.js                   已提交的生产构建产物
release/                  同次构建的手动安装文件
manifest.json             Obsidian 插件清单
versions.json             发布版本到最低宿主版本的映射
esbuild.config.mjs        打包及产物复制
version-bump.mjs          从 package.json 同步版本元数据
```

源文件不在 `src/` 下；不要只搜索该目录而漏掉根目录代码。构建产物需提交，但应修改源文件后生成，不能手改 main.js。

## 本地开发循环

```bash
npm run dev
```

监听模式生成带内联 source map 的根目录 main.js，不执行完整 TypeScript 检查，也不自动同步 release/ 或安装到 Vault。另行执行 `npm run check`；提交前运行 `npm test` 和 `npm run build`。

开发安装使用独立 Sandbox Vault，备份其 `data.json`，结束忙碌任务后复制生产构建的三个文件并重载。不要把生产 Vault 目录映射为构建输出；测试与业务数据应分开。

## 关键构建行为

生产构建先 `tsc -noEmit`，再 esbuild 打包为 CommonJS、目标 ES2018、压缩且不生成 source map。Obsidian/Electron 等外部模块不会被打入 bundle。构建将 main.js、manifest.json、styles.css 和 LICENSE 复制到 release/。

包版本、插件 manifest 版本、versions.json 和 release/manifest.json 需要一致；具体步骤见[发布流程](releasing.md)。设置声明 desktop-only，不能因为纯函数测试能在浏览器运行就宣称支持移动端。

## 调试与诊断

在测试 Vault 中重现，记录命令、绑定稿路径、预期与实际状态、插件 commit/版本和 Obsidian 版本。日志中避免记录完整设置、请求 Authorization、AppSecret、AI Key 和未公开正文。分享截图前检查文章标题、路径与账号信息。

为浏览器测试选择安装的浏览器或匹配的 Playwright Chromium，参见[测试指南](testing.md)。不要用模拟宿主测试结果替代真实 Obsidian 或真实微信验收。
