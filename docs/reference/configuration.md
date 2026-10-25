# 配置参考

[文档首页](../README.md) · [数据模型](data-model.md) · [安全边界](../security.md)

配置类型见 [types.ts](../../types.ts)，加载和序列化见 [main.ts](../../main.ts)、[utils/settings.ts](../../utils/settings.ts)。正常情况下通过设置页和向导修改，不直接编辑插件数据。

## 保存位置与生效方式

配置保存在 Vault 的 `.obsidian/plugins/easy-pub/data.json`。源笔记和发布稿的 Front Matter 不在该文件中。普通设置改变后自动保存；公众号和 AI 凭据由对应向导/窗口明确保存。

普通设置显示保存结果；保存失败时内存中的修改可能仍生效，重启后不会可靠保留，应修复写入权限后重试。设置写入按队列执行，避免后发写入被较早请求覆盖。账号配置保存失败有独立回滚逻辑。

## 通用设置

| 字段 / 界面名称 | 默认值 | 说明 |
| --- | --- | --- |
| `hexoRepoPath` / Hexo 仓库路径 | 空 | 本机博客根目录绝对路径；不是站点 URL，也不是 `_posts` 路径 |
| `publishBasePath` / 发布根目录 | `发布` | Vault 相对目录；用于知乎、公众号、小红书 |
| `autoDeploy` / 自动部署 | `false` | 仅 Hexo；兼容 Control Room 时改为打开后台保护流程 |
| `imageHandling` / 本地图片处理 | `local` | `local` 为平台默认；`picgo` 启用可选图床转换；不影响公众号 |
| `picgoServerUrl` / PicGo Server 地址 | `http://127.0.0.1:36677/upload` | PicGo 上传接口，不是图床图片 URL |
| `picgoServerSecret` | 空 | 内存中的有效 Secret；正常序列化不保存明文 |
| `picgoEncryptedSecret` | 空 | 系统加密结果，由插件管理 |
| `picgoImageCache` | `{}` | 附件路径对应 hash/url，内容变化时不复用旧 URL |

路径更改不会自动搬迁旧稿或迁移旧关联。先备份，再核对旧发布稿位置和 `pub_id`，避免在新目录意外创建另一份稿件。

## 微信公众号设置 `wechat`

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `appId` | 空 | 通过向导配置，切换账号需要匹配的新 AppSecret |
| `encryptedSecret` | 空 | 加密 AppSecret；加密不可用时密钥仅在会话内 |
| `defaultAuthor` | 空 | 仅给未设置作者的本地稿提供默认值 |
| `allowRemoteImages` | `true` | `false` 时只接受 Vault 附件；切换后旧预览失效，需刷新 |
| `assets` | `{}` | 按账号、正文/封面用途和处理后 hash 隔离的素材缓存 |
| `drafts` | `{}` | 按账号和 pub_id 保存草稿 ID、远端指纹、时间和不确定状态 |

这些缓存不是可随意删除的临时文件：草稿关联用于避免重复创建，`uncertain` 用于保护未知结果。恢复流程见[备份与恢复](../operations/backup-and-recovery.md)。访问令牌只在内存缓存。

## AI 设置 `wechatAi`（可选）

未配置时不存在该对象，也无需配置就能使用全部本地主题。规范化时 endpoint/model/encryptedKey 默认为空，jsonMode 默认为 true。

| 字段 | 约束 |
| --- | --- |
| `endpoint` | 完整的 `/chat/completions` 接口；HTTPS，或仅本机回环 HTTP；不得带 URL 凭据、查询或 fragment |
| `model` | 服务提供方的模型名，非空、不超过 200 字符，不含换行 |
| `encryptedKey` | 系统加密结果，不手工填写；密码框留空仅保留当前地址的密钥 |
| `jsonMode` | 是否发送 `response_format: {type: "json_object"}`；不支持时关闭 |

地址示例仅说明格式：`https://api.example.com/v1/chat/completions` 或 `http://127.0.0.1:1234/v1/chat/completions`，不表示预装或推荐某个服务。没有默认模型或内置云端账号。更换地址不会把旧地址的密钥自动带过去。兼容接口以当前请求/响应约束为准，见[架构](../development/architecture.md)。

## 不应混淆的配置

- `wechat.defaultAuthor` 是插件默认值；单篇作者是发布稿中的 `wechat.author`。
- `wechat.drafts` 是插件运行关联；单篇排版存于 Markdown 的 `wechat.layout`。
- Hexo `_config.yml`、主题配置和部署凭据属于博客仓库；EasyPub 不把它们复制到 `data.json`。
- PicGo 图床账号属于 PicGo；EasyPub 只持有 Server 地址和可选 Server Secret。

## 配置损坏或迁移

加载失败或根数据类型无效时，插件进入恢复锁定。普通保存及发布写入被禁止，不能用默认值覆盖原配置。设置页可重新读取，或在明确确认后执行“备份后重置配置”；原文件和副本须可读取且校验一致。

系统加密可能绑定设备/系统账号。复制 data.json 不保证密钥在另一台电脑可用；不可解密时保留密文，通过向导重新输入。不要把完整配置、恢复副本或密钥放到 issue、日志截图或公开仓库。
