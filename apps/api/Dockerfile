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

# ─── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# `--offline`: o store já tem tudo o que o lockfile pede, então não há rede aqui.
RUN pnpm install --offline --frozen-lockfile
# O client do Prisma é gerado antes do compile: o código da API depende dos tipos dele.
RUN pnpm db:generate && pnpm --filter @waymage/api... build

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/

# A árvore inteira de packages, e não um COPY por pacote.
#
# A lista escrita à mão já falhou: `@waymage/billing` e `@waymage/prompt-compiler` nasceram
# depois deste Dockerfile, ninguém os acrescentou, e o build continuou verde — o erro só
# apareceu quando o container subiu em produção e não achou o módulo.
#
# Copiando a árvore, um pacote novo entra sozinho. O que sobra é `src/` e alguns arquivos de
# configuração, que são texto e não pesam perto do cliente do Prisma que já vinha junto.
COPY --from=build /app/packages packages

# Depois dos packages: o install precisa enxergar todo package.json do workspace para montar
# os links entre eles.
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/apps/api/dist apps/api/dist
# O CLI do Prisma vem inteiro porque o entrypoint aplica migrations antes de subir; o schema
# e as migrations já chegaram junto com `packages/`.
COPY --from=build /app/node_modules/prisma node_modules/prisma
COPY --from=build /app/node_modules/.bin/prisma node_modules/.bin/prisma

COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Container roda como usuário sem privilégio. A imagem node já traz o usuário `node`.
USER node

EXPOSE 3333
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
