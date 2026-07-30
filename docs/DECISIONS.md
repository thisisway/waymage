# Registro de decisões

Decisões arquiteturais e seu porquê. Formato leve de ADR. Uma decisão só entra aqui se mudar
o que alguém escreveria no código.

Status: `aceita` · `substituída por D-XXX` · `revisitar na Fase N`

---

## D-001 — Monorepo pnpm + Turborepo com TypeScript estrito

**Status:** aceita (Fase 1) · **Origem:** exigência do blueprint §6.2

Três processos (web, api, worker) compartilham tipos de domínio — sobretudo o `SceneSpec`.
Repositórios separados forçariam publicar pacotes ou duplicar tipos; ambos produzem drift.

`strict: true` mais `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` e
`noImplicitOverride`. `any` proibido pelo ESLint, exceto em wrapper isolado de SDK externo.

---

## D-002 — Modular monolith em `apps/api`, não microserviços

**Status:** aceita (Fase 1)

O blueprint desenha Auth Service, Project Service, Asset Service, Scene Service, Billing
Service e Generation Orchestrator como caixas separadas. Implementá-los como processos
independentes agora custaria rede, deploy, observabilidade distribuída e transações
distribuídas — e o ledger de créditos precisa de transação ACID local.

Cada "service" vira um **módulo NestJS** com fronteira explícita dentro de `apps/api`. O
worker é processo separado porque tem perfil de escala diferente (CPU/IO longo, escala
horizontal), o que é razão real, não estética.

Extrair um módulo para serviço próprio depois é refactor mecânico se as fronteiras de módulo
forem respeitadas. Revisitar quando um módulo específico precisar escalar sozinho.

---

## D-003 — Packages internos compilam para CJS com `tsc`

**Status:** aceita (Fase 1)

NestJS e BullMQ vivem confortáveis em CJS; Next.js consome CJS sem atrito. ESM puro no
monorepo exigiria `.js` em imports relativos, `moduleResolution: nodenext` em todo lugar e
cuidado com dependências CJS-only. Nenhum ganho no curto prazo.

Cada package expõe `main: dist/index.js` + `types: dist/index.d.ts`. Turbo ordena o build via
`dependsOn: ["^build"]`. Sem bundler (tsup/rollup) para código interno — `tsc` basta.

Revisitar se alguma dependência crítica virar ESM-only.

---

## D-004 — `SceneSpec` v1.0 sem migradores

**Status:** aceita (Fase 1) · revisitar quando existir v1.1

O blueprint pede "migradores entre versões futuras". Escrever um migrador antes de existir uma
segunda versão é escrever um `switch` com um `case`.

O que existe hoje: campo `version` obrigatório e literal (`"1.0"`), constante
`SCENE_SPEC_VERSION`, e a função `parseSceneSpec` rejeitando versão desconhecida com mensagem
clara. Quando a v1.1 nascer, `parseSceneSpec` ganha o passo de migração antes da validação —
o ponto de extensão já está no lugar certo.

---

## D-005 — Configuração de lint/TS na raiz, sem packages `config-*`

**Status:** aceita (Fase 1)

O blueprint lista `packages/config-eslint` e `packages/config-typescript`. Esses packages
existem para compartilhar config entre repositórios ou entre times; aqui há um repositório e
um time.

`eslint.config.mjs` e `tsconfig.base.json` na raiz cobrem o mesmo caso com dois arquivos em
vez de dois packages, dois `package.json`, duas entradas de workspace e um passo de build.

Criar os packages quando (e se) a config precisar ser publicada.

---

## D-006 — BullMQ direto, sem interface `Queue` própria

**Status:** aceita (Fase 1)

Não há segunda implementação de fila prevista em nenhuma fase. Uma interface com uma
implementação é indireção pura: esconde a API real do BullMQ (jobs stalled, backoff,
rate limit, flows) sem oferecer nada em troca.

O acoplamento fica contido: só `apps/api/src/queue` e `apps/worker-generation` importam
BullMQ. Trocar de fila seria reescrever esses dois lugares — trabalho equivalente ao de
reimplementar a interface.

---

## D-007 — Storage sempre S3, MinIO em desenvolvimento

**Status:** aceita (Fase 1)

MinIO fala a API do S3. Um adapter de filesystem para desenvolvimento seria um segundo caminho
de código com bugs próprios (URL assinada, expiração, content-type, multipart) e que não
existe em produção — exatamente o tipo de divergência que aparece só no deploy.

Um único `StorageAdapter` sobre `@aws-sdk/client-s3`, apontado ao MinIO em dev pelo
`S3_ENDPOINT` com `forcePathStyle: true`.

