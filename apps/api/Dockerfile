# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM oven/bun:1.4.4-slim AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
# bun.lock covers every workspace, so all their manifests must be present.
COPY apps/api/package.json apps/api/
COPY apps/engine/package.json apps/engine/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter api

FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY packages/shared packages/shared
COPY apps/api apps/api
USER bun
EXPOSE 4000
CMD ["bun", "apps/api/src/server.ts"]
