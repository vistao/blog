#!/usr/bin/env bash
# 本地一键发布（与 GitHub Actions 相同产物）
set -euo pipefail
cd "$(dirname "$0")/.."
hugo --minify
npx wrangler@4 pages deploy public --project-name=blog --branch=main --commit-dirty=true
