# macOS 使用与迁移

EasyPub 为桌面插件，最低 Obsidian 版本为 1.5.7。Windows 与 macOS 使用同一套插件文件，无需专用构建。macOS 已加入核心测试和构建的 CI 矩阵；CI 结果不代替真实 Mac 上的 Obsidian、公众号与博客后台验收。

## 博客与历史文章

将博客仓库和 Vault 放在 Mac 本机目录后，在 EasyPub 中重新填写 Hexo 仓库绝对路径，例如 `/Users/你的用户名/blog`。不要填写 Windows 盘符或 `~/blog`。

保留文章原有 `pub_id`，不要重新生成。EasyPub 按 `pub_id` 查找已有发布稿，而不是依赖 Windows 的旧绝对路径；旧 `子文件` 引用不会在加载时批量迁移。首次更新前请核对差异窗口中的目标文件。若两台电脑同步插件 `data.json`，其中的仓库路径会互相覆盖，需要在换机后重新核对；当前没有自动的每设备设置隔离。

切换设备前先同步 Vault 和博客仓库，避免两台电脑同时发布同一篇稿件。不要把 `node_modules` 从 Windows 复制到 Mac；在博客目录安装该仓库自己的依赖。EasyPub 只运行仓库本地 Hexo，不自动下载 CLI。

## Node、Git 与终端环境

执行 Hexo 和备份 Git 检查时，插件保留已有 PATH 的优先级，并在 macOS 下补充 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin` 和系统命令目录。这覆盖常见的 Apple Silicon 与 Intel 安装位置，不运行 shell 启动脚本。

使用 nvm 等版本管理器或自定义安装位置时，需让 Obsidian 继承已激活 Node 的环境：先完全退出 Obsidian，再从 `node --version`、`git --version` 正常的终端启动应用可执行文件，例如：

```sh
/Applications/Obsidian.app/Contents/MacOS/Obsidian
```

本机 hexo-blog（核对基线 `e9151b1`）目前要求 Node 22.x 或 24.x，默认 24.18.0。EasyPub 自身的 CI Node 版本不是博客的运行要求；请以博客 `package.json` 的 `engines.node` 为准。PATH 中已有的其他 Node 版本不会被插件自动替换。

插件不会自动加载 nvm，也不会设置 Git 身份、SSH 密钥或部署凭据。请先在 Mac 终端验证博客本身能正常构建。插件部署使用非交互 Git 认证。

## Blog Control Room

部署保护根据 `admin/server.js` 和精确的 `gui: node admin/server.js` 判断，不依赖 `ManageBlog.bat`。缺少启动器不会降级为直接部署；后台文件或配置不完整时停止部署。首次先在博客目录运行 `npm ci` 安装依赖，此后直接点击 EasyPub 的“打开管理后台”。已有会话验证通过就复用；未启动时自动运行固定的 `node admin/server.js --no-open --port=0`，验证会话和状态接口后打开浏览器，无需终端窗口。

启动失败或超时会提示在终端运行 `npm run gui` 排查，不会回退到 Hexo 直接部署。服务独立在后台运行，关闭浏览器或退出 Obsidian 不会自动停止，也不会注册开机启动。

## 公众号与 PicGo

换机后重新填写 AppSecret 和可选的 PicGo Secret，不要依赖 Windows 的系统加密密文在 Mac 解密。系统加密不可用时，凭据只保留本次会话。重新检查公众号出口 IP 白名单；PicGo 未启用时无需安装它。

网络图片仍依赖 Obsidian 宿主的 Electron 流式网络接口。若宿主不支持，会明确提示使用 Vault 附件；不会退回无下载大小限制的实现。

## Mac 实机验收

在测试 Vault 与博客副本中依次验证：

1. 旧 `pub_id` 稿件被识别为更新，保留平台专有字段、图片和草稿状态。
2. 含中文、空格的目录中执行本地构建；之后再验证实际部署凭据。
3. Control Room 未启动时自动启动，连续点击不重复启动，启动后正确复用会话，失败时有明确提示。
4. 公众号预览、封面裁剪、权限切换，以及系统凭据保存和重启恢复。
5. 公网图片下载、大小限制和超时断开；最后验证真实微信草稿创建与更新。

开发者可在已启动、已启用 CLI 的 Obsidian 测试 Vault 中运行 `npm run test:wechat-native` 和 `npm run test:wechat-download-native`。通过 `OBSIDIAN_CLI` 指定 CLI 路径，通过 `EASYPUB_TEST_VAULT` 指定测试 Vault，通过 `EASYPUB_TEST_IMAGE_URL` 指定公开 PNG。原生测试不写入 Vault，也不请求微信账号。

2026-10-24 已在 Apple Silicon Mac、Obsidian Sandbox（Electron 43.7.7）、外部 Node 22.23.1 完成原生与浏览器验收。验证结果和边界见 [Mac 实机记录](macos-acceptance.md)。未验证真实公众号账号写入或生产部署。

Hexo 原生验收：将博客复制到可丢弃目录，在副本根目录创建 `.easypub-test-copy` 标记并启动后台，再运行 `EASYPUB_TEST_HEXO_REPO="/绝对路径/博客副本" npm run test:hexo-native`。此测试仅允许名为 Sandbox 的 Vault，会创建并清理专用测试笔记、博客文章和附件，并在副本执行 clean/generate。不要指向日常博客目录。
