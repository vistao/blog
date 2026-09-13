# blog-comments (Cloudflare Worker)

API-first comments for [blog.v2er.org](https://blog.v2er.org/), aligned with [missuo.me/posts/comment-system](https://missuo.me/posts/comment-system/).

## Deploy

```bash
cd comments-worker
npm run db:migrate
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ADMIN_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npm run deploy
```

Set Telegram webhook (after deploy):

```bash
# replace SECRET with TELEGRAM_WEBHOOK_SECRET
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://comments.v2er.org/telegram/webhook?secret=SECRET"
```

## API

- `GET /api/comments?path=/posts/hello/&page=1`
- `GET /api/stats?path=/posts/hello/`
- `POST /api/comments` JSON body — response includes `deleteToken` (store locally to allow author delete)
- `DELETE /api/comments?id=<uuid>` JSON body: `{ "delete_token": "..." }` or `{ "moderator_key": "..." }`

Optional secret `COMMENT_MODERATOR_KEY` lets the site owner delete any comment from the blog UI after running once in the browser console:

```js
sessionStorage.setItem("v2er-comment-mod-key", "<same as COMMENT_MODERATOR_KEY>");
```
