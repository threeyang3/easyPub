# EasyPub 文档中心

[项目首页](../README.md) · [项目概览与架构图](overview.md) · [版本与验证状态](status.md)

文档描述当前代码分支；稳定 Release 与待发布改进请先看[状态说明](status.md)。历史审查记录提供过程证据，不作为当前操作步骤。目录保留原有指南地址，已有链接仍可使用。

## 按任务选择入口

| 你的目标 | 推荐阅读顺序 |
| --- | --- |
| 理解项目、稿件存放位置和职责 | [项目概览](overview.md) → [数据模型](reference/data-model.md) |
| 安装并生成第一篇稿件 | [快速开始](getting-started.md) → [发布机制](publishing.md) |
| 使用公众号 | [公众号工作台](wechat.md) → [主题与 AI 排版](wechat-layout.md) |
| 使用博客预览或后台 | [发布机制](publishing.md) → [Control Room 接入](control-room.md) |
| 处理报错、迁移或恢复 | [排障](operations/troubleshooting.md) → [备份与恢复](operations/backup-and-recovery.md) |
| 修改插件源码 | [开发环境](development/setup.md) → [架构设计](development/architecture.md) → [测试](development/testing.md) |
| 发布插件新版本 | [贡献约定](development/contributing.md) → [发布流程](development/releasing.md) |

## 一、概览与用户指南

- [项目概览与总体架构图](overview.md)：定位、能力矩阵、数据边界、文件目录和典型工作流。
- [安装、升级与快速开始](getting-started.md)：桌面环境、首次配置、生成稿件和升级注意事项。
- [发布机制与平台行为](publishing.md)：身份、差异、字段合并、图片、Hexo 构建与预览。
- [发布面板与跨稿同步](publishing-workbench.md)：发布稿之间选择正文改动或新增配图、冲突预览、Hexo 原生编辑。
- [微信公众号工作台](wechat.md)：独立本地稿、账号、预览、图片、封面及远端同步。
- [公众号主题与智能排版](wechat-layout.md)：十二套风格、AI 请求确认、区块调整和应用。
- [PicGo 图片上传](picgo.md)：可选图床流程、缓存和凭据处理。
- [Blog Control Room 接入](control-room.md)：兼容条件、会话、启动与部署保护。
- [macOS 使用与迁移](macos.md)：Node/Git 环境、跨设备路径及宿主注意事项。

## 二、参考手册

- [命令与界面入口](reference/commands.md)：全部命令 ID、显示名称、作用对象和副作用。
- [配置参考](reference/configuration.md)：默认值、作用域、凭据保存与设置恢复。
- [数据模型与目录](reference/data-model.md)：Front Matter 所有权、稳定标识、排版方案和缓存。
- [安全与隐私边界](security.md)：文件、网络、AI、凭据及已知限制。

## 三、开发与维护

- [开发环境和仓库结构](development/setup.md)
- [模块架构与流程图](development/architecture.md)
- [测试与验收指南](development/testing.md)
- [贡献与文档维护约定](development/contributing.md)
- [版本发布流程](development/releasing.md)
- [AGENTS.md](../AGENTS.md)、[CLAUDE.md](../CLAUDE.md)：仓库开发约束与关键不变量。

## 四、运维与当前状态

- [故障排查](operations/troubleshooting.md)
- [备份、恢复与迁移](operations/backup-and-recovery.md)
- [版本与验证状态](status.md)
- [配套 hexo-blog 兼容性](hexo-blog-compatibility.md)

## 五、历史记录与证据

以下文档按当时环境记录，不把一次通过推广为所有版本、系统或账号都通过：

| 记录 | 内容 |
| --- | --- |
| [性能与交互改进](performance-stabilization.md) | 1.9.0 基线热路径优化、调用次数回归与验证边界 |
| [结构与交互审查](architecture-review.md) | 当前结构优化、排版异步取消与互斥修复 |
| [稳定性审查](reliability-review.md) / [后续复核](review-followup.md) | 身份、备份、原子写入和恢复的演进 |
| [公众号验收](wechat-acceptance.md) | 各轮自动化及真实账号测试 |
| [排版验收](wechat-layout-acceptance.md) | AI、风格、冲突及后台/手机反馈 |
| [macOS 验收](macos-acceptance.md) | Mac 环境和兼容后台专项证据 |
| [1.6.3](releases/1.6.3.md)、[1.6.4](releases/1.6.4.md)、[1.7.0](releases/1.7.0.md)、[1.7.1](releases/1.7.1.md)、[1.7.2](releases/1.7.2.md)、[1.7.3](releases/1.7.3.md)、[1.8.0](releases/1.8.0.md)、[1.9.0](releases/1.9.0.md)、[1.9.1](releases/1.9.1.md) | 各稳定版本发布说明 |

结构化验收摘要保存在 [verification/](verification/)。不要向该目录提交真实账号密钥、访问令牌、未公开文章或完整插件配置。