---

## D-008 — Schema Prisma completo desde a Fase 1

**Status:** aceita (Fase 1)

Tensão real: construir tabelas antes de usá-las contradiz o princípio de não antecipar. Venceu
o argumento oposto — mudanças de esquema relacional exigem migration, e descobrir na Fase 6
que `GenerationJob` precisa de `workspaceId` significa migrar dados existentes.

O compromisso: todas as **entidades** do blueprint existem, mas cada uma só com os campos que
o blueprint especifica ou que o relacionamento exige. Nenhum campo especulativo, nenhum índice
"por precaução" além de FK e dos filtros já conhecidos (status, `workspaceId`, `createdAt`).

Entidades sem uso na Fase 1 (`BrandKit`, `ConsentRecord`, `ExportJob`, `ModerationDecision`)
ficam com o mínimo e serão detalhadas na fase que as consumir.

---

## D-009 — Sessão por JWT em cookie httpOnly

**Status:** aceita (a implementar na Fase 2)

O blueprint pede `/auth/refresh`, o que implica par access/refresh. Guardar tokens em
`localStorage` expõe a XSS; cookie `httpOnly` + `SameSite=Lax` + `Secure` remove essa classe
inteira de ataque e o front nem toca no token.

Consequência aceita: mutações precisam de proteção CSRF (double-submit token), a ser
implementada junto com a Fase 2. Access token curto (15 min), refresh rotacionado com detecção
de reuso.

---

## D-010 — Zod nas bordas, não `class-validator`

**Status:** aceita (Fase 1)

O blueprint aceita qualquer um dos dois. Zod ganha porque já é obrigatório no front (React
Hook Form) e porque o `SceneSpec` é um schema Zod — usar `class-validator` na API significaria
descrever as mesmas regras duas vezes, em duas linguagens de validação.

Um `ZodValidationPipe` de ~20 linhas cobre o que os decorators fariam, e o tipo do DTO é
inferido do schema em vez de declarado à parte.

---

## D-011 — `FakeImageProvider` como provedor padrão até a Fase 9

**Status:** aceita (Fase 1)

`IMAGE_PROVIDER_DEFAULT=fake` é o padrão do `.env.example`. Nenhuma chave real é necessária
para rodar, testar ou demonstrar o sistema, e um erro de retry não pode gerar cobrança.

O fake simula latência, emite progresso, produz PNG placeholder determinístico (derivado da
seed), e aceita gatilhos de falha e timeout para testar caminhos de erro sem mock de rede.

---

## D-012 — `/health` verifica dependências de verdade

**Status:** aceita (Fase 1)

Um endpoint que responde `200 {"status":"ok"}` sem tocar em nada só prova que o processo
subiu. `/health` executa `SELECT 1` no Postgres, `PING` no Redis e `HeadBucket` no S3,
devolvendo `503` se algum falhar.

Custo: três round-trips por chamada. Se virar problema sob load balancer agressivo,
separar em `/health/live` (processo) e `/health/ready` (dependências).

---

## D-014 — Um modelo `Asset` para todo objeto armazenado

**Status:** aceita (Fase 1)

O blueprint lista `ReferenceAsset` e `MaskAsset` como entidades distintas, e `GenerationResult`
aponta para `asset_id` e `thumbnail_asset_id` — o que implicaria três ou quatro tabelas
guardando os mesmos campos: chave no bucket, MIME, tamanho, hash, dimensões, status.

Existe um único modelo `Asset` com discriminante `kind` (`REFERENCE`, `MASK`, `GENERATED`,
`THUMBNAIL`, `EXPORT`). Um só caminho de código para upload, validação, URL assinada,
retenção e exclusão — quatro cópias dessa lógica seriam quatro lugares para o mesmo bug de
vazamento.

`MaskAsset` continua existindo como entidade separada, mas só com o que é específico de
máscara (`featherPx`, `inverted`); os bytes moram no `Asset` referenciado.

---

## D-015 — API compilada com o CLI do NestJS, não com `tsx`

**Status:** aceita (Fase 1) · descoberta em runtime

`tsx` usa esbuild, que **não implementa `emitDecoratorMetadata`**. Sem esse metadado o
NestJS não consegue resolver dependências por tipo de construtor: a injeção entrega
`undefined` e a aplicação quebra no boot, sem erro de compilação que denuncie a causa.

`apps/api` usa `nest start --watch` e `nest build` (que rodam `tsc`). O worker continua com
`tsx`, porque não usa decorators.

