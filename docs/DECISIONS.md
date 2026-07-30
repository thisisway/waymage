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

## D-020 — scrypt para senha, refresh token opaco

**Status:** aceita (Fase 2) · substitui parte da [D-009](#d-009)

**Senha com `crypto.scrypt` da stdlib.** scrypt é memory-hard e consta na lista de KDFs
aceitáveis do OWASP. argon2id seria a primeira escolha teórica, mas todas as implementações
para Node são módulos nativos — binário por plataforma, glibc contra musl, compilação em
imagem Docker. Zero dependências vale mais aqui do que a diferença marginal entre os dois.
Parâmetros N=2^17, r=8, p=1, gravados dentro do próprio hash para permitir rotação depois.

**Refresh token opaco, não JWT.** O `.env.example` previa `JWT_REFRESH_SECRET`; ele não
existe mais. Refresh precisa ser revogável _na hora_ — JWT só expira. O token é 32 bytes
aleatórios, guardado apenas como SHA-256: vazamento do banco não permite assumir sessão.

Rotação com detecção de reuso: cada refresh vale uma troca, e um token já consumido que
reaparece significa cookie copiado. A família inteira é revogada, derrubando atacante e dono
— não há como distinguir os dois, e deslogar ambos é o lado seguro do erro.

**O access token não carrega workspace nem papel.** Se carregasse, remover alguém de um
workspace só teria efeito ao expirar o token: até 15 minutos de acesso indevido. A associação
é lida do banco a cada request — consulta indexada, barata perto de autorização defasada.

---

## D-021 — Cloudflare R2 como storage de produção

**Status:** aceita (a implementar no deploy) · complementa [D-007](#d-007) e [D-019](#d-019)

MinIO no mesmo VPS significa que perder o host é perder as imagens dos usuários, que são
irrecuperáveis — diferente do banco, que pode ser restaurado de dump. R2 fala a API do S3,
não cobra egress e o `StorageService` já está pronto: a troca é variável de ambiente, não
código. É exatamente o retorno que a D-007 antecipava.

MinIO continua no `docker-compose.yml` para desenvolvimento local, onde não faz sentido
depender de rede e de credencial externa.

---

## D-022 — CSRF exigido em tudo, menos em login e cadastro

**Status:** aceita (Fase 2)

A sessão vive em cookie (D-009), então o browser a envia sozinho em requisições disparadas
por qualquer site — daí a proteção double-submit: o cookie `wm_csrf`, legível, precisa bater
com o header `x-csrf-token`. Um site atacante consegue fazer o browser mandar o cookie, mas
a same-origin policy o impede de ler o valor para replicar no header.

`/auth/login` e `/auth/register` são a exceção, marcados com `@NoCsrf()`: quem entra pela
primeira vez ainda não tem cookie algum, e exigir o token tornaria o login impossível. Essas
rotas não se autorizam por credencial ambiente — a autorização é o corpo da requisição, que
o atacante não conhece. `/auth/refresh` e `/auth/logout` **continuam exigindo** CSRF, porque
esses sim se autorizam pelo cookie de refresh.

A exceção é decorator explícito, e não regra implícita por caminho: fica auditável em revisão
de código quem está fora da proteção.

---

## D-023 — Guards globais, acesso público é opt-in

**Status:** aceita (Fase 2)

O `AuthGuard` é registrado como `APP_GUARD`: toda rota nasce exigindo sessão, e abrir uma
exige `@Public()` explícito. O contrário — proteger rota a rota — falha por omissão, e a
omissão é silenciosa: ninguém percebe que um endpoint novo ficou aberto até alguém encontrar.

O custo apareceu na hora: `/health` passou a responder 401 e só foi notado ao rodar a imagem
de produção — um balanceador leria isso como serviço fora do ar e entraria em loop de
restart. Está corrigido e coberto por `test/health.integration.test.ts`, para não voltar.

---

## D-024 — Rascunho mutável + snapshots imutáveis

**Status:** aceita (Fase 3)

O blueprint pede duas coisas que, lidas ao pé da letra, se contradizem: autosave com debounce
de 800 ms (§24) e versões imutáveis às quais toda geração aponta (§31, regra 4). Versionar a
cada gravação do autosave produziria milhares de `SceneVersion` por sessão de edição.

A cena passou a ter duas faces:

- **`Scene.draftSpec`** — o rascunho de trabalho, alvo do autosave. Muda o tempo todo.
- **`SceneVersion`** — snapshots imutáveis, criados explicitamente e (a partir da Fase 5)
  automaticamente antes de cada geração.

A garantia que importava fica de pé: toda imagem gerada aponta para um SceneSpec que não
muda mais. O que se descarta é a ideia de que cada tecla digitada merece um número de versão.

---

## D-025 — Autosave é compare-and-swap no banco

**Status:** aceita (Fase 3)

Duas abas abertas na mesma cena é situação comum, não exceção. Ler o registro, comparar a
revisão em memória e depois escrever deixa uma janela entre a leitura e a escrita — a segunda
aba sobrescreve a primeira e ninguém percebe.

O `UPDATE` casa `revision` junto do `id`:

```ts
updateMany({ where: { id, workspaceId, deletedAt: null, revision }, data: { revision: { increment: 1 }, ... } })
```

Zero linhas afetadas significa uma de duas coisas, e a resposta precisa distinguir: a cena
não existe → **404**; existe mas mudou → **409** com `currentRevision`, para o editor mostrar
o conflito em vez de perder o trabalho. No cliente, conflito **trava** o autosave: continuar
tentando sobrescreveria o trabalho da outra aba.

O hook também serializa as gravações. Sem isso, duas respostas podem voltar fora de ordem e a
mais antiga sobrescrever a mais nova — bug que só aparece com rede lenta e é quase impossível
de reproduzir depois.

---

## D-026 — A UI deriva suas opções do schema Zod

**Status:** aceita (Fase 3)

Os `<select>` do inspetor são preenchidos com `shotSchema.options`, `purposeSchema.options` e
afins — nunca com listas escritas à mão. Assim a interface não consegue oferecer um valor que
a API recusaria, e acrescentar uma opção no schema a faz aparecer no editor sozinha.

O que é traduzido é só o rótulo (`components/inspector/labels.ts`). Os **valores** continuam
em inglês porque são contrato: o prompt compiler e os adapters de provedor dependem deles.

---

## D-027 — TanStack Query para dado do servidor, Zustand só para o editor

**Status:** aceita (Fase 3) · blueprint §23

Cena, versões e projetos vivem no cache do TanStack Query. O store do Zustand guarda apenas
estado local do editor: seção aberta, modo de complexidade e, mais adiante, ferramenta ativa
e máscara em edição.

Copiar o SceneSpec para dentro do store criaria uma segunda fonte da verdade, e a divergência
entre as duas é exatamente a classe de bug que a separação do blueprint evita. A edição
atualiza o cache diretamente (`setQueryData`) e o autosave confirma com o servidor.

---

## D-028 — Tipo do arquivo decidido pelos bytes, nunca pelo cliente

**Status:** aceita (Fase 4)

`Content-Type` e extensão são texto enviado pelo usuário. Nada impede pedir URL assinada
declarando `image/png` e subir um HTML com `<script>` — e esse arquivo voltaria ao browser
depois, servido do nosso domínio.

`detectImageType` lê a assinatura dos primeiros bytes e é a única autoridade sobre o tipo. Ela
mora em `packages/domain` porque API e worker precisam da **mesma** função: duas
implementações da mesma regra de segurança divergem na primeira alteração.

Consequências:

- Arquivo não identificado é **apagado do bucket** no ato e a linha vai para `QUARANTINED` —
  não fica guardado esperando alguém descobrir um jeito de servi-lo.
- Quando o declarado difere do real, prevalece o real, com log de aviso.
- O worker verifica de novo antes de processar: entre a confirmação e o processamento, quem
  tivesse a URL assinada ainda válida poderia ter trocado o objeto.
- **SVG está fora** da lista de permitidos. É XML, executa script e é vetor de XSS conhecido.

---

## D-029 — Metadados EXIF removidos no processamento

**Status:** aceita (Fase 4)

EXIF carrega coordenadas de GPS, modelo do aparelho e data. Um retrato enviado como
referência não deveria revelar onde a pessoa estava — e o blueprint §16 pede a remoção.

O `sharp` descarta metadados por padrão; o que os preservaria é `withMetadata()`, que
deliberadamente **não** é chamado. Como isso é uma garantia de privacidade e não um detalhe,
`asset-processor.test.ts` cria um JPEG com EXIF de propósito, confirma que ele está lá e
verifica que sumiu da miniatura — inclusive procurando as strings no arquivo bruto.

`.rotate()` vem antes do resize para aplicar a orientação do EXIF **enquanto ele ainda
existe**; sem isso, fotos de celular sairiam deitadas depois da remoção.

---

## D-030 — `sharp` no worker, e só nele

**Status:** aceita (Fase 4) · cumpre o previsto em [D-018](#d-018)

A D-018 dizia: "miniaturas de uploads reais (Fase 4) são outro problema e aí sim entra uma
biblioteca de imagem". É este o momento. Decodificar JPEG, PNG e WebP arbitrários,
redimensionar com qualidade e remover metadados não se faz à mão.

Fica contido no worker: a API nunca decodifica imagem — ela só lê os primeiros bytes para
identificar o tipo. Assim a superfície de ataque de um decodificador de imagem (historicamente
uma fonte fértil de CVEs) fica fora do processo que atende requisições HTTP.

Na Alpine, o binário do `sharp` depende de `vips-cpp`, instalado no estágio de runtime do
Dockerfile.

---

## D-031 — `ReferenceBinding` é projeção, não fonte da verdade

**Status:** aceita (Fase 4)

As referências vivem dentro do `SceneSpec` (`references[]`), que é a fonte da verdade. As
linhas de `ReferenceBinding` são criadas junto com o snapshot da versão.

Existem para responder "quais cenas usam este asset?" — pergunta necessária para exclusão e
política de retenção, e que não se responde varrendo JSON. Manter as duas em sincronia
contínua seria trabalho dobrado; materializar no snapshot resolve, porque é exatamente aí que
a informação passa a ser permanente.

**Validação de tenancy dentro do JSON:** todo SceneSpec gravado tem seus `assetId` conferidos
contra o workspace. Sem isso, bastaria escrever o UUID de um asset alheio no campo
`references` para usá-lo numa geração — o mesmo IDOR das rotas, entrando por um caminho onde
os guards não olham.

---

## D-013 — Postgres 17, Redis 8, Node 22+

**Status:** aceita (Fase 1)

Versões estáveis e amplamente suportadas pelos provedores gerenciados. Fixadas no
`docker-compose.yml` e em `engines` do `package.json` para que dev e produção não divirjam.
