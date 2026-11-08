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

FROM nginx:1.27-alpine
# Refresh OS packages (clear known alpine CVEs: musl/nghttp2/libxml2/zlib)
RUN apk add --no-cache --upgrade
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
