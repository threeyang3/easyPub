# hexo-blog 兼容性核对

2026-10-23 核对本机 `E:\Develop\hexo-blog`，基线 `e9151b1`。本轮只读取博客源码，未改写文章、启动后台、拉取源码或执行部署。

| 接口或行为 | 核对结果 |
| --- | --- |
| GUI 入口 | `node admin/server.js` 保持不变；Windows 启动器仍为 `ManageBlog.bat` |
| 会话 | `.blog-admin/control-room.json`，version 1、127.0.0.1、端口和 URL，48 位十六进制 token；与 EasyPub 解析一致 |
| 状态检查 | GET `/api/status` 仍接受 token 查询参数，旧会话复用方式兼容 |
| 源码同步 | 文章、草稿、`source/picture/**` 可由后台受管同步；EasyPub 的内容哈希图片位于该范围 |
| 顶部图 | `top_img` 支持图片字符串及布尔 false；源稿没有此字段时保留后台值，显式设置时遵循源字段优先规则 |
| 后台字段 | `cover`、`description`、`workflow` 和 `password_secret` 等平台字段继续保留，新增回归测试 |
| 加密引用 | `password_secret` 需匹配 `BLOG_ENCRYPTION_[A-Z0-9_]+`；EasyPub 在准备发布稿时拒绝非法引用，不读取真实密码 |
| Node | 博客要求 22.x / 24.x，默认 24.18.0；迁移时需确认 Obsidian 所继承的 Node 环境 |

新增的源码同步、远端检查、后台重启要求和部署门禁由 Blog Control Room 负责。EasyPub 只打开经过认证检查的后台，不自动调用源码拉取、提交、推送或部署 API，也不把 `/api/status` 的成功视为部署许可。

受保护仓库的发现不再依赖 Windows 启动器；服务与固定 GUI 命令存在即进入后台流程。配置不完整或读取失败时停止部署。博客自身 `docs/integrations/easypub.md` 仍描述必须存在 `.bat` 的旧发现条件，应在博客后续维护时更新；本轮未修改该仓库。

验证范围：本地核心测试、字段合并与部署回退回归测试、TypeScript 和构建。真实 Mac Obsidian、后台拉取后的重启行为及生产部署未在本轮执行。
