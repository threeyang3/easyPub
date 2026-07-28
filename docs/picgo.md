# PicGo 图片上传指南

EasyPub 可以在发布时把 Obsidian 中引用的本地图片交给 PicGo 上传，再将发布稿中的图片引用替换为网络链接。该功能是可选项，默认关闭。

## 适合什么场景

- Hexo 站点希望直接使用图床链接，而不是把附件复制进博客仓库。
- 知乎、微信公众号或小红书发布稿需要可访问的网络图片链接。
- 已经在 PicGo 中配置了对象存储、GitHub、SM.MS 或其他图床。

如果只发布到 Hexo，且希望图片跟随博客仓库管理，保留默认的“平台默认”即可。此时图片会复制到：

```text
{hexoRepoPath}/source/images/easy-pub/{pub_id}/
```

## 1. 安装和配置 PicGo

如果尚未安装 PicGo，可从 [PicGo 官方下载说明](https://docs.picgo.app/gui/guide/) 或 [GitHub Releases](https://github.com/Molunerfinn/PicGo/releases) 获取桌面版。

安装后先在 PicGo 中完成：

1. 配置并选择一个可用图床。
2. 手动上传一张测试图片，确认能够返回可公开访问的 `http` 或 `https` 链接。
3. 在 PicGo 设置中确认 PicGo Server 已开启。
4. 记下 Server 地址。默认上传地址是 `http://127.0.0.1:36677/upload`。
5. 如果 PicGo Server 启用了 Secret 认证，同时记下对应 Secret。

PicGo 的 Server 和上传接口说明见 [PicGo Server API](https://docs.picgo.app/gui/guide/advance)。

## 2. 配置 EasyPub

在 Obsidian 中打开“设置 → EasyPub”：

1. 将“本地图片处理”改为“上传到 PicGo”。
2. 填写“PicGo Server 地址”；通常保留默认值即可。
3. 仅在 PicGo Server 已启用认证时填写“PicGo Server Secret”。
4. 点击“测试连接”。

“测试连接”只访问 PicGo 的 `/heartbeat` 接口，不会上传图片。看到“PicGo Server 连接成功”后即可开始发布。

## 3. 发布时会发生什么

源文章包含以下图片嵌入：

```markdown
![[Pasted image 20260727.png]]
```

启用 PicGo 后，发布稿会得到类似内容：

```markdown
![Pasted image 20260727](https://image.example.com/Pasted-image-20260727.png)
```

处理规则如下：

- 适用于 Hexo、知乎、微信公众号和小红书。
- 支持 `avif`、`bmp`、`gif`、`jpeg`、`jpg`、`png`、`svg`、`webp`。
- 只处理 Obsidian 图片嵌入，不处理笔记嵌入。
- 不改写 fenced code block 和 inline code 中的示例。
- 不修改源文章，也不移动或删除 Vault 中的原图片。
- 更新已有发布稿时，先显示差异；只有确认发布后才会真正上传。
- 上传失败时停止本次发布，不写入目标发布稿。

PicGo 必须能够读取附件的本地绝对路径，因此该功能仅适用于本地文件系统中的 Vault。

## 缓存与重复上传

EasyPub 会按“Vault 附件路径 + 图片内容哈希”缓存 PicGo 返回的链接：

- 路径和图片内容都没有变化：复用已有网络链接。
- 图片内容发生变化：重新上传并更新缓存。
- 同一篇文章多次引用同一张图片：本次发布只上传一次。

缓存保存在 EasyPub 的本地插件设置中。切换回“平台默认”不会删除缓存，也不会删除图床中已经上传的图片。

## 隐私与安全

- EasyPub 不读取 PicGo 中配置的图床账号、Token 或对象存储密钥。
- EasyPub 会把待上传图片的本地绝对路径发送给你配置的 PicGo Server。
- PicGo Server Secret（如填写）会保存在 Obsidian 的本地插件数据中，并通过 `Authorization: Bearer` 请求头发送。不要把插件数据文件公开提交到仓库。
- 图片上传后会进入你在 PicGo 中选择的第三方图床；请自行确认图床的公开范围、费用和隐私规则。
- 如果图片已成功上传，但之后发布流程因其他原因失败，EasyPub 不会自动删除图床中的图片。

为降低风险，建议使用本机回环地址 `127.0.0.1`，不要把未认证的 PicGo Server 暴露到局域网或公网。

## 常见问题

| 现象 | 可能原因 | 处理方法 |
|------|----------|----------|
| 点击“测试连接”提示拒绝连接 | PicGo 未启动，或 Server 未开启 | 启动 PicGo，在 PicGo 设置中开启 Server，再次测试 |
| 提示 `HTTP 401` 或 `HTTP 403` | Server 启用了认证，Secret 缺失或错误 | 核对 EasyPub 中的 PicGo Server Secret |
| 测试连接成功，但上传失败 | 图床配置无效、网络异常、额度不足或 PicGo 插件报错 | 先在 PicGo 中手动上传同一张图片，并查看 PicGo 日志 |
| 提示找不到附件 | Obsidian 链接无法解析，或附件已移动 | 在源文章中重新选择附件，确认 Obsidian 能打开该图片 |
| 提示当前 Vault 不是本地文件系统 | Vault 由非本地适配器提供 | 改用“平台默认”，或将 Vault 放在本地文件系统 |
| 修改图片后仍看到旧链接 | 图床 CDN 缓存，或实际附件内容未变化 | 确认附件已保存；必要时在图床侧刷新 CDN 缓存 |
| 不想继续使用 PicGo | 需要恢复默认处理方式 | 将“本地图片处理”改回“平台默认” |

## 发布前自检

首次使用时，建议按以下顺序验证：

1. 在 PicGo 中手动上传一张图片。
2. 在 EasyPub 中点击“测试连接”。
3. 用一篇只含一张图片的测试文章发布。
4. 打开生成的发布稿，确认图片引用已变为网络链接。
5. 在浏览器无登录状态下打开该链接，确认图片可公开访问。
