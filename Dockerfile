# syntax=docker/dockerfile:1.7
# ParkSmart: one image, one process. Fastify serves the API and the built web app;
# Litestream (optional) streams the SQLite database to object storage (docs/06, 07).
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 HUSKY=0
RUN corepack enable
WORKDIR /repo

# --- build: install, test-free build, then a production-only node_modules for the API
FROM base AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @parksmart/api deploy --prod --legacy /out/api

# --- runtime: no compilers, no dev dependencies, runs as the unprivileged node user
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG LITESTREAM_VERSION=0.3.13
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tini \
  && ARCH="$(dpkg --print-architecture)" \
  && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${ARCH}.tar.gz" \
     | tar -xz -C /usr/local/bin litestream \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out/api/package.json ./apps/api/package.json
COPY --from=build /out/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/migrations ./apps/api/migrations
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY deploy/litestream.yml deploy/docker-entrypoint.sh ./

RUN mkdir -p /data && chown node:node /data && chmod +x /app/docker-entrypoint.sh
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/parksmart.db
VOLUME ["/data"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--", "/app/docker-entrypoint.sh"]
