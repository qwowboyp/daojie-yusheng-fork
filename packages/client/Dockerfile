FROM node:20-alpine AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
ARG PNPM_VERSION=10.29.1
ARG NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}
ENV CHROME_BIN=/usr/lib/chromium/chromium
# Alpine 建置透過 Mesa 軟體 Vulkan 與 Xvfb 執行 WebGL、觸控及滑鼠切換 proof。
RUN sed -i 's#dl-cdn.alpinelinux.org#mirrors.aliyun.com#' /etc/apk/repositories \
  && apk add --no-cache chromium font-noto-cjk mesa-vulkan-swrast xvfb-run
RUN test -x "$CHROME_BIN"
RUN npm install -g "pnpm@${PNPM_VERSION}" --registry="${NPM_CONFIG_REGISTRY}" \
  && pnpm --version
# pnpm store 走 BuildKit 掛載快取：重複 build 不複製 node_modules 層，節省磁碟
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY scripts scripts
COPY packages/shared packages/shared
COPY packages/client packages/client
COPY packages/server/data packages/server/data
COPY docs/artwork/late-game-unique-icons.json docs/artwork/late-game-unique-icons.json
COPY packages/server/src/tools/protocol-audit.ts packages/server/src/tools/protocol-audit.ts
COPY packages/server/src/runtime/instance/map-instance.runtime.ts packages/server/src/runtime/instance/map-instance.runtime.ts
ARG BUILD_CACHEBUST=local
RUN printf '%s\n' "$BUILD_CACHEBUST" >/dev/null
# 保留父 shell：BuildKit 單命令 RUN 會讓 xvfb-run 成為 PID 1，
# Xvfb 不向 PID 1 發送就緒 SIGUSR1，導致建置命令永遠不會啟動。
# 顯式保存退出碼也確保 proof 失敗會阻擋映像建置。
RUN NODE_OPTIONS=--experimental-websocket xvfb-run -a -e /dev/stderr pnpm build:client; \
    result=$?; exit "$result"

FROM nginx:alpine
ENV NGINX_WORKER_PROCESSES=auto
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
COPY packages/client/nginx/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY packages/client/nginx/default.conf.template /etc/nginx/templates/conf.d/default.conf.template
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html
EXPOSE 80
