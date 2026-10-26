# EasyPub

EasyPub 是桌面端 Obsidian 插件，将源笔记转换为各平台发布稿，并提供 Hexo 博客预览与公众号草稿工作台。

**[项目概览与架构图](docs/overview.md) · [完整文档](docs/README.md) · [快速开始](docs/getting-started.md)**

本次版本为 **1.8.0**，声明最低 Obsidian **1.4.4**。实际安装与验证范围见[版本状态](docs/status.md)。

## 能力与边界

| 平台 | 发布稿位置 | EasyPub 提供的后续操作 |
| --- | --- | --- |
| Hexo | 外部博客仓库的 `source/_posts`；更新时保留已有草稿位置 | 图片处理、本地构建、部署；兼容 Control Room 时进入受保护管理流程并支持文章预览 |
| 微信公众号 | Vault 内，默认 `发布/微信公众号` | 独立成稿、十二套风格、可选 AI 排版、图片和双比例封面、草稿箱创建与更新 |
| 知乎 | Vault 内，默认 `发布/知乎/文章` 或 `想法` | 生成和更新本地发布稿 |
| 小红书 | Vault 内，默认 `发布/小红书` | 生成和更新本地发布稿 |

源文章和发布稿是独立文件，通过 `pub_id` 关联。新平台稿只继承各自允许的基础属性；更新正文时保留平台稿自己的标题、标签、封面等设置。可通过“从原稿刷新平台属性（选择字段）”预览并更新指定属性。公众号已有本地稿默认只打开，正文替换需要显式操作。插件不自动将后台编辑同步回源文章，也不自动挂载外部博客文件夹。

AI 仅规划排版，不改写正文。公众号同步写入草稿箱，正式发布在微信后台完成。知乎和小红书没有自动发帖接口。详见[项目概览](docs/overview.md)。

## 安装

从 [GitHub Releases](https://github.com/threeyang3/easyPub/releases) 下载**同一版本**的 `main.js`、`manifest.json`、`styles.css`，放入 Vault 的 `.obsidian/plugins/easy-pub/`，重启 Obsidian 并启用插件。

升级前备份配置，三个安装文件一起替换；不要用其他 Vault 的 `data.json` 覆盖现有账号与草稿关联。具体步骤见[安装与升级](docs/getting-started.md)。

## 快速开始

1. 在“设置 → EasyPub”确认发布根目录；使用 Hexo 时填写博客仓库绝对路径。
2. 打开一篇测试笔记，可先执行“初始化原稿属性”；点击云图标或执行 `Publish to platform`，选择平台并确认该平台属性。
3. 更新已有稿件时核对差异。生成后打开发布稿继续编辑；公众号按向导配置账号后进入预览工作台。
4. Hexo 先检查和本地构建，再决定部署；公众号先检查预览，再同步草稿箱。自动部署默认关闭。

全部命令及界面入口见[命令参考](docs/reference/commands.md)。

## 阅读路径

- 理解文件关系：[概览](docs/overview.md) → [发布机制](docs/publishing.md) → [数据模型](docs/reference/data-model.md)。
- 使用公众号：[工作台](docs/wechat.md) → [风格与 AI 排版](docs/wechat-layout.md)。
- 使用博客：[Control Room](docs/control-room.md) → [macOS 配置](docs/macos.md)；图床可选用 [PicGo](docs/picgo.md)。
- 处理问题：[排障](docs/operations/troubleshooting.md) → [备份与恢复](docs/operations/backup-and-recovery.md)。
- 了解数据去向：[配置参考](docs/reference/configuration.md) → [安全与隐私](docs/security.md)。

## 开发

```bash
git clone https://github.com/threeyang3/easyPub.git
cd easyPub
npm ci
npm test
npm run build
```

构建执行类型检查、生成插件并同步 `release/`，不会安装到 Vault。CI 基线为 Node 20。

从[开发环境](docs/development/setup.md)开始，再阅读[模块架构与流程图](docs/development/architecture.md)、[测试指南](docs/development/testing.md)、[贡献约定](docs/development/contributing.md)及[发布流程](docs/development/releasing.md)。仓库约束见 [AGENTS.md](AGENTS.md) 与 [CLAUDE.md](CLAUDE.md)。

## 许可证

[MIT](LICENSE)
