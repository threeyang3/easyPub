# EasyPub

一个 Obsidian 插件，用于将文章发布到多个平台。

- 当前版本：`1.3.0`
- 最低 Obsidian 版本：`1.4.4`
- 仅支持桌面端 Obsidian

## 功能特性

- **多平台支持**：Hexo、知乎、微信公众号、小红书
- **文章追踪**：通过 `pub_id` 追踪文章版本
- **差异对比**：更新时显示内容变化
- **安全更新**：同名文章自动使用编号文件名，避免误覆盖已有发布稿
- **属性同步**：源文件字段保持同步，同时保留平台侧专属属性和创建日期
- **双向链接**：主文件与发布文件互相链接
- **自动生成链接**：Hexo 自动计算发布 URL
- **图片附件转换**：Hexo 发布时自动复制并转换 Obsidian `![[图片]]`
- **博客管理入口**：从 Obsidian 功能区、命令面板或设置页打开兼容的 Blog Control Room
- **PicGo 图床**：可选将本地图片交给 PicGo 上传，并写入网络链接

## 当前支持的平台

| 平台 | 发布方式 | 目标路径 | 说明 |
|------|----------|----------|------|
| Hexo | 外部目录 | `{hexoRepoPath}/source/_posts/` | 写入 Hexo 仓库，自动生成 `publish_url`，可选自动部署 |
| 知乎 | Vault 内部目录 | `{publishBasePath}/知乎/文章/` 或 `{publishBasePath}/知乎/想法/` | 生成发布稿，通过 `zhihu_type` 区分 `文章` / `想法` |
| 微信公众号 | Vault 内部目录 | `{publishBasePath}/微信公众号/` | 生成发布稿，之后可在 Vault 内继续编辑 |
| 小红书 | Vault 内部目录 | `{publishBasePath}/小红书/` | 生成发布稿，之后可在 Vault 内继续编辑 |

除 Hexo 部署外，当前版本不会直接调用知乎、微信或小红书的发布 API。

## 平台配置

| 平台 | 发布路径 | 说明 |
|------|----------|------|
| Hexo | `{hexoRepoPath}/source/_posts/` | 外部路径，自动生成 `publish_url` |
| 知乎 | `{publishBasePath}/知乎/文章/` 或 `想法/` | 按类型分子文件夹 |
| 微信公众号 | `{publishBasePath}/微信公众号/` | Vault 内部路径 |
| 小红书 | `{publishBasePath}/小红书/` | Vault 内部路径 |

## 安装

### 手动安装

1. 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 Obsidian vault 的 `.obsidian/plugins/easy-pub/` 目录
3. 确保 Obsidian 版本不低于 `1.4.4`
4. 重启 Obsidian，在设置中启用插件

### 开发安装

```bash
git clone https://github.com/threeyang3/easyPub.git
cd easyPub
npm ci
npm run build
```

构建完成后，仍需把 `release/main.js`、`release/manifest.json` 和
`release/styles.css` 一起复制到 Vault 的 `.obsidian/plugins/easy-pub/`，再在
Obsidian 中关闭并重新启用插件。只运行构建不会自动更新任意 Vault。

## 使用方法

### 发布流程

1. 打开要发布的文章
2. 点击左侧栏云图标，或使用命令 `Publish to platform`
3. 选择目标平台
4. 如果是更新，查看差异对比后确认
5. 文章复制到发布路径并自动打开；遇到同名文件时会自动使用编号文件名
6. 进行平台适配编辑
7. （仅 Hexo）执行 `Deploy to Hexo` 部署

### 命令

| 命令 | 说明 |
|------|------|
| `Publish to platform` | 选择平台并发布文章 |
| `Build Hexo locally (no deploy)` | 本地清理并生成 Hexo，用于发布前检查，不推送线上 |
| `Deploy to Hexo` | 普通 Hexo 仓库执行部署；检测到 Blog Control Room 时打开受保护发布流程 |
| `Open Hexo management console` | 复用或启动博客本地管理后台 |

### Hexo 图片

发布到 Hexo 时，正文中的图片型 Obsidian 嵌入会自动处理：

```markdown
![[Pasted image 20260727.png]]
```

