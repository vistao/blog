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

/** Gravatar needs MD5; Workers Web Crypto does not support MD5. */
function md5Hex(text) {
  const md5 = (() => {
    function cmn(q, a, b, x, s, t) {
      a = (a + q + x + t) | 0;
      return (((a << s) | (a >>> (32 - s))) + b) | 0;
    }
    function ff(a, b, c, d, x, s, t) {
      return cmn((b & c) | (~b & d), a, b, x, s, t);
    }
    function gg(a, b, c, d, x, s, t) {
      return cmn((b & d) | (c & ~d), a, b, x, s, t);
    }
    function hh(a, b, c, d, x, s, t) {
      return cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function ii(a, b, c, d, x, s, t) {
      return cmn(c ^ (b | ~d), a, b, x, s, t);
    }
    function md5cycle(x, k) {
      let [a, b, c, d] = x;
      a = ff(a, b, c, d, k[0], 7, -680876936);
      d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);
      b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);
      d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);
      b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);
      d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);
      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);
      d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290);
      b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510);
      d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);
      b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);
      d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);
      b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);
      d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);
      b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);
      d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);
      b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558);
      d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);
      b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);
      d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632);
      b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);
      d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);
      b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487);
      d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520);
      b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844);
      d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905);
      b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);
      d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523);
      b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);
      d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);
      b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);
      d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);
      b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = (a + x[0]) | 0;
      x[1] = (b + x[1]) | 0;
      x[2] = (c + x[2]) | 0;
      x[3] = (d + x[3]) | 0;
    }
    function md5blk(s) {
      const md5blks = [];
      for (let i = 0; i < 64; i += 4) {
        md5blks[i >> 2] =
          s.charCodeAt(i) +
          (s.charCodeAt(i + 1) << 8) +
          (s.charCodeAt(i + 2) << 16) +
          (s.charCodeAt(i + 3) << 24);
      }
      return md5blks;
    }
    function md51(s) {
      const n = s.length;
      const state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
      s = s.substring(i - 64);
      const tail = new Array(16).fill(0);
      for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) {
        md5cycle(state, tail);
        tail.fill(0);
      }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    }
    function rhex(n) {
      const hex = "0123456789abcdef";
      let s = "";
      for (let j = 0; j < 4; j++) s += hex.charAt((n >> (j * 8 + 4)) & 0x0f) + hex.charAt((n >> (j * 8)) & 0x0f);
      return s;
    }
    return function (s) {
      return md51(s).map(rhex).join("");
    };
  })();
  return md5(text.trim().toLowerCase());
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
  try {
  const body = await request.json().catch(() => null);
  if (!body?.content) {
    return jsonWithCors({ error: "missing_fields" }, env, request, 400);
  }

  const path = normalizePath(body.path);
  const content = String(body.content).trim().slice(0, 8000);
  const authorUrl = body.author_url ? String(body.author_url).trim().slice(0, 500) : null;
  const parentId = body.parent_id ? String(body.parent_id) : null;
  const anonymous = body.anonymous === true || body.anonymous === "true";

  if (content.length < 2) {
    return jsonWithCors({ error: "invalid_input" }, env, request, 400);
  }

  const id = newId();
  let name;
  let email;
  if (anonymous) {
    name = "匿名";
    email = `anon+${id}@comments.local`;
  } else {
    name = String(body.author_name || "").trim().slice(0, 80);
    email = String(body.author_email || "").trim().toLowerCase().slice(0, 200);
    if (name.length < 2 || !email.includes("@")) {
      return jsonWithCors({ error: "invalid_input" }, env, request, 400);
    }
    const reserved = (env.ADMIN_EMAIL || "me@v2er.org").toLowerCase();
    if (email === reserved) {
      return jsonWithCors({ error: "reserved_email" }, env, request, 403);
    }
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
  const now = nowIso();
  let gravatarHash;
  try {
    gravatarHash = md5Hex(anonymous ? id : email);
  } catch {
    gravatarHash = "00000000000000000000000000000000";
  }
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
      parentId ?? null,
      rootId ?? null,
      depth,
      name,
      email,
      authorUrl ?? null,
      content,
      status,
      gravatarHash,
      meta.country_code ?? null,
      meta.country_name ?? null,
      meta.asn ?? null,
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
  const whoLine = anonymous
    ? `<b>${escapeHtml(name)}</b>（未提供邮箱）`
    : `<b>${escapeHtml(name)}</b> · ${escapeHtml(email)}`;
  const tgText =
    `<b>新评论</b> (${statusLabel})\n` +
    `<a href="${siteOrigin(env)}${path}">${path}</a>\n` +
    `${whoLine}\n` +
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
  } catch (e) {
    console.error(e);
    return jsonWithCors(
      { error: "server_error", detail: String(e?.message || e) },
      env,
      request,
      500,
    );
  }
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
