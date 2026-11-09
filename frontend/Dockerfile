# it-help-chatbot web frontend — static SPA served by nginx (same-origin /api proxy).
# Build: docker build -t <registry>/it-help-chatbot-frontend:0.1.0 frontend/
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
# Build-time API base: "" → same-origin (nginx proxies /api -> backend). Omit for Tauri (absolute URL).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# v1.0.57 — the stock nginx image runs its master process as root so it can bind :80.
# This one is built to run as uid 101 with the pid file and temp dirs already writable,
# and listens on :8080 instead — the Service maps :80 -> :8080, so nothing upstream
# changes. Root in a container is a privilege-escalation foothold we do not need here.
FROM nginxinc/nginx-unprivileged:1.27-alpine
# Refresh OS packages (clear known alpine CVEs: musl/nghttp2/libxml2/zlib). apk needs
# root, and this image ends with `USER 101` — so step back up for the upgrade and drop
# again immediately; nothing runs as root afterwards.
USER root
RUN apk add --no-cache --upgrade
USER 101
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
