# Blog Control Room 接入指南

EasyPub 可以从 Obsidian 打开兼容 Hexo 仓库提供的本地管理后台。该能力只负责发现或
启动后台，不把后台嵌入 Obsidian，也不会绕过博客仓库自己的源码同步、CI 或部署门禁。

## 用户使用

### 安装或更新 EasyPub

1. 执行 `npm ci` 和 `npm run build`。
2. 把 `release/main.js`、`release/manifest.json`、`release/styles.css` 复制到 Vault 的
   `.obsidian/plugins/easy-pub/`。
3. 在 Obsidian“设置 → 第三方插件”中关闭再启用 EasyPub，或重启 Obsidian。
4. 在“设置 → EasyPub”填写 Hexo 仓库的绝对路径。

只修改 TypeScript 源码而不重新构建、只更新插件目录中的部分文件，都会导致 Obsidian
继续运行旧代码。三个发布文件应始终来自同一次 `npm run build`。

### 打开管理后台

可以使用任一入口：

- 左侧功能区的仪表盘图标。
- 命令面板中的 `Open Hexo management console`。
- “设置 → EasyPub → 博客管理后台”的“打开管理后台”按钮。

首次打开时，EasyPub 会启动博客仓库根目录的 `ManageBlog.bat`，管理后台随后在默认
浏览器中打开。后台已经运行时，EasyPub 会先验证本机会话，再直接打开现有页面，避免
重复占用 4173 端口。

## 兼容仓库约定

EasyPub 只把同时满足以下条件的目录识别为兼容的 Blog Control Room：

- 设置值是绝对路径。
- 根目录存在 `package.json` 和 `ManageBlog.bat`。
- 存在 `admin/server.js`。
- `package.json` 中的 `scripts.gui` 必须精确等于 `node admin/server.js`。

不满足条件时，“打开管理后台”会给出错误；普通 Hexo 构建和部署能力仍按原流程工作。

## 会话发现协议

后台启动后，在被 Git 忽略的 `.blog-admin/control-room.json` 写入运行时信息：

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

EasyPub 在打开该地址前会执行以下检查：

1. 会话版本、进程号和端口格式有效。
2. 协议只能是 HTTP，主机只能是 `127.0.0.1`。
3. URL 只能包含一个 `token` 参数，令牌必须是 48 位小写十六进制。
4. 请求带令牌的 `/api/status`，只有 HTTP 200 才复用会话。

外部域名、相对路径、额外查询参数、重复令牌、无效端口和失效会话都会被拒绝。令牌只是
本次本机进程的临时访问凭证，不是博客文章密码；会话文件不得提交或复制到公开位置。

## 部署行为

对于普通 Hexo 仓库，`Deploy to Hexo` 仍使用仓库本地安装的 Hexo，依次执行
`clean`、`generate --bail` 和 `deploy`。

对于兼容的 Blog Control Room 仓库：

- `Deploy to Hexo` 改为打开管理后台。
- 开启“自动部署”后，生成 Hexo 发布稿也只会进入管理后台，不会静默部署。
- 用户必须在后台完成受管源码选择、`SYNC SOURCE`、GitHub Actions 对齐和仓库规定的
  Pages 部署确认。

这样可以保留博客仓库的 `predeploy`、CNAME、固定远端和分支保护。

## 故障排查

| 现象 | 检查与处理 |
|------|------------|
| 没有仪表盘图标或命令 | 确认三份插件文件来自最新 `release/`，然后重载 EasyPub |
| 提示未提供兼容后台 | 核对 Hexo 绝对路径、三个兼容文件及精确的 `scripts.gui` |
| 点击后没有打开 | 手工双击博客仓库的 `ManageBlog.bat`，查看命令窗口中的启动错误 |
| 4173 端口已占用 | 关闭旧的 Blog Control Room 命令窗口，再重新打开 |
| 会话文件存在但无法复用 | 会话可能来自异常退出；关闭残留进程并重新启动后台 |
| 后台打开但部署仍锁定 | 在发布页检查工作区、`origin/main`、ahead/behind 和当前提交 CI |
| 普通 Hexo 被直接部署 | 确认它是否真的满足兼容仓库约定；不兼容仓库不会启用后台门禁 |

## 开发验证

修改接入代码后执行：

```bash
npm test
npm run build
```

测试覆盖绝对路径、固定 GUI 脚本、回环 URL、单一令牌参数、会话读取以及对外部 URL 的
拒绝。生产构建会同步根目录和 `release/` 中的插件文件。
