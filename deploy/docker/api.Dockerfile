# SPDX-License-Identifier: AGPL-3.0-only
# SkillPouch API + worker image. One image, three roles:
#   API_ROLE=api (default) · API_ROLE=worker · API_ROLE=migrate
# Build from the repository root:  docker build -f deploy/docker/api.Dockerfile .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @skillpouch/api...
COPY . .
RUN pnpm --filter @skillpouch/api build \
	&& pnpm --filter @skillpouch/api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ARG SKILLPOUCH_VERSION=dev
ENV NODE_ENV=production \
	SKILLPOUCH_VERSION=$SKILLPOUCH_VERSION \
	PORT=8080 \
	METRICS_PORT=9464
WORKDIR /app
RUN apk add --no-cache tini && addgroup -S -g 10001 skillpouch && adduser -S -u 10001 -G skillpouch skillpouch
# Blob root owned by the runtime user, so a fresh named volume mounted here is writable.
RUN mkdir -p /data/blobs && chown skillpouch:skillpouch /data/blobs
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /out/package.json ./package.json
USER skillpouch
EXPOSE 8080 9464
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
	CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.mjs"]
