# Imagem do worker. Build a partir da RAIZ do monorepo:
#   docker build -f apps/worker-generation/Dockerfile .
#
# O worker NÃO aplica migrations (isso é da API) e não expõe porta: só consome a fila.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
# `pnpm fetch` popula o store a partir do LOCKFILE, sem precisar saber quais pacotes existem
# no workspace.
#
# A alternativa era um `COPY` por manifesto, e ela já quebrou duas vezes: pacote novo ficava
# de fora e o erro só aparecia no boot em produção; pacote removido derrubava o build inteiro,
# porque o caminho copiado deixara de existir.
#
# De quebra, o cache melhora: esta camada só é refeita quando o lockfile muda, e não a cada
# alteração de manifesto.
COPY pnpm-lock.yaml ./
RUN pnpm fetch

FROM deps AS build
COPY . .
# `--offline`: o store já tem tudo o que o lockfile pede, então não há rede aqui.
RUN pnpm install --offline --frozen-lockfile
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