图片副本保存在 `{hexoRepoPath}/source/images/easy-pub/{pub_id}/`，发布稿中的引用会转换成普通 Markdown 图片链接。源文章、Vault 附件、代码块中的示例以及笔记嵌入不会被修改。

### PicGo 图床

如果希望所有平台的发布稿直接使用网络图片：

1. 安装 PicGo，在 PicGo 中配置图床并开启 PicGo Server
2. 在 EasyPub 设置的“本地图片处理”中选择“上传到 PicGo”
3. 使用默认地址 `http://127.0.0.1:36677/upload`，或填写自定义地址
4. 点击“测试连接”

EasyPub 只通过本地 PicGo Server 上传，不读取 PicGo 中配置的图床账号或密钥。启用后，本地图片嵌入会在确认发布后上传并转换为网络链接；源文章和原附件不会被修改。若 PicGo Server 使用 Secret 认证，可在 EasyPub 中填写，Secret 会保存在 Obsidian 的本地插件设置中。

插件会根据图片内容计算哈希并缓存上传结果。图片没有变化时复用已有链接，内容变化后才重新上传。安装、配置、安全说明和故障排查见 [PicGo 图片上传指南](docs/picgo.md)。

### 设置

**Hexo**
- **Hexo 仓库路径**：Hexo 博客仓库根目录的绝对路径
- **博客管理后台**：兼容仓库可从设置页直接打开；左侧功能区也提供仪表盘入口

Hexo 仓库需要满足：

- 根目录包含 `_config.yml`
- 已在仓库中执行 `npm install`，能够使用本地 `hexo`
- `_config.yml` 已配置 `deploy.type`
- Git、SSH 或凭据管理器已完成非交互式认证

**其他平台**
- **发布根目录**：其他平台发布路径基础目录（默认 `发布`）

**部署**
- **自动部署**：普通 Hexo 仓库保存发布稿后立即部署，默认关闭；兼容 Blog Control
  Room 的仓库只打开受保护发布流程，不会静默部署

部署时只使用博客仓库本地安装的 Hexo，不会通过 `npx` 临时下载。插件会先检查配置，然后依次执行 `clean`、`generate --bail` 和 `deploy`；单个命令超过 10 分钟会停止并提示失败。也可以先使用本地构建命令检查生成结果而不部署。使用 `hexo-abbrlink` 等动态链接插件时，`publish_url` 会在生成完成后自动补全。

对于提供 `ManageBlog.bat`、`admin/server.js` 且将 `scripts.gui` 固定为
`node admin/server.js` 的 Blog Control Room 仓库，EasyPub 不会直接执行 Hexo
部署。它会打开管理后台，由后台继续执行源码提交、推送、CI 对齐和 Pages 部署检查。
运行中的会话只从仓库内 `.blog-admin/control-room.json` 读取，并且必须是通过
健康检查的 `127.0.0.1` 地址和有效随机令牌；外部 URL 会被拒绝。
完整安装、兼容条件、安全协议和排障说明见
[Blog Control Room 接入指南](docs/control-room.md)。

## Front Matter 属性

### 主文件（写作路径）

```yaml
---
title: 文章标题
pub_id: abc123
子文件:
  - "[[发布/知乎/文章/文章标题]]"
  - "E:\\blog\\source\\_posts\\文章标题.md"
---
```

主文件只保留源文件自身维护的字段，例如 `pub_id` 和 `子文件`。`source_file`、`publish_url`、`date`、`updated` 这类发布文件字段不会写回源文件。

### 发布文件（发布路径）

```yaml
---
title: 文章标题
pub_id: abc123
source_file: "[[articles/文章标题]]"
publish_url: "https://blog.com/posts/abc123"
date: "2026-05-05T00:00:00.000Z"
updated: "2026-05-05T00:00:00.000Z"
---
```

### 知乎专属属性

```yaml
---
zhihu_type: 文章  # 可选值：文章、想法
---
```

## 开发

```bash
npm install        # 安装依赖
npm test           # 运行核心行为测试
npm run check      # TypeScript 类型检查
npm run build      # 构建生产版本
npm run dev        # 开发模式（监听变化）
```

源码或 manifest 变化后必须重新运行 `npm run build`，并用同一次构建生成的三份文件更新
Vault 插件目录。

## 许可证

MIT
