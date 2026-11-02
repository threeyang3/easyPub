# EasyPub 文档中心

从第一篇本地稿开始，逐步了解各平台的编辑、预览和发布流程。

[项目首页](../README.md) · [下载稳定版](https://github.com/threeyang3/easyPub/releases/latest) · [1.9.4 更新说明](releases/1.9.4.md)

<a id="按任务选择入口"></a>
<a id="一概览与用户指南"></a>

## 第一次使用

| 阅读顺序 | 读完可以做什么 |
| --- | --- |
| [安装与快速开始](getting-started.md) | 安装插件，确认平台属性，生成第一篇独立本地稿 |
| [发布面板与基础排版](publishing-workbench.md) | 找到关联稿件、整理段落、选择性同步正文修改 |
| [项目概览](overview.md) | 理解原稿、平台稿、微信草稿箱与博客仓库的关系 |

> **先分清保存在哪里。**
> “生成稿件”准备本地文件，“同步草稿箱”写入微信后台，“部署”更新博客站点。它们各有独立的检查与确认流程。

## 按平台继续

### 微信公众号

[工作台指南](wechat.md) 介绍正文预览、文章信息、配图、封面与同步恢复。先试本地功能，需要同步远端草稿时再连接账号。

[主题与智能排版](wechat-layout.md) 介绍十二套本地风格、逐块调整和可选 AI；[公众号与 Hexo 联动](wechat-association.md) 介绍两种正文导出方式、“阅读原文”和正式文章链接关联。

### Hexo 博客

[发布机制](publishing.md) 介绍图片处理、元数据、本地构建与预览；[Control Room 接入](control-room.md) 介绍兼容博客的管理后台和受保护部署流程。

[macOS 使用与迁移](macos.md) 补充本地 Node、Git、博客路径与跨设备配置。图片需要使用图床时，再阅读 [PicGo 指南](picgo.md)。

### 知乎与小红书

使用[快速开始](getting-started.md#第一次生成稿件)生成本地稿，在 Obsidian 中继续编辑，再自行发布到平台。[发布机制](publishing.md)说明目录、图片与更新规则。

## 日常操作

| 任务 | 指南 |
| --- | --- |
| 从原稿找到各平台稿件 | [发布面板](publishing-workbench.md) |
| 首行空两格、段落之间加空行 | [基础排版](publishing-workbench.md#基础排版) |
| 把本稿的改动带给其他稿件 | [选择性同步正文](publishing-workbench.md#在发布稿之间同步正文改动) |
| 让公众号文章沿用一套视觉风格 | [主题与智能排版](wechat-layout.md) |
| 从公众号成稿继续生成博客稿 | [两种 Hexo 输出](wechat-association.md#从公众号稿生成-hexo-稿) |
| 更新账号、图片或遇到同步不确定状态 | [公众号工作台](wechat.md) |
| 处理错误、升级与恢复原文 | [故障排查](operations/troubleshooting.md) · [备份与恢复](operations/backup-and-recovery.md) |

<a id="二参考手册"></a>

## 参考手册

| 需要核对的内容 | 权威入口 |
| --- | --- |
| 命令 ID、显示名称和作用对象 | [命令与界面入口](reference/commands.md) |
| 默认值、作用域、凭据保存方式 | [配置参考](reference/configuration.md) |
| Front Matter、属性归属、缓存和目录 | [数据模型](reference/data-model.md) |
| 文件、网络、AI 与账号边界 | [安全与隐私](security.md) |
| 当前版本、已验证环境与限制 | [版本状态](status.md) |

<a id="三开发与维护"></a>

## 开发与维护

[开发环境](development/setup.md) → [模块架构](development/architecture.md) → [测试与验收](development/testing.md) → [贡献约定](development/contributing.md) → [版本发布](development/releasing.md)

配套博客要求见 [hexo-blog 兼容性](hexo-blog-compatibility.md)。Agent 开发约束见 [AGENTS.md](../AGENTS.md) 和 [CLAUDE.md](../CLAUDE.md)。

<a id="四运维与当前状态"></a>
<a id="五历史记录与证据"></a>

<details>
<summary>历史发布、审查与验收记录</summary>

历史记录描述当时的版本和环境，不替代当前操作指南或本次提交的验证结果。

- 发布说明：[1.9.4](releases/1.9.4.md)、[1.9.3](releases/1.9.3.md)、[1.9.2](releases/1.9.2.md)、[1.9.1](releases/1.9.1.md)、[1.9.0](releases/1.9.0.md)、[1.8.0](releases/1.8.0.md)；更早版本见 [releases/](releases/)。
- 工程审查：[性能与交互](performance-stabilization.md)、[结构与交互](architecture-review.md)、[稳定性](reliability-review.md)、[后续复核](review-followup.md)。
- 原生及服务验收：[公众号](wechat-acceptance.md)、[排版](wechat-layout-acceptance.md)、[macOS](macos-acceptance.md)及结构化摘要 [verification/](verification/)。
- [截图来源与维护](assets/screenshots/README.md)记录本组配图的版本、演示状态和用途。

验收目录不保存真实账号密钥、访问令牌、未公开文章或完整插件配置。

</details>
