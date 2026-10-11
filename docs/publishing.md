# 发布机制与平台行为

EasyPub 从当前打开的 Obsidian 笔记生成平台发布稿。除 Hexo 部署外，它不直接调用知乎、微信公众号或小红书的发布 API。

## 1. 基本配置

在“设置 → EasyPub”中配置：

| 设置 | 默认值 | 作用 |
|------|--------|------|
| Hexo 仓库路径 | 空 | Hexo 博客根目录的绝对路径 |
| 发布根目录 | `发布` | 知乎、微信公众号、小红书发布稿在 Vault 内的根目录 |
| 本地图片处理 | 平台默认 | Hexo 复制附件；也可切换为 PicGo 网络图片 |
| 自动部署 | 关闭 | Hexo 发布稿写入后执行部署；兼容 Control Room 时改为打开受保护流程 |

## 2. 发布流程

1. 打开源文章。
2. 点击功能区云图标，或执行 `Publish to platform`。
3. 选择目标平台。
4. 新文章直接生成发布稿；更新文章先显示差异，确认后才写入。
5. EasyPub 打开生成的发布稿，供后续平台适配。
6. Hexo 可先本地构建，再按仓库类型部署。

文章使用 `pub_id` 建立稳定关联。已有发布稿按 `pub_id` 查找，不依赖文件名；遇到无关的同名文件时会自动选择编号文件名，不会覆盖。

## 3. 平台输出

| 平台 | 发布稿位置 | 后续行为 |
|------|------------|----------|
| Hexo | `{hexoRepoPath}/source/_posts/` | 生成 `publish_url`，支持本地构建和部署 |
| 知乎 | `{publishBasePath}/知乎/文章/` 或 `想法/` | 通过 `zhihu_type` 选择子目录 |
| 微信公众号 | `{publishBasePath}/微信公众号/` | 在 Vault 内继续编辑 |
| 小红书 | `{publishBasePath}/小红书/` | 在 Vault 内继续编辑 |

Hexo 发布稿位于 Vault 外部，EasyPub 使用本地文件系统访问；其余平台使用 Obsidian Vault API。

## 4. Front Matter 规则

### 源文章

```yaml
---
title: 文章标题
pub_id: abc123
子文件:
  - "[[发布/知乎/文章/文章标题]]"
  - "E:\\blog\\source\\_posts\\文章标题.md"
---
```

- `pub_id` 用于识别同一篇文章。
- `子文件` 记录生成的发布稿。
- Vault 内发布稿使用 wiki link；Hexo 使用外部文件路径。
- EasyPub 不向源文章新增 `source_file`、`publish_url`、`date`、`updated`；更新元数据时会清除已有的 `source_file`、`publish_url`、`updated`，保留源文章原有的 `date`。

### 发布稿

```yaml
---
title: 文章标题
pub_id: abc123
source_file: "[[articles/文章标题]]"
publish_url: "https://example.com/posts/abc123"
date: "2026-05-05T00:00:00.000Z"
updated: "2026-05-05T00:00:00.000Z"
---
```

更新时遵循以下规则：

- 源文章拥有的字段覆盖发布稿中的同名字段。
- 仅存在于发布稿的字段继续保留。
- 已有发布稿的 `date` 保持不变；首次生成时优先使用源文章的 `date`，否则使用当前时间。`updated` 随更新刷新。
- `pub_id`、`source_file` 和 Hexo `publish_url` 由 EasyPub 维护。

知乎可使用：

```yaml
---
zhihu_type: 文章 # 可选：文章、想法
---
```

## 5. 图片处理

默认模式下：

- Hexo 将图片型 `![[附件]]` 复制到 `source/images/easy-pub/{pub_id}/`，并改写为普通 Markdown 图片链接。
- 其他平台保留原始 Obsidian 嵌入。
- 源文章正文和 Vault 原附件不会被修改；源文章的 `pub_id` 和 `子文件` 会更新。
- 笔记嵌入以及 fenced/inline code 中的示例不会被改写。

如需所有平台都使用网络图片，可启用 [PicGo 图片上传](picgo.md)。

## 6. Hexo 构建与部署

Hexo 仓库至少需要：

- 根目录存在 `_config.yml`。
- 已安装仓库本地的 Hexo 依赖。
- 部署时 `_config.yml` 已配置 `deploy.type`。
- Git、SSH 或凭据管理器可以非交互运行。

EasyPub 不使用 `npx` 临时下载 Hexo。

| 命令 | 行为 |
|------|------|
| `Build Hexo locally (no deploy)` | 执行 `clean` 和 `generate --bail`，不部署 |
| `Deploy to Hexo` | 普通仓库执行 `clean`、`generate --bail`、`deploy` |

单个 Hexo 命令超过 10 分钟会停止。使用动态 permalink 插件时，本地生成或部署成功后会刷新当前文章的 `publish_url`。

如果仓库满足 Blog Control Room 兼容条件，部署命令和自动部署只会打开受保护管理流程，不会绕过仓库门禁。参见 [Blog Control Room 接入](control-room.md)。
