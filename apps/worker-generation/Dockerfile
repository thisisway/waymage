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
COPY packages/billing/package.json packages/billing/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/prompt-compiler/package.json packages/prompt-compiler/
COPY packages/provider-sdk/package.json packages/provider-sdk/
COPY packages/scene-spec/package.json packages/scene-spec/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm db:generate && pnpm --filter @waymage/worker-generation... build

FROM base AS runtime
ENV NODE_ENV=production
# O sharp usa libvips; na Alpine o binário pré-compilado depende destas bibliotecas.
RUN apk add --no-cache vips-cpp

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/worker-generation/package.json apps/worker-generation/

# A árvore inteira de packages, pelo mesmo motivo da API: enumerar um COPY por pacote deixa
# um pacote novo de fora sem quebrar o build, e o erro só aparece no boot em produção.
COPY --from=build /app/packages packages

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/apps/worker-generation/dist apps/worker-generation/dist

USER node

# `node` recebe SIGTERM diretamente (sem shell no meio), que é o que dispara o
# encerramento gracioso do worker — jobs em voo terminam antes do processo sair.
CMD ["node", "apps/worker-generation/dist/main.js"]
