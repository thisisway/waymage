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

## D-032 — Prompts compostos em ingles, texto do usuario preservado

**Status:** aceita (Fase 5)

Modelos de imagem sao treinados majoritariamente em ingles e respondem melhor ao vocabulario
fotografico nessa lingua — "waist-up shot, shallow depth of field" produz resultado mais
previsivel que a traducao literal.

O que **nao** e traduzido e o texto livre do usuario: descricao do sujeito, local, pose. Passar
isso por traducao automatica introduziria erro sem ganho, e o modelo lida bem com trechos em
portugues dentro de uma estrutura em ingles.

A ordem das secoes (§10.3 do blueprint) nao e decorativa: modelos de difusao dao mais peso ao
inicio do prompt, entao o que define a imagem vem antes do que a refina.

**Travas viram afirmacao, nao negacao.** "preserve the face" funciona melhor que "don't change
the face" — modelos de difusao lidam mal com negacao, e um negativo mal interpretado vira
justamente o que se queria evitar.

---

## D-033 — Maquina de estados explicita, com transicao validada

**Status:** aceita (Fase 5)

Um job de geracao custa dinheiro. Cada transicao indevida e um credito capturado duas vezes,
uma reserva nunca liberada ou um resultado gravado num job que ja havia falhado. Deixar o
fluxo implicito em `if`s espalhados pelo worker torna esses casos invisiveis ate acontecerem.

`assertTransition` roda a cada passo do pipeline. Estados terminais nao tem saida — reabrir um
job concluido e impossivel por construcao, nao por disciplina.

Mora em `packages/domain` porque API e worker precisam concordar: a API cria em `QUEUED` e
cancela; o worker conduz o resto.

---

## D-034 — SSE escrito na resposta crua, nao com `@Sse()`

**Status:** aceita (Fase 5)

SSE e nao WebSocket: o fluxo e de mao unica e o navegador reconecta sozinho. A autenticacao
funciona porque `EventSource` envia cookies — nao funcionaria com header `Authorization`, que
a API deliberadamente nao usa (D-009).

O decorator `@Sse()` do Nest nao serviu por dois motivos:

1. **Tenancy antes dos headers.** O 404 de recurso alheio precisa sair _antes_ de qualquer
   byte do stream; com `@Sse()` o erro chegava depois de a resposta ja ter comecado.
2. **Heartbeat.** Proxies derrubam conexao ociosa, e uma geracao pode passar minutos entre
   transicoes. Um comentario SSE a cada 20s mantem a conexao viva — no EasyPanel isso nao e
   opcional. `x-accel-buffering: no` acompanha, senao o proxy segura os eventos e o progresso
   chega todo de uma vez, no fim.

Uma conexao Redis por processo, com `psubscribe` e fan-out em memoria: uma conexao em modo
subscribe nao aceita outros comandos, e abrir uma por aba do editor esgotaria o limite do
Redis com meia duzia de usuarios.

---

## D-035 — Moderacao e avaliacao existem como passo, nao como implementacao

**Status:** aceita (Fase 5) · substituir na Fase 10

O pipeline tem `MODERATING_INPUT`, `MODERATING_OUTPUT` e `EVALUATING` desde ja, com
implementacoes declaradamente rasas: uma lista de termos e algumas verificacoes que nao
exigem olhar a imagem (proporcao entregue, se as travas _podiam_ ser cumpridas).

A escolha e ter o ponto de insercao e o estado correspondente no lugar certo, para que trocar
por um servico externo seja substituir uma funcao — nao reescrever o worker e migrar dados.

**Isto nao e seguranca.** A lista de termos nao entende contexto, idioma nem intencao, e e
trivial de contornar. O `notEvaluated` no resultado e explicito sobre o que ainda nao e
medido, para ninguem ler o score de aderencia como mais do que ele e.

---

## D-036 — Saldo negativo impossivel por constraint, nao por checagem

**Status:** aceita (Fase 6)

O blueprint §15.1 exige "impedir saldo negativo". Verificar em codigo protege o caminho
conhecido; a constraint `CHECK (balance >= 0)` protege contra o desconhecido — um script de
manutencao, uma correcao manual em producao, um caminho novo com bug. O banco recusa e a
transacao inteira volta atras.

Coberto por teste: uma escrita direta de `balance = -1` via Prisma e recusada pelo Postgres.

