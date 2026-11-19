# ---------- 构建静态站点 ----------
FROM node:22-alpine AS build
WORKDIR /app
# 装依赖用的 npm 源，国内服务器可改成 https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
# 固定 pnpm 大版本：默认 corepack 会拉最新版，未来可能与锁文件不兼容
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY}
COPY . .
RUN pnpm build

# ---------- 静态站点（nginx） ----------
FROM nginx:1.27-alpine AS web
# 站点配置：静态资源 + 把 /api/ 转发给代理服务
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# 容器启动时按环境变量生成 /config.js（运行时配置，不需要重新构建镜像）
COPY deploy/runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---------- 转发代理（可选，用来绕开厂商接口的跨域限制） ----------
FROM node:22-alpine AS proxy
WORKDIR /app
COPY deploy/proxy-server.mjs /app/proxy-server.mjs
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
USER node
CMD ["node", "/app/proxy-server.mjs"]
