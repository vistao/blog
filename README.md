# George 的博客（Hugo + Cloudflare Pages）

- 站点：https://blog.v2er.org
- 评论 Worker：`comments-worker/`（Worker 名 `blog-comments`，域名 `comments.v2er.org`）

## 发布

推送到 `main` 后，GitHub Actions（`.github/workflows/deploy.yml`）会自动 `hugo --minify` 并发布到 Cloudflare Pages 项目 `blog`。

本地手动发布（与 CI 相同）：

```bash
./scripts/deploy-pages.sh
```
