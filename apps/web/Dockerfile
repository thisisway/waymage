# Imagem do frontend. Build a partir da RAIZ do monorepo:
#   docker build -f apps/web/Dockerfile .
#
# ATENÇÃO: NEXT_PUBLIC_API_URL é embutida no bundle em tempo de BUILD, não lida em runtime.
# Apontar para outra API exige rebuild — no EasyPanel, defina-a como build arg do serviço.

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
ARG NEXT_PUBLIC_API_URL=http://localhost:3333
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm --filter @waymage/web... build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/web/package.json apps/web/

# Aqui a lista é curta de propósito: o frontend depende de UM pacote do workspace, o
# `scene-spec`. Copiar a árvore toda como a API faz traria o cliente do Prisma e as
# dependências do banco para dentro da imagem do browser, sem nenhum uso.
#
# Se `apps/web/package.json` ganhar outro `@waymage/*`, ele precisa aparecer nas duas linhas
# abaixo — senão o container sobe e quebra no primeiro import.
COPY --from=build /app/packages/scene-spec/package.json packages/scene-spec/
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/next.config.mjs apps/web/
COPY --from=build /app/packages/scene-spec/dist packages/scene-spec/dist

USER node

EXPOSE 3000
WORKDIR /app/apps/web

# Caminho relativo ao WORKDIR, e não `../../node_modules`.
#
# pnpm não achata dependências na raiz: `next` fica em `apps/web/node_modules`, ligado ao
# store virtual do workspace. Apontar para a raiz assume o layout do npm e falha no boot com
# MODULE_NOT_FOUND — build verde, container morto.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000"]
