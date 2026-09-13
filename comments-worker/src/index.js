/**
 * Cloudflare-native blog comments API (Workers + D1 + Telegram moderation).
 * Architecture aligned with https://missuo.me/posts/comment-system/
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

async function md5Hex(text) {
  const buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function gravatarUrl(hash) {
  return `https://www.gravatar.com/avatar/${hash}?s=80&d=identicon`;
}

function newId() {
  return crypto.randomUUID();
}

function normalizePath(path) {
  if (!path || typeof path !== "string") return "/";
  let p = path.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p !== "/" && !p.endsWith("/")) p = `${p}/`;
  return p;
}

function siteOrigin(env) {
  return (env.SITE_URL || "https://blog.v2er.org").replace(/\/$/, "");
}

function corsOrigin(env, request) {
  const allowed = siteOrigin(env);
  const origin = request.headers.get("Origin");
  if (origin && (origin === allowed || origin.endsWith(".pages.dev"))) {
    return { "Access-Control-Allow-Origin": origin, ...CORS_HEADERS };
  }
  return CORS_HEADERS;
}

function jsonWithCors(data, env, request, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsOrigin(env, request) },
  });
}

async function ensurePage(db, path, title) {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO pages (path, title, comment_count, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         title = COALESCE(excluded.title, pages.title),
         updated_at = excluded.updated_at`,
    )
    .bind(path, title || null, now, now)
    .run();
}

async function fetchIpMeta(ip) {
  if (!ip || ip === "127.0.0.1") return {};
  try {
    const res = await fetch(`https://api.ipinfo.es/lite/${encodeURIComponent(ip)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return {
      country_code: data.country_code || data.country || null,
      country_name: data.country_name || data.country || null,
      asn: data.asn ? String(data.asn) : null,
    };
  } catch {
    return {};
  }
}

async function sendTelegram(env, text, replyMarkup) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function moderationKeyboard(commentId, autoApproved) {
  const row = [];
  if (!autoApproved) {
    row.push({ text: "✅ Approve", callback_data: `approve:${commentId}` });
  }
  row.push({ text: "🚫 Spam", callback_data: `spam:${commentId}` });
  row.push({ text: "🗑 Delete", callback_data: `delete:${commentId}` });
  return { inline_keyboard: [row] };
}

async function getComment(db, id) {
  return db.prepare(`SELECT * FROM comments WHERE id = ?`).bind(id).first();
}

async function setCommentStatus(db, id, status) {
  const now = nowIso();
  const row = await getComment(db, id);
  if (!row) return null;
  const prev = row.status;
  await db
    .prepare(`UPDATE comments SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, now, id)
    .run();
  if (prev === "approved" && status !== "approved") {
    await db
      .prepare(
        `UPDATE pages SET comment_count = CASE WHEN comment_count > 0 THEN comment_count - 1 ELSE 0 END, updated_at = ? WHERE path = ?`,
      )
      .bind(now, row.page_path)
      .run();
  }
  if (prev !== "approved" && status === "approved") {
    await db
      .prepare(`UPDATE pages SET comment_count = comment_count + 1, updated_at = ? WHERE path = ?`)
      .bind(now, row.page_path)
      .run();
  }
  return { ...row, status, updated_at: now };
}

function publicComment(row) {
  return {
    id: row.id,
    page_path: row.page_path,
    parent_id: row.parent_id,
    root_id: row.root_id,
    depth: row.depth,
    author_name: row.author_name,
    author_url: row.author_url,
    content: row.content,
    avatar: gravatarUrl(row.gravatar_hash),
    country_code: row.country_code,
    country_name: row.country_name,
    created_at: row.created_at,
  };
}

async function listComments(db, path, page, pageSize) {
  const offset = (page - 1) * pageSize;
  const { results: roots } = await db
    .prepare(
      `SELECT * FROM comments
       WHERE page_path = ? AND status = 'approved' AND (parent_id IS NULL OR parent_id = '')
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(path, pageSize, offset)
    .all();

  const rootIds = roots.map((r) => r.id);
  let replies = [];
  if (rootIds.length) {
    const placeholders = rootIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT * FROM comments
         WHERE page_path = ? AND status = 'approved' AND root_id IN (${placeholders})
         ORDER BY created_at ASC`,
      )
      .bind(path, ...rootIds)
      .all();
    replies = results;
  }

  const byRoot = new Map();
  for (const r of replies) {
    const key = r.root_id || r.id;
    if (!byRoot.has(key)) byRoot.set(key, []);
    byRoot.get(key).push(publicComment(r));
  }

  const threads = roots.map((root) => ({
    ...publicComment(root),
    replies: byRoot.get(root.id) || [],
  }));

  const countRow = await db
    .prepare(`SELECT comment_count FROM pages WHERE path = ?`)
    .bind(path)
    .first();

  const total = countRow?.comment_count ?? 0;
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    comments: threads,
  };
}

async function handleGetComments(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.searchParams.get("path"));
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(5, parseInt(url.searchParams.get("pageSize") || "10", 10)));
  const data = await listComments(env.DB, path, page, pageSize);
  return jsonWithCors(data, env, request);
}

async function handleGetStats(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.searchParams.get("path"));
  const row = await env.DB.prepare(`SELECT comment_count FROM pages WHERE path = ?`).bind(path).first();
  return jsonWithCors({ path, count: row?.comment_count ?? 0 }, env, request);
}

async function handlePostComment(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.content || !body?.author_name || !body?.author_email) {
    return jsonWithCors({ error: "missing_fields" }, env, request, 400);
  }

  const path = normalizePath(body.path);
  const name = String(body.author_name).trim().slice(0, 80);
  const email = String(body.author_email).trim().toLowerCase().slice(0, 200);
  const content = String(body.content).trim().slice(0, 8000);
  const authorUrl = body.author_url ? String(body.author_url).trim().slice(0, 500) : null;
  const parentId = body.parent_id ? String(body.parent_id) : null;

  if (name.length < 2 || !email.includes("@") || content.length < 2) {
    return jsonWithCors({ error: "invalid_input" }, env, request, 400);
  }

  const reserved = (env.ADMIN_EMAIL || "me@v2er.org").toLowerCase();
  if (email === reserved) {
    return jsonWithCors({ error: "reserved_email" }, env, request, 403);
  }

  let depth = 0;
  let rootId = null;
  if (parentId) {
    const parent = await getComment(env.DB, parentId);
    if (!parent || parent.page_path !== path) {
      return jsonWithCors({ error: "invalid_parent" }, env, request, 400);
    }
    depth = Math.min(3, (parent.depth || 0) + 1);
    rootId = parent.root_id || parent.id;
  }

  const autoApprove = env.AUTO_APPROVE === "true";
  const status = autoApprove ? "approved" : "pending";
  const id = newId();
  const now = nowIso();
  const gravatarHash = await md5Hex(email);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const meta = await fetchIpMeta(ip);

  await ensurePage(env.DB, path, body.page_title || null);

  await env.DB.prepare(
    `INSERT INTO comments (
      id, page_path, parent_id, root_id, depth,
      author_name, author_email, author_url, content, status,
      gravatar_hash, country_code, country_name, asn,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      path,
      parentId,
      rootId,
      depth,
      name,
      email,
      authorUrl,
      content,
      status,
      gravatarHash,
      meta.country_code,
      meta.country_name,
      meta.asn,
      now,
      now,
    )
    .run();

  if (status === "approved") {
    await env.DB.prepare(
      `UPDATE pages SET comment_count = comment_count + 1, updated_at = ? WHERE path = ?`,
    )
      .bind(now, path)
      .run();
  }

  const postUrl = `${siteOrigin(env)}${path.startsWith("/") ? path.slice(1) : path}`;
  const preview = content.length > 200 ? `${content.slice(0, 200)}…` : content;
  const statusLabel = autoApprove ? "已公开" : "待审核";
  const tgText =
    `<b>新评论</b> (${statusLabel})\n` +
    `<a href="${siteOrigin(env)}${path}">${path}</a>\n` +
    `<b>${escapeHtml(name)}</b> · ${escapeHtml(email)}\n` +
    `${escapeHtml(preview)}`;

  await sendTelegram(env, tgText, moderationKeyboard(id, autoApprove));

  return jsonWithCors(
    {
      ok: true,
      pending: !autoApprove,
      comment: publicComment({
        id,
        page_path: path,
        parent_id: parentId,
        root_id: rootId,
        depth,
        author_name: name,
        author_url: authorUrl,
        content,
        gravatar_hash: gravatarHash,
        country_code: meta.country_code,
        country_name: meta.country_name,
        created_at: now,
      }),
    },
    env,
    request,
    201,
  );
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function handleTelegramWebhook(request, env) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  const url = new URL(request.url);
  if (secret && url.searchParams.get("secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await request.json().catch(() => null);
  const cb = update?.callback_query;
  if (!cb?.data) return json({ ok: true });

  const [action, commentId] = cb.data.split(":");
  const statusMap = { approve: "approved", spam: "spam", delete: "deleted" };
  const status = statusMap[action];
  if (!status || !commentId) return json({ ok: true });

  const row = await setCommentStatus(env.DB, commentId, status);
  const token = env.TELEGRAM_BOT_TOKEN;
  if (token) {
    const label =
      action === "approve" ? "已批准" : action === "spam" ? "已标为垃圾" : "已删除";
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cb.id, text: label }),
    });
    if (row && cb.message?.chat?.id && cb.message?.message_id) {
      const suffix = `\n\n— <i>${label}</i>`;
      const newText = (cb.message.text || "") + suffix;
      await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cb.message.chat.id,
          message_id: cb.message.message_id,
          text: newText.slice(0, 4000),
          parse_mode: "HTML",
        }),
      });
    }
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsOrigin(env, request) });
    }

    if (url.pathname === "/api/comments" && request.method === "GET") {
      return handleGetComments(request, env);
    }
    if (url.pathname === "/api/stats" && request.method === "GET") {
      return handleGetStats(request, env);
    }
    if (url.pathname === "/api/comments" && request.method === "POST") {
      return handlePostComment(request, env);
    }
    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }
    if (url.pathname === "/" && request.method === "GET") {
      return json({ service: "blog-comments", ok: true });
    }

    return json({ error: "not_found" }, 404);
  },
};
