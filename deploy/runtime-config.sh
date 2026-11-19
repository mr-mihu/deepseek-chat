#!/bin/sh
# 容器启动时生成浏览器用的运行时配置。
# 这些变量只在启动容器时读取，改完重启容器即可生效，不需要重新构建镜像。
set -eu

CONFIG_FILE=/usr/share/nginx/html/config.js

PROXY_URL="${CHAT_PROXY_URL:-}"
PROXY_TOKEN="${CHAT_PROXY_TOKEN:-}"
PROVIDERS="${CHAT_PROVIDERS:-[]}"

# 只接受 JSON 数组，写错的配置退化成空数组，避免页面直接报语法错误
case "$PROVIDERS" in
  \[*\]*) ;;
  *) PROVIDERS='[]' ;;
esac

cat > "$CONFIG_FILE" <<EOF
window.__CHAT_DEMO_CONFIG__ = {
  "proxyUrl": "${PROXY_URL}",
  "proxyToken": "${PROXY_TOKEN}",
  "providers": ${PROVIDERS}
};
EOF

echo "[runtime-config] wrote $CONFIG_FILE (proxyUrl='${PROXY_URL}', providers=${PROVIDERS})"
