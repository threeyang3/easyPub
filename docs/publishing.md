# 发布机制与平台行为

EasyPub 从当前打开的 Obsidian 笔记生成平台发布稿。微信公众号可进一步从编辑后的本地稿同步微信草稿箱；知乎和小红书仍只生成本地稿。

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

公众号已有本地稿时默认只打开成稿，不用源文章覆盖；仅“从源文章更新公众号本地稿”命令在差异确认后替换正文。配图、封面与同步详见[微信公众号工作台](wechat.md)。

文章使用 `pub_id` 建立稳定关联。已有发布稿按 `pub_id` 查找，不依赖文件名；遇到无关的同名文件时会自动选择编号文件名，不会覆盖。

### 批量补齐旧文章的 pub_id

命令面板执行 `EasyPub: 批量补齐文件夹中的 pub_id`，选择 Vault 文件夹或外部文件夹（如 Hexo 的 `source/_posts`），输入路径后点击“补齐缺失 ID”。包含子文件夹，只处理 Markdown；Vault 路径相对于库根目录，`/` 表示整个库，外部路径必须为绝对路径。外部扫描跳过隐藏目录、`node_modules` 和符号链接。

只补齐不存在、null 或空白字符串的 `pub_id`，已有值保持原样。每篇文章生成独立的随机 ID；错误文件单独报告，其余文件继续处理，重复执行不会替换已有 ID。Vault 使用 Obsidian 元数据 API，外部文件写入前核对内容；正文及其他字段保留，但 Front Matter 排版与注释可能被重新序列化。

此操作不发布或部署，也不自动配对源文章与旧发布稿。两份属于同一文章的文件必须使用相同 `pub_id`，才能建立更新关联；分别运行批量补齐会产生不同 ID。单篇源文章未设置 ID 时，正常发布也会生成 ID，并在发布稿保存成功后回写源文章。

## 3. 平台输出

| 平台 | 发布稿位置 | 后续行为 |
|------|------------|----------|
| Hexo | `{hexoRepoPath}/source/_posts/` | 生成 `publish_url`，支持本地构建和部署 |
| 知乎 | `{publishBasePath}/知乎/文章/` 或 `想法/` | 通过 `zhihu_type` 选择子目录 |
| 微信公众号 | `{publishBasePath}/微信公众号/` | 独立编辑，预览配图和封面后同步微信草稿箱 |
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

- Hexo 将图片型 `![[附件]]` 复制到 `source/picture/easy-pub/{pub_id}/`，并改写为普通 Markdown 图片链接。
- 文件名包含附件路径与内容哈希；更新图片生成新文件，不覆盖旧图。失败时回滚发布稿，并清理本次创建且没有文章引用的图片。
- 其他平台保留原始 Obsidian 嵌入。
- 源文章正文和 Vault 原附件不会被修改；源文章的 `pub_id` 和 `子文件` 会更新。
- 笔记嵌入以及 fenced/inline code 中的示例不会被改写。

Hexo、知乎和小红书可启用 [PicGo 图片上传](picgo.md)。公众号保留本地稿的可编辑引用，同步时使用独立的微信素材接口。

## 6. Hexo 构建与部署

Hexo 仓库至少需要：

- 根目录存在 `_config.yml`。
- 已安装仓库本地的 Hexo 依赖。
- 系统已安装 Node.js，且 Obsidian 启动时能从 PATH 找到 `node`。新安装 Node.js 后需重启 Obsidian。
- 部署时 `_config.yml` 已配置 `deploy.type`。
- Git、SSH 或凭据管理器可以非交互运行。

EasyPub 不使用 `npx` 临时下载 Hexo。

| 命令 | 行为 |
|------|------|
| `Build Hexo locally (no deploy)` | 执行 `clean` 和 `generate --bail`，不部署 |
| `Deploy to Hexo` | 普通仓库执行 `clean`、`generate --bail`、`deploy` |

单个 Hexo 命令超过 10 分钟会停止。使用动态 permalink 插件时，本地生成或部署成功后会刷新当前文章的 `publish_url`。

如果仓库满足 Blog Control Room 兼容条件，部署命令和自动部署只会打开受保护管理流程，不会绕过仓库门禁。参见 [Blog Control Room 接入](control-room.md)。

兼容后台的文章自动补齐标题、空分类/标签和唯一 `abbrlink`，拒绝明文 `password`。更新同时查找 `_posts`、`_drafts` 及其子目录，保留草稿或待发布状态；确认期间目标或附件发生变化时停止写入，请重新发布查看新的差异。

1.4.0 的本地图片位于 `source/images/easy-pub/`。升级不会删除或自动改写历史稿件；重新发布后使用新目录，旧图片在确认无引用后可人工清理。若仍有引用旧目录的文章，迁移文件时必须同步修改链接。

## 7. 故障与恢复

- 确认期间源文章、发布设置、目标稿件或图片发生变化，会停止本次写入；重新发布即可查看最新差异。
- 如果当前打开的是目标发布稿，不能再发布到自身；请打开原始源文章后发布，避免覆盖源与发布稿的关联信息。
- PicGo 上传等待超过 60 秒会结束本次发布并释放任务状态。图床可能仍在处理请求，应先检查 PicGo 的结果再重试。
- 稿件已保存但编辑器打不开时，会提示保存路径，可以手动打开，无需重复发布。
- 插件设置文件损坏时会提示并使用默认值启动，不会在启动时覆盖原设置。请检查插件 `data.json` 或重新配置路径。
- Hexo 配置 YAML 错误、部署类型为空时，会在 `clean` 之前停止。修复配置后可以重试。
- Front Matter 支持 YAML/JSON，不执行 JavaScript。图片缺失、目标冲突等影响数据完整性的问题仍会阻止该次发布。
