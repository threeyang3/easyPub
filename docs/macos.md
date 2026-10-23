# macOS 使用与迁移

EasyPub 为桌面插件，最低 Obsidian 版本为 1.4.4。Windows 与 macOS 使用同一套插件文件，无需专用构建。macOS 已加入核心测试和构建的 CI 矩阵；CI 结果不代替真实 Mac 上的 Obsidian、公众号与博客后台验收。

## 博客与历史文章

将博客仓库和 Vault 放在 Mac 本机目录后，在 EasyPub 中重新填写 Hexo 仓库绝对路径，例如 `/Users/你的用户名/blog`。不要填写 Windows 盘符或 `~/blog`。

保留文章原有 `pub_id`，不要重新生成。EasyPub 按 `pub_id` 查找已有发布稿，而不是依赖 Windows 的旧绝对路径；旧 `子文件` 引用不会在加载时批量迁移。首次更新前请核对差异窗口中的目标文件。若两台电脑同步插件 `data.json`，其中的仓库路径会互相覆盖，需要在换机后重新核对；当前没有自动的每设备设置隔离。

切换设备前先同步 Vault 和博客仓库，避免两台电脑同时发布同一篇稿件。不要把 `node_modules` 从 Windows 复制到 Mac；在博客目录安装该仓库自己的依赖。EasyPub 只运行仓库本地 Hexo，不自动下载 CLI。

## Node、Git 与终端环境

执行 Hexo 和备份 Git 检查时，插件保留已有 PATH 的优先级，并在 macOS 下补充 `/opt/homebrew/bin`、`/usr/local/bin` 和系统命令目录。这覆盖常见的 Apple Silicon 与 Intel 安装位置，不运行 shell 启动脚本。

使用 nvm 等版本管理器或自定义安装位置时，需让 Obsidian 继承已激活 Node 的环境：先完全退出 Obsidian，再从 `node --version`、`git --version` 正常的终端启动应用可执行文件，例如：

```sh
/Applications/Obsidian.app/Contents/MacOS/Obsidian
```

插件不会自动加载 nvm，也不会设置 Git 身份、SSH 密钥或部署凭据。请先在 Mac 终端验证博客本身能正常构建。插件部署使用非交互 Git 认证。

## Blog Control Room

兼容仓库的发现条件和部署保护保持不变，包括仓库保留 `ManageBlog.bat`。macOS 不执行这个 Windows 启动器。先在博客目录运行 `npm run gui` 并保持终端开启，再点击 EasyPub 的“打开管理后台”；插件验证本机会话和状态接口后打开浏览器。

后台未运行时会给出上述操作提示，不会自动回退到 Hexo 直接部署。博客后台自身是否支持 macOS，需要在该博客仓库独立验证。

## 公众号与 PicGo

换机后重新填写 AppSecret 和可选的 PicGo Secret，不要依赖 Windows 的系统加密密文在 Mac 解密。系统加密不可用时，凭据只保留本次会话。重新检查公众号出口 IP 白名单；PicGo 未启用时无需安装它。

网络图片仍依赖 Obsidian 宿主的 Electron 流式网络接口。若宿主不支持，会明确提示使用 Vault 附件；不会退回无下载大小限制的实现。

## Mac 实机验收

在测试 Vault 与博客副本中依次验证：

1. 旧 `pub_id` 稿件被识别为更新，保留平台专有字段、图片和草稿状态。
2. 含中文、空格的目录中执行本地构建；之后再验证实际部署凭据。
3. Control Room 未启动时提示手动启动，启动后正确复用会话。
4. 公众号预览、封面裁剪、权限切换，以及系统凭据保存和重启恢复。
5. 公网图片下载、大小限制和超时断开；最后验证真实微信草稿创建与更新。

开发者可在已启动、已启用 CLI 的 Obsidian 测试 Vault 中运行 `npm run test:wechat-native` 和 `npm run test:wechat-download-native`。通过 `OBSIDIAN_CLI` 指定 CLI 路径，通过 `EASYPUB_TEST_VAULT` 指定测试 Vault，通过 `EASYPUB_TEST_IMAGE_URL` 指定公开 PNG。原生测试不写入 Vault，也不请求微信账号。

截至本次改动，本地验证环境仍为 Windows；尚未声称通过 Mac 实机验收或新的远端 CI。
