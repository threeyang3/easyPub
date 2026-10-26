# 数据模型与目录

[文档首页](../README.md) · [项目文件结构](../overview.md) · [配置参考](configuration.md)

源码定义：[types.ts](../../types.ts)、[frontMatter.ts](../../utils/frontMatter.ts)、[platforms.ts](../../utils/platforms.ts)、[wechatState.ts](../../utils/wechatState.ts)。下列示例仅说明结构，不包含真实凭据，不应替代整份运行配置。

## 标识及关系

| 标识 | 作用 | 不应如何使用 |
| --- | --- | --- |
| `pub_id` | 源文章与不同平台稿件共享的稳定身份 | 不按标题重新计算，不为每个平台单独补一个 ID |
| `source_file` | 发布稿回到源笔记的链接 | 不凭同名文件推断拥有者 |
| `子文件` | 源文章记录平台稿路径 | 不等同实时双向同步 |
| `abbrlink` | Hexo 页面路径标识 | 不等同 pub_id；历史值不应强制改成新格式 |
| `publish_url` | 已解析的博客页面 URL | 不代表本次已经成功部署上线 |
| 微信 `mediaId` | 远端图文草稿或素材的 ID | 不等同源稿身份；须连同账号与用途判断 |
| `documentHash` | 排版绑定的精确 Markdown 内容 hash | 正文改变后不能沿用旧方案 |

新 `pub_id` 使用 8 字节密码学随机值的十六进制表示。旧 ID 保持兼容，不因格式不同自动迁移。同一平台多份稿件使用相同 ID 会触发冲突；不同平台共享同一源 ID 是正常关系。

## 源文章示例

```yaml
---
title: 一篇示例文章
pub_id: 0123456789abcdef
categories:
  - 随笔
tags:
  - 写作
cover: "[[附件/封面.png]]"
子文件:
  - "[[发布/微信公众号/一篇示例文章]]"
  - "/path/to/blog/source/_posts/一篇示例文章.md"
---
```

源文件可以在 Vault 的普通笔记目录中。Vault 内子文件使用 wiki link；外部 Hexo 使用普通文件路径。`source_file`、`publish_url`、`updated` 不应作为源稿的发布状态保留：源关联更新时会清理它们，源文章自己设置的 `date` 保留。

## 属性归属

原稿基础属性为 `title`、`author`、`description`、`tags`、`categories`、`cover`、可选 `date`；关联属性为插件维护的 `pub_id`、`子文件`。其他自定义笔记属性保留在原稿，首次生成平台稿时不导出。

所有平台稿都有 `title`、`pub_id`、`source_file`、`date`、`updated`。专用属性如下：

| 平台 | 首次继承的通用属性 | 平台专用属性 |
| --- | --- | --- |
| Hexo | title、author、description、tags、categories、cover | layout 默认 post；top_img 默认空；可设置 abbrlink、password_secret；兼容后台生成短链接并管理 workflow；publish_url 由插件计算 |
| 知乎 | title、description、tags、cover | zhihu_type 在生成表单选择，默认“文章” |
| 微信公众号 | title；author → wechat.author，description → wechat.digest，cover → wechat.cover | wechat.sourceUrl、cropWide、cropSquare、layout、layoutHistory；作者缺失时采用账号默认作者，摘要缺失时由工作台提取 |
| 小红书 | title、description、tags、cover | 暂无额外专用字段；属性用于本地整理 |

Hexo 的空封面/顶部图继承主题，`false` 保持禁用。公众号封面附件路径转换为相对于本地稿的路径；知乎/小红书的附件封面转换为 Vault 路径的 wiki link。

“初始化原稿属性”提供表单与写入预览，确认后才补齐缺失 ID。已有 ID 和自定义属性保持不变，`子文件` 在实际发布后生成。列表使用 JSON，例如 `["写作", "AI"]`；分类也支持嵌套文本列表。

“从原稿刷新平台属性（选择字段）”默认不勾选任何字段，显示源稿建议值与目标当前值。只写入选中的字段，允许调整建议值；正文、首次日期和身份保持原有关系。旧稿的额外属性默认保留，可逐项选择移除并核对最终差异。改变公众号封面时清除旧裁剪，之后在工作台调整新封面。

已有稿件保留原文件位置；刷新知乎 `zhihu_type` 不自动移动目录。更新后的文件路径仍在最终差异窗口显示。

## 发布稿合并规则

