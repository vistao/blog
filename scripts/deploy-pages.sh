#!/usr/bin/env bash
# 本地一键发布（与 GitHub Actions 相同产物）
set -euo pipefail
cd "$(dirname "$0")/.."
ENVOPS="${HOME}/.local/bin/envops"
SECRETS="${HOME}/secrets/app.env"
if [[ -x "$ENVOPS" && -f "$SECRETS" ]]; then
  HUGO_COMMENT_MODERATOR_KEY="$("$ENVOPS" read-value "$SECRETS" -K COMMENT_MODERATOR_KEY --unsafe 2>/dev/null || true)"
  if [[ -n "$HUGO_COMMENT_MODERATOR_KEY" ]]; then
    export HUGO_COMMENT_MODERATOR_KEY
  fi
fi
hugo --minify
npx wrangler@4 pages deploy public --project-name=blog --branch=main --commit-dirty=true
