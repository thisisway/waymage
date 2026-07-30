# Imagem do worker. Build a partir da RAIZ do monorepo:
#   docker build -f apps/worker-generation/Dockerfile .
#
# O worker NÃO aplica migrations (isso é da API) e não expõe porta: só consome a fila.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
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

FROM deps AS build
COPY . .
RUN pnpm db:generate && pnpm --filter @waymage/worker-generation... build

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/worker-generation/package.json apps/worker-generation/
COPY --from=build /app/packages/database/package.json packages/database/
COPY --from=build /app/packages/domain/package.json packages/domain/
COPY --from=build /app/packages/provider-sdk/package.json packages/provider-sdk/
COPY --from=build /app/packages/scene-spec/package.json packages/scene-spec/
COPY --from=build /app/packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/apps/worker-generation/dist apps/worker-generation/dist
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/provider-sdk/dist packages/provider-sdk/dist
COPY --from=build /app/packages/scene-spec/dist packages/scene-spec/dist
COPY --from=build /app/packages/storage/dist packages/storage/dist
COPY --from=build /app/packages/database/generated packages/database/generated

USER node

# `node` recebe SIGTERM diretamente (sem shell no meio), que é o que dispara o
# encerramento gracioso do worker — jobs em voo terminam antes do processo sair.
CMD ["node", "apps/worker-generation/dist/main.js"]
