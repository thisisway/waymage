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
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
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
COPY --from=build /app/packages/scene-spec/package.json packages/scene-spec/
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/next.config.mjs apps/web/
COPY --from=build /app/packages/scene-spec/dist packages/scene-spec/dist

USER node

EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--port", "3000"]
