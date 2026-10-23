# Blog Control Room 接入

EasyPub 可以发现并打开 Hexo 仓库提供的本地 Blog Control Room。该能力只负责安全地启动或复用管理后台，不把后台嵌入 Obsidian，也不代替仓库自己的源码同步、CI 和部署门禁。

## 1. 使用入口

先在“设置 → EasyPub”中填写 Hexo 仓库的绝对路径，再通过任一入口打开：

- 功能区仪表盘图标。
- 命令 `Open Hexo management console`。
- “设置 → EasyPub → 博客管理后台”。

后台未运行时，Windows 下 EasyPub 启动仓库根目录的 `ManageBlog.bat`；macOS/Linux 下提示先在博客目录的终端运行 `npm run gui`，再点击打开。已有有效会话时，直接在默认浏览器中打开。非 Windows 系统不会尝试执行 `.bat`，也不会回退为直接部署。参见 [macOS 使用与迁移](macos.md)。

如果看不到入口，请按 [README 安装说明](../README.md#安装)重新复制同一次构建生成的三个插件文件，并重载 EasyPub。

## 2. 兼容条件

只有同时满足以下条件的 Hexo 仓库才会启用 Control Room：

- 设置值是绝对路径。
- 根目录存在可读取、有效的 `package.json`。
- 存在 `admin/server.js`。
- `package.json` 中 `scripts.gui` 精确等于 `node admin/server.js`。

`ManageBlog.bat` 仅用于 Windows 自动启动，不参与部署保护的判定。服务与 GUI 命令匹配时，即使没有 `.bat`，也必须进入管理后台流程。没有启动器时先在终端运行 `npm run gui`。

发现后台文件或固定 GUI 命令但配置不完整时停止部署；配置损坏或读取失败也停止，不回退为直接部署。没有后台特征且配置可正常读取的普通 Hexo 仓库保持原有部署流程。

## 3. 部署边界

对于普通 Hexo 仓库：

- `Build Hexo locally (no deploy)` 执行本地生成。
- `Deploy to Hexo` 直接调用仓库本地 Hexo 完成部署。

对于兼容 Control Room 的仓库：

- `Deploy to Hexo` 打开管理后台。
- 开启“自动部署”后，写入 Hexo 发布稿也只打开管理后台。
- 后续检查、确认和部署由仓库自己的后台负责。

EasyPub 不绕过兼容仓库定义的 Git、CI、分支或部署保护。

## 4. 会话安全

后台在 `.blog-admin/control-room.json` 写入临时会话。以下内容仅为结构示例，端口由后台实际会话决定：

```json
{
  "version": 1,
  "pid": 1234,
  "host": "127.0.0.1",
  "port": 4173,
  "url": "http://127.0.0.1:4173/?token=<48 位随机令牌>",
  "startedAt": "2026-07-28T00:00:00.000Z"
}
```

EasyPub 复用会话前会验证：

1. 版本、进程号和端口格式。
2. HTTP 协议和 `127.0.0.1` 回环主机。
3. URL 根路径、唯一的 `token` 参数和 48 位小写十六进制令牌。
4. 带令牌请求 `/api/status`，且响应状态为 HTTP 200。

状态探测最多等待 5 秒；超时或会话失效时，Windows 且存在启动器才尝试启动，否则提示终端启动，避免一直等待后台响应。

相对地址、外部主机、额外查询参数、重复令牌和失效会话都会被拒绝。会话文件是本机临时凭证，不应提交到 Git 或复制到公开位置。

## 5. 故障排查

| 现象 | 检查与处理 |
|------|------------|
| 提示仓库不兼容或配置不完整 | 核对绝对路径、`package.json`、`admin/server.js` 和精确的 `scripts.gui` |
| 点击后没有打开 | 在博客目录运行 `npm run gui` 查看启动错误；Windows 也可运行现有的 `ManageBlog.bat` |
| 提示端口占用 | 关闭旧后台进程，再重新打开 |
| 会话文件存在但无法复用 | 关闭残留进程并重新启动后台 |
| 部署命令只打开后台 | 这是兼容仓库的预期保护行为，请在后台继续 |
| 普通仓库直接部署 | 这是非兼容仓库的预期行为；需要保护流程时补齐兼容条件 |

## 6. 开发验证

修改 Control Room 接入后执行：

```bash
npm test
npm run build
```

测试应覆盖绝对路径、固定 GUI 脚本、回环 URL、唯一令牌、会话读取、状态探测以及外部 URL 拒绝。
