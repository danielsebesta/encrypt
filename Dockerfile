# syntax=docker/dockerfile:1
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
WORKDIR /src
ENV ASTRO_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
ARG COMMIT_SHA=unknown
ARG SOURCE_DATE_EPOCH
RUN BUILD_COMMIT_SHA="$COMMIT_SHA" SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" pnpm run build:node

FROM caddy:2@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e AS caddy

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370
RUN apt-get update \
  && apt-get install -y --no-install-recommends coturn tini libcap2-bin \
  && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-*
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
RUN setcap cap_net_bind_service=+ep /usr/local/bin/caddy \
  && apt-get purge -y libcap2-bin && apt-get autoremove -y \
  && mkdir /data && chown node:node /data
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/encrypt-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/encrypt-entrypoint
WORKDIR /app
COPY --from=build /src/dist ./dist
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
USER node
VOLUME /data
EXPOSE 8080 80 443 3478/udp 3478/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["tini", "--", "encrypt-entrypoint"]
