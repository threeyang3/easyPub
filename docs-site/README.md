# EasyPub 产品说明网站

本目录是独立的静态网站，部署到 GitHub Pages；不会参与插件运行时构建，也不依赖 Node、框架、数据库或第三方 CDN。

## 本地预览

从仓库根目录启动任意静态文件服务器，并访问 `/docs-site/`。例如：

```bash
python3 -m http.server 8000
```

然后打开 `http://localhost:8000/docs-site/`。

## 文件结构

- `index.html`：产品首页，介绍核心能力并引导进入使用文档。\n- `guides/`：分层使用文档，包含安装、原稿工作流、公众号工作台与账号配置、智能排版、Hexo、正文同步和参考指南。
- `assets/styles.css`：响应式布局与视觉样式。
- `assets/app.js`：移动导航、页面内搜索和当前章节定位。
- 截图直接引用 `../docs/assets/screenshots/`，避免重复存储产品图片。

详细指南仍维护在仓库的 `docs/`，网站中的指南链接会跳转到 GitHub 对应 Markdown 文件。

## 发布

`.github/workflows/pages.yml` 在 `main` 分支的站点或截图发生变化时，自动将本目录部署为 Pages artifact。

首次启用时，请在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。部署完成后访问：

https://threeyang3.github.io/easyPub/

修改网站内容时，优先复用真实截图，并同步核对图片说明、功能边界和稳定版本信息。不要把演示截图描述为真实账号发布结果。