**Credito e inteiro.** Ponto flutuante em dinheiro acumula erro de arredondamento que ninguem
consegue explicar depois; `assertPositive` recusa valor nao inteiro na entrada.

---

## D-037 — Reserva e compare-and-swap, nao leitura seguida de escrita

**Status:** aceita (Fase 6) · mesmo padrao da [D-025](#d-025)

Duas geracoes simultaneas nao podem passar ambas pela verificacao de saldo. Ler, comparar em
memoria e depois escrever deixa uma janela entre a leitura e a escrita — e nessa janela as
duas veem saldo suficiente.

A condicao faz parte da propria escrita:

```ts
updateMany({ where: { id, balance: { gte: amount } }, data: { balance: { decrement: amount }, ... } })
```

Zero linhas afetadas significa saldo insuficiente. O Postgres avalia isso atomicamente.

Coberto por teste: dez reservas de 30 disparadas juntas contra 100 disponiveis — exatamente
tres passam, e `balance + reserved` continua 100.

Duas decisoes de implementacao vieram de falha real no teste: usar `findUnique` em vez de
`upsert` (o upsert tomava lock de escrita antes de sabermos se havia saldo, serializando cedo
demais) e elevar o timeout da transacao, porque o padrao de 5 s do Prisma derrubava as ultimas
da fila.

---

## D-038 — Ledger append-only; o saldo e cache do extrato

**Status:** aceita (Fase 6) · blueprint §15.2

Nenhum saldo muda sem uma `CreditTransaction` correspondente, gravada na mesma transacao de
banco. O extrato e a verdade; `wallet.balance` existe para nao somar a tabela inteira a cada
leitura.

`GET /billing/reconcile` soma todas as transacoes e compara com o saldo. Divergir significa
que algum saldo mudou sem transacao — exatamente o que a regra proibe. Esta exposto de
proposito: se acontecer, alguem precisa conseguir ver sem acesso ao banco.

**Semantica dos movimentos:**

| Movimento     | Disponivel | Reservado | Por que                                         |
| ------------- | ---------- | --------- | ----------------------------------------------- |
| `RESERVATION` | −N         | +N        | Sai do disponivel ao criar o job                |
| `CAPTURE`     | —          | −N        | O disponivel ja saiu na reserva; some a reserva |
| `RELEASE`     | +N         | −N        | Devolve por inteiro                             |

`CAPTURE` grava `amount: 0` justamente porque nao move o disponivel — e o que mantem a soma do
extrato igual ao saldo.

---

## D-039 — Quem paga a falha

**Status:** aceita (Fase 6)

A reserva acontece **antes** de enfileirar. Enfileirar primeiro abriria uma janela em que a
geracao roda e o pagamento falha depois; e se a reserva falha, o job vai para `FAILED` em vez
de ficar em `QUEUED`, senao o worker o pegaria e geraria de graca.

No fim do pipeline, quem paga depende de quem falhou — e a classificacao ja existia em
`ProviderError.refundable` desde a Fase 1:

- **Falha do provedor, timeout, erro interno, cancelamento** → `release`. O usuario nao
  recebeu imagem nenhuma; nao pode pagar.
- **Rejeicao por politica de conteudo** → `capture`. O pedido partiu do usuario e o custo foi
  incorrido.

Toda operacao tem chave idempotente derivada do job (`reserve:<id>`, `capture:<id>`,
`release:<id>`), garantida por indice unico. Um retry do worker nao cobra duas vezes.

Falha ao acertar o credito e registrada mas **nao** substitui o erro original — esconder a
causa raiz atras de um erro de contabilidade tornaria o incidente indecifravel.

---

## D-040 — 100 creditos de boas-vindas

**Status:** aceita (Fase 6)

Sem eles, a primeira coisa que o usuario encontra depois de se cadastrar e uma tela dizendo
que nao pode gerar nada. Com o `FakeImageProvider` o custo real e zero; com provedor real,
100 creditos sao 25 geracoes de rascunho — o suficiente para avaliar o produto.

Concedido como `BONUS` com chave `welcome:<workspaceId>`, entao reprocessar o cadastro nao
credita duas vezes.

---

## D-041 — Variacao reusa a versao da cena; refinamento reusa a seed

**Status:** aceita (Fase 7)

Variar e refinar partem do mesmo resultado mas pedem coisas opostas ao provedor.

**Variacao** quer outra saida da MESMA especificacao: reusa a `SceneVersion` do job de origem
e sorteia uma seed nova. Tirar snapshot novo aqui misturaria edicoes feitas na cena depois da
geracao — e a comparacao entre as duas imagens deixaria de significar alguma coisa.

**Refinamento** quer a MESMA saida com mais detalhe: preserva a seed do resultado de origem,
sobe a qualidade para `final` e reduz a contagem para **uma** imagem. Trocar a seed produziria
uma imagem diferente, que nao e o que foi pedido; e renderizar quatro vezes em qualidade final
gastaria credito para explorar algo que o usuario ja escolheu.

O refinamento tambem anexa a imagem de origem como referencia de composicao, para o provedor
ver o que precisa manter.

`GenerationJob.sourceResultId` registra a linhagem, o que permite reconstruir
"rascunho A → variacao A2 → refino final" na linha do tempo.

---

## D-042 — Exportacao converte formato no worker, um arquivo por resultado

**Status:** aceita (Fase 7)

Exportar e assincrono porque a conversao usa `sharp`, que so existe no worker — a API nunca
decodifica imagem, e manter a superficie de ataque de um decodificador fora do processo HTTP
e a razao da [D-030](#d-030). Aqui essa decisao paga de novo, sem custo extra.

**Sem ZIP.** Empacotar exigiria uma dependencia de arquivamento para um caso que ainda nao
sabemos se acontece: quem exporta a grade inteira baixa quatro arquivos. Trocar por ZIP e
acrescentar um passo no processador quando o uso justificar.

A URL de download e assinada com `Content-Disposition: attachment` **dentro da assinatura**:
o nome do arquivo nao pode ser alterado por quem tiver o link, e `attachment` impede que um
conteudo inesperado seja renderizado pelo browser a partir do dominio do storage.

Export expira em 7 dias — e derivado e reconstruivel, entao guarda-lo para sempre so ocupa
espaco.

---

## D-043 — Comparacao e estado de tela, nao do servidor

**Status:** aceita (Fase 7)

Quais duas imagens estao lado a lado agora nao e informacao que outra aba, outro usuario ou
o proximo login precisem conhecer. Vive em `useState` na pagina do editor.

Limite de dois: com tres, deixa de ser comparacao lado a lado e vira uma grade menor — que ja
existe logo acima.

---

## D-044 — Way Cloud Design System como base visual

**Status:** aceita · substitui a identidade improvisada das Fases 1 a 7

O produto pertence a uma familia de produtos Way Cloud, e ter identidade propria por
aplicacao fragmenta a marca. O DS v1.0 passa a ser a fonte: `#1D66FF` (Way Blue) como
primaria, `#0B1023` (Way Dark) como fundo, Plus Jakarta Sans, escala tipografica, raios
(6/8/12/16/999) e sombras — incluindo o "glow" azul, reservado ao que esta ativo ou em foco.

**O que o DS nao especifica e precisou ser derivado:**

1. **Superficies intermediarias do modo escuro.** O DS define so `#0B1023`. Uma interface de
   editor precisa de niveis de elevacao, entao a rampa (`#10162E` → `#161D3B` → `#1D2649` →
   borda `#232C52`) foi derivada preservando o matiz azulado, para que todos os niveis
   pertencam a mesma familia em vez de virarem cinza.

2. **Movimento.** Duracoes e curvas nao estao documentadas. Foram definidas como token —
   `--ease-out` (expo, sensacao de resposta imediata), `--ease-spring` (leve ultrapassagem,
   so em selecao) e quatro duracoes — e nao soltas em cada componente: animacao inconsistente
   e o que faz uma interface parecer barata.

A fonte entra por `next/font` e nao por `<link>` para o Google: os arquivos sao servidos do
nosso dominio, o que elimina requisicao a terceiro, evita o salto de layout da troca de fonte
e mantem a CSP fechada.

`prefers-reduced-motion` desliga todas as transicoes. Nao e opcional — animacao causa enjoo e
desorientacao em pessoas com sensibilidade vestibular, e o estado final continua o mesmo.

---

## D-045 — Movimento responde perguntas, nao decora

**Status:** aceita

Cada animacao da interface existe para responder algo especifico:

| Movimento                                      | Pergunta que responde              |
| ---------------------------------------------- | ---------------------------------- |
| Indicador do segmentado desliza entre posicoes | "de onde para onde a selecao foi?" |
| Cartao sobe 1px e ganha sombra no hover        | "isso e clicavel?"                 |
| Opcao recua 3% no clique                       | "meu clique registrou?"            |
| Resultados entram em cascata de 60ms           | "em que ordem devo ler isto?"      |
| Contorno do botao Gerar pulsa                  | "ainda esta trabalhando?"          |
| Silhueta da previa desliza ao mudar a posicao  | "o que esse controle faz?"         |
| Shimmer no lugar do resultado                  | "isto vai ser preenchido"          |

O que nao respondia nada foi cortado. O criterio para acrescentar movimento novo e o mesmo:
se nao houver pergunta, nao ha animacao.

---

## D-046 — Superficies em cinza neutro, nao na Way Dark

**Status:** aceita · ajusta a [D-044](#d-044)

O DS define `#0B1023` como fundo. Aplicado ao editor inteiro, o resultado foi uma tela
uniformemente azulada em que o proprio Way Blue se dissolvia — o botao primario deixava de
parecer primario.

Mas o argumento decisivo nao e estetico: **isto e uma ferramenta de trabalho com imagem.**
Qualquer dominante de cor no fundo contamina a percepcao do que esta sendo produzido; um
fundo azulado faz a imagem gerada parecer mais quente do que ela e. Figma, Lightroom,
Photoshop e DaVinci usam cinza neutro por essa razao, nao por gosto.

As superficies passam a ser cinza neutro (`#171717` → `#1E1E1E` → `#262626` → `#303030`,
borda `#2E2E2E`). As sombras acompanham, em preto neutro: com fundo cinza, a sombra azulada
do DS deixava um halo colorido em volta de cada cartao.

**O Way Blue continua sendo o acento, e ganha com a mudanca** — sobre cinza ele destaca de
verdade. A marca permanece; o que muda e o palco.

---

## D-047 — A capa do projeto e a ultima imagem que ele gerou

**Status:** aceita

Reconhecer um projeto pelo que ele produziu e imediato; ler o nome de doze projetos, nao. A
lista passa a ser um navegador de arquivos com capa, como o Figma faz com as thumbnails de
canvas — so que a nossa capa e a propria entrega do produto.

`ProjectView.previewUrl` traz a URL assinada do ultimo `Asset` gerado. Uma consulta unica
para todos os projetos, e nao uma por projeto: a lista e a primeira tela depois do login, e
N+1 ali apareceria como lentidao logo na entrada.

Projeto ainda sem geracao recebe um gradiente derivado do proprio id — estavel, entao o mesmo
projeto tem sempre a mesma cor e a lista continua reconhecivel de relance desde o primeiro
dia.

---

## D-048 — Complexidade progressiva esconde secoes, nao valores

**Status:** aceita (Fase 7)

Rapido / Guiado / Pro mudam o que esta a vista, nunca o `SceneSpec`. Um campo escondido
mantem o valor que tinha, e trocar de modo revela em vez de reconfigurar — trocar para Rapido
e voltar nao pode custar a iluminacao que a pessoa ja tinha ajustado.

Rapido mostra intencao, sujeito e saida: o minimo para gerar. Pro acrescenta seed, negative
prompt e escolha de provedor, que sao os controles onde errar e barato para quem sabe o que
faz e caro para quem nao sabe.

A lista mora em `VISIBLE`, no `editor-store` — uma tabela, nao `if`s espalhados pelo
inspetor.

---

## D-049 — Arrastar e colar sao a mesma entrada de referencia

**Status:** aceita (Fase 7)

O texto dizia "arraste ou clique" e so o clique funcionava. Arrastar passou a valer na coluna
inteira da biblioteca, e nao so na area vazia: depois do primeiro upload a area vazia some, e
o alvo nao deveria sumir junto.

`Ctrl+V` com imagem na area de transferencia entrou pelo mesmo caminho — e o gesto mais curto
que existe para trazer um print, e quem trabalha com imagem tenta por reflexo. Ignorado
quando o foco esta em campo de texto, onde colar pertence ao campo.

Um arquivo por vez: lote pertence a uma fase que tenha fila e progresso por item.


---

## D-013 — Postgres 17, Redis 8, Node 22+

**Status:** aceita (Fase 1)

Versões estáveis e amplamente suportadas pelos provedores gerenciados. Fixadas no
`docker-compose.yml` e em `engines` do `package.json` para que dev e produção não divirjam.
