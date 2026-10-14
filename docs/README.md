# EasyPub 文档

本文档目录按“先完成基本发布，再配置可选能力”的顺序组织。

## 用户阅读顺序

1. [项目首页与快速开始](../README.md)：安装插件、填写最少配置并完成第一次发布。
2. [发布机制与平台行为](publishing.md)：了解目标路径、更新规则、Front Matter、Hexo 构建与部署。
3. [PicGo 图片上传](picgo.md)（可选）：需要把本地图片转换为网络链接时阅读。
4. [Blog Control Room 接入](control-room.md)（可选）：Hexo 仓库提供兼容管理后台时阅读。

## 开发者入口

- [CLAUDE.md](../CLAUDE.md)：代码结构、核心不变量和发布约束。
- [AGENTS.md](../AGENTS.md)：自动化开发必须遵守的简明规则。
- [稳定性审查记录](reliability-review.md)：本轮修复、故障注入和 Obsidian 宿主验证的范围与限制。

## 文档职责

| 文档 | 主要受众 | 内容边界 |
|------|----------|----------|
| `README.md` | 初次使用者 | 安装、快速开始、命令和文档入口 |
| `docs/publishing.md` | 日常使用者 | 发布流程、平台差异、元数据和 Hexo 行为 |
| `docs/picgo.md` | PicGo 使用者 | 图床配置、安全边界和排障 |
| `docs/control-room.md` | 兼容 Hexo 仓库使用者 | 后台发现、会话安全和部署边界 |
| `CLAUDE.md` / `AGENTS.md` | 开发者与自动化工具 | 实现约束，不重复用户操作指南 |
