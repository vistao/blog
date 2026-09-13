(function () {
  const root = document.getElementById("blog-comments");
  if (!root) return;

  const apiBase = root.dataset.api || "https://comments.v2er.org";
  const pagePath = root.dataset.path || location.pathname;
  const pageTitle = root.dataset.title || document.title;
  const DELETE_TOKENS_KEY = "v2er-comment-delete-tokens";
  const MODERATOR_KEY_STORAGE = "v2er-comment-mod-key";

  function loadDeleteTokens() {
    try {
      return JSON.parse(localStorage.getItem(DELETE_TOKENS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveDeleteToken(commentId, token) {
    if (!commentId || !token) return;
    const map = loadDeleteTokens();
    map[commentId] = token;
    localStorage.setItem(DELETE_TOKENS_KEY, JSON.stringify(map));
  }

  function getDeleteToken(commentId) {
    return loadDeleteTokens()[commentId] || "";
  }

  function moderatorKey() {
    return sessionStorage.getItem(MODERATOR_KEY_STORAGE) || "";
  }

  function canDeleteComment(commentId) {
    return Boolean(getDeleteToken(commentId) || moderatorKey());
  }

  const elList = root.querySelector("[data-bc-list]");
  const elCount = root.querySelector("[data-bc-count]");
  const elForm = root.querySelector("[data-bc-form]");
  const elMsg = root.querySelector("[data-bc-msg]");
  const elLoadMore = root.querySelector("[data-bc-load-more]");
  const elAnon = root.querySelector("[data-bc-anonymous]");
  const elIdentityFields = root.querySelectorAll("[data-bc-identity]");

  function setAnonymousMode(on) {
    elIdentityFields.forEach((el) => {
      el.hidden = on;
      const inputs = el.matches("input, textarea")
        ? [el]
        : [...el.querySelectorAll("input, textarea")];
      inputs.forEach((input) => {
        input.required = !on;
        if (on) input.value = "";
      });
    });
  }

  elAnon?.addEventListener("change", () => setAnonymousMode(elAnon.checked));
  setAnonymousMode(elAnon?.checked ?? false);

  let page = 1;
  let totalPages = 1;
  let replyParentId = null;

  function flagEmoji(code) {
    if (!code || code.length !== 2) return "";
    const u = code.toUpperCase();
    return String.fromCodePoint(...[...u].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  async function deleteComment(c) {
    if (!canDeleteComment(c.id)) return;
    if (!confirm("确定删除这条评论？")) return;
    const payload = { delete_token: getDeleteToken(c.id) || undefined };
    const mk = moderatorKey();
    if (mk) payload.moderator_key = mk;
    try {
      const res = await fetch(`${apiBase}/api/comments?id=${encodeURIComponent(c.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        elMsg.textContent = data.error === "forbidden" ? "无法删除该评论。" : "删除失败，请稍后再试。";
        elMsg.className = "bc-msg err";
        return;
      }
      const map = loadDeleteTokens();
      delete map[c.id];
      localStorage.setItem(DELETE_TOKENS_KEY, JSON.stringify(map));
      page = 1;
      await loadComments(false);
      elMsg.textContent = "评论已删除。";
      elMsg.className = "bc-msg ok";
    } catch {
      elMsg.textContent = "网络错误，请稍后再试。";
      elMsg.className = "bc-msg err";
    }
  }

  function renderItem(c, isReply) {
    const li = document.createElement("li");
    li.className = isReply ? "bc-item bc-reply" : "bc-item";
    li.dataset.id = c.id;
    const nameHtml = c.author_url
      ? `<a href="${esc(c.author_url)}" rel="nofollow noopener" target="_blank">${esc(c.author_name)}</a>`
      : esc(c.author_name);
    const flag = c.country_code ? `<span class="bc-flag" title="${esc(c.country_name || "")}">${flagEmoji(c.country_code)}</span>` : "";
    const showDelete = canDeleteComment(c.id);
    const actions = [];
    if (!isReply) {
      actions.push('<button type="button" class="bc-action-btn bc-reply-btn">回复</button>');
    }
    if (showDelete) {
      actions.push('<button type="button" class="bc-action-btn bc-delete-btn">删除</button>');
    }
    const actionsHtml = actions.length
      ? `<div class="bc-actions">${actions.join('<span class="bc-action-sep" aria-hidden="true">·</span>')}</div>`
      : "";
    li.innerHTML = `
      <img class="bc-avatar" src="${esc(c.avatar)}" alt="" loading="lazy" width="40" height="40" />
      <div class="bc-body">
        <div class="bc-head">
          <span class="bc-name">${nameHtml}</span>
          ${flag}
          <time class="bc-time" datetime="${esc(c.created_at)}">${esc(c.created_at)}</time>
        </div>
        <div class="bc-content">${esc(c.content)}</div>
        ${actionsHtml}
      </div>`;
    li.querySelector(".bc-reply-btn")?.addEventListener("click", () => startReply(c));
    li.querySelector(".bc-delete-btn")?.addEventListener("click", () => deleteComment(c));
    return li;
  }

  function startReply(c) {
    replyParentId = c.id;
    elForm.querySelector("[name=content]").focus();
    elMsg.textContent = `正在回复 ${c.author_name}`;
    elMsg.className = "bc-msg";
  }

  function renderThread(thread) {
    const wrap = document.createElement("li");
    wrap.className = "bc-thread-root";
    const ul = document.createElement("ul");
    ul.className = "bc-thread";
    ul.appendChild(renderItem(thread, false));
    if (thread.replies?.length) {
      const rep = document.createElement("div");
      rep.className = "bc-replies";
      const rul = document.createElement("ul");
      rul.className = "bc-thread";
      thread.replies.forEach((r) => rul.appendChild(renderItem(r, true)));
      rep.appendChild(rul);
      ul.lastElementChild.querySelector(".bc-body").appendChild(rep);
    }
    wrap.appendChild(ul);
    return wrap;
  }

  async function loadComments(append) {
    const url = `${apiBase}/api/comments?path=${encodeURIComponent(pagePath)}&page=${page}&pageSize=10`;
    const res = await fetch(url);
    const data = await res.json();
    if (!append) elList.innerHTML = "";
    if (!data.comments?.length && page === 1) {
      elList.innerHTML = '<p class="bc-empty">暂无评论，来说两句吧。</p>';
    } else {
      data.comments.forEach((t) => elList.appendChild(renderThread(t)));
    }
    totalPages = data.totalPages || 1;
    if (elCount) elCount.textContent = String(data.total ?? 0);
    elLoadMore.hidden = page >= totalPages;
  }

  elLoadMore?.addEventListener("click", () => {
    page += 1;
    loadComments(true);
  });

  elForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    elMsg.textContent = "";
    elMsg.className = "bc-msg";
    const fd = new FormData(elForm);
    const anonymous = fd.get("anonymous") === "on";
    const payload = {
      path: pagePath,
      page_title: pageTitle,
      content: fd.get("content"),
      parent_id: replyParentId,
      anonymous,
    };
    if (!anonymous) {
      payload.author_name = fd.get("author_name");
      payload.author_email = fd.get("author_email");
      payload.author_url = fd.get("author_url") || undefined;
    }
    const btn = elForm.querySelector(".bc-submit");
    btn.disabled = true;
    try {
      const res = await fetch(`${apiBase}/api/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        elMsg.textContent =
          data.error === "reserved_email" ? "该邮箱不可用于评论。" : "提交失败，请稍后再试。";
        elMsg.className = "bc-msg err";
        return;
      }
      if (data.deleteToken && data.comment?.id) {
        saveDeleteToken(data.comment.id, data.deleteToken);
      }
      elMsg.textContent = data.pending
        ? "评论已提交，审核通过后会显示。"
        : "评论已发布。";
      elMsg.className = "bc-msg ok";
      elForm.reset();
      replyParentId = null;
      page = 1;
      await loadComments(false);
    } catch {
      elMsg.textContent = "网络错误，请稍后再试。";
      elMsg.className = "bc-msg err";
    } finally {
      btn.disabled = false;
    }
  });

  loadComments(false);
})();
