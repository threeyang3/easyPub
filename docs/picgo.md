# PicGo 图片上传

PicGo 模式会在确认发布后上传 Obsidian 本地图片，并把发布稿中的图片嵌入替换为网络链接。该功能默认关闭。

## 1. 选择处理方式

| 模式 | Hexo | 知乎、微信公众号、小红书 |
|------|------|--------------------------|
| 平台默认 | 复制附件到 Hexo 仓库并改写链接 | 保留 Obsidian 图片嵌入 |
| 上传到 PicGo | 上传并写入网络链接 | 上传并写入网络链接 |

只发布到 Hexo 且希望图片跟随仓库管理时，无需启用 PicGo。默认复制位置是：

```text
{hexoRepoPath}/source/picture/easy-pub/{pub_id}/
```

## 2. 准备 PicGo

尚未安装时，可使用 [PicGo 官方安装说明](https://docs.picgo.app/gui/guide/) 或 [GitHub Releases](https://github.com/Molunerfinn/PicGo/releases)。

在 PicGo 中：

1. 配置并选择一个图床。
2. 手动上传测试图片，确认得到可公开访问的 HTTP(S) 链接。
3. 确认 PicGo Server 已开启。
4. 记下上传地址；默认是 `http://127.0.0.1:36677/upload`。
5. 如果 Server 启用了 Secret 认证，同时记下 Secret。

接口行为参见 [PicGo Server API](https://docs.picgo.app/gui/guide/advance)。

## 3. 配置 EasyPub

打开“设置 → EasyPub → 图片”：

1. 将“本地图片处理”改为“上传到 PicGo”。
2. 填写 PicGo Server 地址。
3. 仅在 Server 启用认证时填写 Secret。
4. 点击“测试连接”。

连接测试只访问 `/heartbeat`，不会上传图片，也不会验证上传接口的 Secret 或图床配置；这些需要通过实际上传确认。

## 4. 发布行为

源文章：

```markdown
![[Pasted image 20260727.png]]
```

发布稿：

```markdown
![Pasted image 20260727](https://image.example.com/Pasted-image-20260727.png)
```

EasyPub 的处理边界：

- 支持 `avif`、`bmp`、`gif`、`jpeg`、`jpg`、`png`、`svg`、`webp`。
- 只处理图片嵌入，不处理笔记嵌入。
- 不改写 fenced code block 和 inline code 中的示例。
- 不修改源文章正文，也不移动或删除 Vault 原附件；发布仍会更新源文章的 `pub_id` 和 `子文件`。
- 更新文章时先展示差异，用户确认后才上传。
- 上传失败时停止本次发布，不写入目标发布稿。
- 仅支持本地文件系统中的 Vault，因为 PicGo 需要读取附件绝对路径。

## 5. 缓存

缓存键由 Vault 附件路径和内容哈希共同决定：

- 路径和内容未变化：复用已有链接。
- 内容变化：重新上传并更新缓存。
- 同一次发布重复引用同一图片：只上传一次。

缓存保存在 EasyPub 的本地插件设置中。切换回“平台默认”不会清空缓存，也不会删除图床中已有图片。

## 6. 安全边界

- EasyPub 不读取 PicGo 中的图床账号、Token 或对象存储密钥。
- 图片绝对路径会发送到用户配置的 PicGo Server。
- PicGo Server Secret 会保存在 Obsidian 本地插件数据中，并通过 `Authorization: Bearer` 发送。
- 上传后的图片受所选图床的公开范围、费用和隐私规则约束。
- 图片上传成功后若后续发布步骤失败，EasyPub 不会自动删除远端图片。

建议使用本机 `127.0.0.1`，不要把未认证的 PicGo Server 暴露到局域网或公网，也不要公开提交 Obsidian 插件数据。

## 7. 故障排查

| 现象 | 处理方法 |
|------|----------|
| 测试连接被拒绝 | 启动 PicGo，并确认 Server 已开启 |
| 返回 `HTTP 401` 或 `HTTP 403` | 核对 EasyPub 中的 Server Secret |
| 连接成功但上传失败 | 先在 PicGo 中手动上传同一图片，并查看 PicGo 日志 |
| 找不到附件 | 确认 Obsidian 能从源文章打开该图片 |
| Vault 不是本地文件系统 | 改用“平台默认”，或迁移到本地 Vault |
| 修改图片后仍看到旧内容 | 确认附件已保存，并检查图床 CDN 缓存 |

首次启用时，建议用只含一张图片的测试文章发布，并在无登录浏览器窗口中验证生成的网络链接。
