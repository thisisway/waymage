# Imagem da API. Build a partir da RAIZ do monorepo:
#   docker build -f apps/api/Dockerfile .
#
# Multi-stage porque a imagem final não deve carregar toolchain nem devDependencies —
# menos superfície instalada é menos CVE para responder depois.

# ─── Base ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ─── Dependências ────────────────────────────────────────────────────────────
FROM base AS deps
# Só os manifestos primeiro: enquanto eles não mudarem, o Docker reaproveita esta camada
# e o install não roda de novo a cada alteração de código.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker-generation/package.json apps/worker-generation/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/provider-sdk/package.json packages/provider-sdk/
COPY packages/scene-spec/package.json packages/scene-spec/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile

# ─── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# O client do Prisma é gerado antes do compile: o código da API depende dos tipos dele.
RUN pnpm db:generate && pnpm --filter @waymage/api... build

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/packages/database/package.json packages/database/
COPY --from=build /app/packages/domain/package.json packages/domain/
COPY --from=build /app/packages/provider-sdk/package.json packages/provider-sdk/
COPY --from=build /app/packages/scene-spec/package.json packages/scene-spec/
COPY --from=build /app/packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/provider-sdk/dist packages/provider-sdk/dist
COPY --from=build /app/packages/scene-spec/dist packages/scene-spec/dist
COPY --from=build /app/packages/storage/dist packages/storage/dist
COPY --from=build /app/packages/database/generated packages/database/generated
# O schema e as migrations vão junto: o entrypoint aplica migrations antes de subir.
COPY --from=build /app/packages/database/prisma packages/database/prisma
COPY --from=build /app/node_modules/prisma node_modules/prisma
COPY --from=build /app/node_modules/.bin/prisma node_modules/.bin/prisma

COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Container roda como usuário sem privilégio. A imagem node já traz o usuário `node`.
USER node

EXPOSE 3333
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