Efeito colateral: `@typescript-eslint/consistent-type-imports` fica **desligado** em
`apps/api`. A regra converte imports de serviços injetados em `import type`, o que apaga o
`design:paramtypes` e reintroduz exatamente essa falha. Regra de estilo não vale quebrar DI.

---

## D-016 — `@waymage/database` expõe o client gerado, sem build próprio

**Status:** aceita (Fase 1)

Um wrapper `src/index.ts` que só reexporta `@prisma/client` acrescentaria um passo de build
e um arquivo para manter, sem acrescentar comportamento. O generator escreve em
`packages/database/generated/client` (saída explícita) e o `package.json` aponta `main` e
`types` direto para lá.

Consequência: o client precisa existir antes de qualquer typecheck. `pnpm db:migrate` gera
ao final da migração, e o README coloca esse passo antes de `pnpm dev`. O diretório
`generated/` está no `.gitignore` — é artefato, não código-fonte.

Os comandos de banco ficam **na raiz** do monorepo, não no package: o Prisma CLI só encontra
o `.env` da raiz quando executa a partir dela.

Não há `postinstall` chamando `db:generate`: o Prisma executa `pnpm add` durante a geração,
o que dispararia o `postinstall` de novo, em recursão infinita.

---

## D-017 — Portas de host deslocadas no Docker Compose

**Status:** aceita (Fase 1)

As portas padrão (5432, 6379, 9000, 9001) costumam já estar tomadas por outros projetos na
mesma máquina de desenvolvimento. Quando isso acontece o container sobe "saudável" mas sem
publicar a porta, e a aplicação conecta silenciosamente no **Postgres do outro projeto** — o
sintoma foi um erro de autenticação difícil de rastrear.

O Waymage usa `5442`, `6389`, `9010` e `9011`, todos ligados apenas a `127.0.0.1`.

---

## D-018 — Encoder PNG próprio no FakeImageProvider

**Status:** aceita (Fase 1)

Gerar a imagem placeholder exigiria `sharp` ou similar — dependência nativa, com binário por
plataforma e tempo de instalação — para produzir um retângulo colorido.

`packages/provider-sdk/src/png.ts` tem ~40 linhas sobre `node:zlib` e não adiciona
dependência alguma. Suporta apenas RGB de 8 bits sem alpha, o que é exatamente o que o fake
precisa. Miniaturas de uploads reais (Fase 4) são outro problema e aí sim entra uma
biblioteca de imagem.

---

## D-019 — EasyPanel como plataforma de deploy

**Status:** aceita (a implementar) · **Repositório:** `github.com/thisisway/waymage`

EasyPanel roda num VPS próprio e entrega, numa interface só, o que este projeto precisa:
três serviços a partir do mesmo repositório (web, api, worker), auto-deploy por push, e
templates de Postgres, Redis e MinIO — as três dependências da Fase 1, sem contratar três
provedores gerenciados.

A alternativa (Vercel + Neon + Upstash + R2) seria mais elástica e mais cara, e ainda assim
não resolve bem o worker, que é um processo longo sem HTTP.

**Decisões que acompanham a escolha:**

1. **Dockerfile por app, não Nixpacks.** O Nixpacks infere o build; com pnpm workspaces,
   `prisma generate` e Turborepo ele infere errado. Um Dockerfile por app é previsível e
   funciona igual na máquina do dev e no servidor.
2. **Migrations no start da API, com trava.** O EasyPanel não tem release phase. O
   `prisma migrate deploy` roda no entrypoint da API antes do `listen`, e só da API — se o
   worker também rodasse, dois containers subindo juntos aplicariam migration em paralelo.
3. **Backup do Postgres desde o primeiro deploy.** Banco e aplicação no mesmo host: perder o
   host é perder tudo. Dump periódico para storage externo, não para o próprio VPS.
4. **MinIO agora, S3/R2 quando o volume justificar.** Imagem de usuário perdida é
   irrecuperável, e o disco do VPS não tem replicação. A troca é uma variável de ambiente,
   não código — é o retorno da [D-007](#d-007).

**Limites aceitos:** host único (sem alta disponibilidade), banco e worker disputando CPU com
a aplicação, escala do worker por réplica manual. Adequado ao MVP; revisitar quando houver
carga real medida.

---

## D-013 — Postgres 17, Redis 8, Node 22+

**Status:** aceita (Fase 1)

Versões estáveis e amplamente suportadas pelos provedores gerenciados. Fixadas no
`docker-compose.yml` e em `engines` do `package.json` para que dev e produção não divirjam.