| 字段/内容 | 新建 | 更新 |
| --- | --- | --- |
| 正文 | 从源稿准备并进行平台图片处理 | 普通平台按确认的源版本替换；公众号须显式源刷新 |
| `pub_id` / `source_file` | 生成关联 | 按本次确认的源身份维护 |
| `date` | 源稿值优先，否则当前时间 | 保留目标已有首次日期 |
| `updated` | 当前时间 | 随更新刷新 |
| 基础字段 | 按平台白名单继承，生成表单可调整 | 保留平台稿当前值；仅显式选择刷新才改变 |
| 原稿自定义字段 | 不导出 | 不自动加入目标 |
| 目标额外字段 | 不自动加入 | 保留；显式清理时展示预览 |
| 目标 `wechat` | 从通用作者、摘要和封面初始化 | 公众号正文刷新仍保留本地设置；属性刷新只改变选中字段 |
| Hexo `publish_url` | 能解析则生成 | 能解析则更新，否则保留已有值 |

解析接受数据型 YAML/JSON，不执行 JavaScript Front Matter。序列化可能调整注释或格式，不应依靠 YAML 原始排版保存运行状态。

## 单篇公众号元数据

```yaml
---
title: 一篇示例文章
pub_id: 0123456789abcdef
source_file: "[[笔记/一篇示例文章]]"
wechat:
  author: 示例作者
  digest: 手工编辑的摘要
  sourceUrl: "https://example.com/article"
  cover: "../../附件/封面.png"
---
```

顶层 `title`、`wechat.author/digest/sourceUrl` 的插件校验上限分别为 32 字、16 字、120 字和 1024 UTF-8 字节。标题必填；原文链接使用 HTTP(S)。旧稿仍优先读取历史 `wechat.title`；确认保存或源刷新时将实际展示标题移到顶层 `title`，移除重复的嵌套标题。这些是当前实现的提交规则，不是对平台所有内容类型的通用承诺。

`cropWide` 与 `cropSquare` 各保存 `{x, y, width, height}` 的归一化裁剪矩形，用于 2.35:1 与 1:1；应通过裁剪界面生成。封面设置只选择和裁剪，不改写正文图片顺序。

`layout` 保存当前方案，`layoutHistory` 最多保留 5 个历史方案。弹窗内撤销最多 20 步，不是整篇文章的版本库。

## LayoutPlan

结构为 `{schemaVersion, documentHash, theme, accentColor, blocks}`。当前 schemaVersion 为 1；不接受未知字段。每个 blocks 项包含 `id`、`role`、`component` 和可选 `locked`。

| component | role | 允许对象 |
| --- | --- | --- |
| `plain` | `body` | 所有支持的区块 |
| `intro` | `lead` | 段落、列表、引用 |
| `highlight-card` | `key-point` | 段落、列表、引用 |
| `quote` | `quotation` | 段落、列表、引用 |
| `conclusion` | `summary` | 段落、列表、引用 |

主题及颜色枚举见[排版指南](../wechat-layout.md)和 [wechatThemes.ts](../../utils/wechatThemes.ts)。区块 ID 由源位置与内容 hash 生成；标题、代码、表格、图片等不允许变为强调组件。用户锁定在本地合并，AI 返回锁定字段会被拒绝。映射不可靠或超过 300 区块时只提供本地主题，不猜测组件位置。

不要手写伪 hash 让方案“通过”：方案必须匹配当前正文和实际区块。没有有效方案时渲染可安全回退，旧历史项会经过当前文档校验。

## 持久化与内存状态

| 数据 | 位置 | 生命周期 |
| --- | --- | --- |
| 原文、平台稿、wechat 元数据 | Markdown 文件 | 用户文件，长期保留 |
| 账号配置、素材缓存、远端草稿关联 | 插件 data.json | 升级通常保留，清除前需恢复计划 |
| Hexo 覆盖前原文 | `.easy-pub-backups/<SHA-256>.bak` | 不自动清理，可能复用相同内容备份 |
| 博客复制图片 | `source/picture/easy-pub/<pub_id>/` | 不覆盖同名内容地址资源 |
| 微信访问令牌 | 内存 | 不写入配置 |
| AI 方案缓存 | 内存，最多 16 项 | 插件会话内；无请求正文或原始密钥 |
| 源身份索引 | 内存 | 按 Vault 事件失效，不作为永久身份数据库 |
| 图片 bytes/blob URL | 内存 | 预览刷新或关闭时释放 |

微信关联键为 `appId:pub_id`，素材键为 `appId:body或cover:hash`。关联记录可包含 `mediaId`、`fingerprint`、`syncedAt` 和 `uncertain`。`uncertain` 表示结果尚未安全确定，不能当作可删除的错误标记。

## 文件移动与挂载

Hexo 查找覆盖 `_posts`、`_drafts` 和子目录；更新保留找到的原目录。当前分支的 Vault 平台查找也覆盖对应发布目录的子目录，知乎限其配置的文章/想法目录。移到搜索范围之外不会自动被发现。

移动源稿可能使旧 `source_file` 过时；插件仍会检查是否存在其他源身份声明，不直接改写旧 ID。目录挂载不是 EasyPub 的持久化模型：若使用第三方挂载，先确认它呈现的是同一文件，而不是另一份复制品。
