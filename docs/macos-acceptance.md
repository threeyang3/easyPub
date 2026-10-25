# Mac 实机验收 — 2026-10-24

> 历史记录：以下结论与待办对应各节记录时的版本和环境，后续进展见[版本与验证状态](status.md)。

基线 EasyPub `62d5fc7`，hexo-blog-source `e9151b1`。环境：Apple Silicon macOS，Sandbox，Electron 43.7.7 / 宿主 Node 24.21.0，外部 Node 22.23.1。

## 修复

- 从 Finder 启动的 Obsidian 只有系统 PATH，本机 Node 位于 `~/.local/bin`。现在追加当前用户的固定目录，保留已有 PATH 优先级，不执行 shell 配置。
- 增加 `test:hexo-native`，以原生 Obsidian API 创建笔记、复制附件、确认更新并调用真实 Hexo。弹窗通过实例定位，支持多窗口；网络请求有界。
- 博客侧发现 Hexo 8.1.2 模板模式未锚定根目录，可能把 `source/css/_layout/post.styl` 当作 `layout/post.styl`，构建偶发失败。博客副本新增 `scripts/theme-view-paths.js` 与回归测试，只允许根目录 `layout/` 作为模板来源，不修改 node_modules。

## 通过的验收

- 核心、可靠性、公众号测试；TypeScript 和生产构建。
- 公众号浏览器测试：Canvas、裁剪、刷新竞争、稿件绑定和样式隔离。
- 发布管理浏览器测试：分页、重试、过期读取、取消和只读文本。
- Sandbox 原生 Markdown、嵌套列表、代码缩进、图片 EXIF、缩放、权限变化与系统加密往返。
- 原生公网 PNG 下载、大小限制与超时真实断开。
- Sandbox → 含中文空格路径的 Hexo 副本：外部 Node 发现、新稿 abbrlink、图片哈希复制、源元数据、草稿移动后按 pub_id 更新、原生确认弹窗、平台字段及 pending 状态保留、原图不变。
- 真实 Control Room 会话与 `/api/status`，后台识别文章及素材，真实 Hexo 构建包含更新正文与图片链接。
- 博客后台 API、源码保护、编辑历史/状态转换与图片预览回归。

## 边界

博客副本暂时排除需要本机密码的 `漂泊.md`；未读取或伪造真实密码，未验证加密文章完整构建。测试结束恢复该源文件。未调用线上部署、远端推送、微信草稿写入或 PicGo 上传。测试生成的 public 仅供验收，不可部署。通过单机验收不等同于最低 Obsidian 版本、Intel Mac 或远端 CI 已通过。

博客 `npm run check` 的隐私、内容、链接、监听器、模板回归和构建已通过；最终 `verify-build` 固定检查加密页 c57a，因为该稿在测试副本被排除而未通过。因此不声明博客完整检查通过。

提交前复审：核心测试、TypeScript、构建和模板匹配回归再次通过。原生测试脚本改为解析有效 JSON 结果；重跑时当前 Obsidian CLI 返回 `Command "eval" not found`，未能重复原生验收，以上原生结果来自此前成功运行。
