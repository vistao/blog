---
title: "博客架构：全部跑在 Cloudflare 上"
date: 2026-09-13T13:40:00+08:00
draft: false
description: "Hugo 静态站、Pages 自动部署、R2 图床、自研评论 API 与 Telegram 审核"
tags: ["架构", "Cloudflare", "Hugo"]
---

这篇说明 **blog.v2er.org** 现在怎么搭、怎么发、评论怎么审。整体思路参考了 [Vincent 的 Cloudflare 原生评论方案](https://missuo.me/posts/comment-system/)：静态站在边缘，评论用 Worker + 数据库，审核走 Telegram，不另租 VPS。

## 总览

```text
GitHub (vistao/blog)
    │  push main
    ▼
GitHub Actions：hugo --minify
    ▼
Cloudflare Pages（blog.v2er.org）
    │
    ├── 静态 HTML / CSS / JS（Hugo + PaperMod 主题）
    ├── 图片走 R2（文中插图 URL）
    └── 文章页加载 comments.js → comments.v2er.org API

comments.v2er.org（Worker: waline-on-worker）
    ├── D1：评论、页面统计、楼中楼字段
    └── 新评论 → Telegram Bot 通知（批准 / 垃圾 / 删除）
```

| 组件 | 技术 | 作用 |
| --- | --- | --- |
| 写作与生成 | Hugo（extended） | Markdown → 静态页 |
| 托管与 CDN | Cloudflare Pages | `blog.v2er.org` |
| 发布 | GitHub Actions | 推 `main` 自动部署 |
| 图床 | Cloudflare R2 | 文章图片对象存储 |
| 评论 API | Workers + D1 | 提交、列表、审核状态 |
| 审核 | Telegram Bot | 私信通知 + 内联按钮 |
| 统计 | Cloudflare Web Analytics | 轻量访问统计 |

## 静态站：Hugo + Pages

- 仓库：[github.com/vistao/blog](https://github.com/vistao/blog)
- 主题：PaperMod；评论区用自研 `layouts/partials/comments.html`，不再使用 Waline 大包。
- **发布**：推送到 `main` 后，`.github/workflows/deploy.yml` 会构建并 `wrangler pages deploy` 到 Pages 项目 `blog`。
- **本地**：`./scripts/deploy-pages.sh` 与 CI 行为一致。

改配置、改样式、发文章，都是改仓库 → push，无需登录服务器。

## 评论：API 优先，无账号体系

访客**不需要注册**：填昵称、邮箱（不公开）、正文即可。邮箱用于 Gravatar 头像，且禁止冒充站长邮箱（`me@v2er.org`）。

- 默认 **先审后发**（`AUTO_APPROVE=false`）：提交后提示「审核通过后会显示」，同时 Telegram 收到通知。
- 楼中楼：`parent_id` / `root_id` / `depth`，前端 `static/js/comments.js` 渲染。
- 后端代码在仓库 `comments-worker/`，部署到 Worker **`waline-on-worker`**（历史名称），自定义域名 **`comments.v2er.org`**。

API 示例：

- `GET /api/comments?path=/posts/blog-architecture/`
- `POST /api/comments`（JSON：`path`, `author_name`, `author_email`, `content`）

## 和「机场 / 订阅」的关系

**JMS 多端订阅**（`jms.v2er.org` Worker、Mac Surge 快照等）是另一条线，和本博客评论 **共用 Cloudflare 账号，但服务独立**。博客只负责内容与评论，不承载代理配置。

## 维护备忘

| 事项 | 位置 |
| --- | --- |
| Pages 自动部署 | GitHub Actions + 仓库密钥 `CLOUDFLARE_API_TOKEN` |
| 评论 Worker 部署 | `cd comments-worker && npx wrangler deploy` |
| Bot Token / Chat ID | `~/secrets/app.env`（`envops` 读写） |
| Telegram Webhook | `TELEGRAM_WEBHOOK_SECRET` + `setWebhook` 指向 `comments.v2er.org/telegram/webhook` |

若评论区提交失败，先看浏览器网络里 `comments.v2er.org` 是否 2xx，再在 Worker 日志里查 D1 / Telegram。

---

以后技术笔记和生活随笔都会发在这套架构上；这篇作为固定索引，方便自己和朋友对照。
