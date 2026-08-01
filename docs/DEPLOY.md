# Deploy no EasyPanel — passo a passo

Roteiro do primeiro deploy, na ordem de execução. Alvo e justificativa em
[D-019](DECISIONS.md#d-019).

Sobem **cinco serviços** dentro de um projeto: Postgres e Redis pelos templates, e `api`,
`web` e `worker` a partir deste repositório. O storage fica fora do VPS, no Cloudflare R2
([D-021](DECISIONS.md#d-021)).

> Os nomes de botão do EasyPanel mudam entre versões. Onde o texto exato importar menos que a
> função, o passo descreve o que procurar. Onde um valor precisa ser exato — caminho de
> Dockerfile, porta, nome de variável — ele está literal.
>
> **A página de um serviço tem vários cartões empilhados**, e os campos de build estão
> divididos entre dois deles: **Fonte** diz de onde vem o código, **Compilação** diz como
> transformá-lo em imagem. Cada cartão tem o seu próprio botão _Salvar_.

---

## Antes de começar

Tenha em mãos:

- Um VPS com EasyPanel instalado e acesso de administrador.
- Acesso ao repositório `github.com/thisisway/waymage` pela integração de GitHub do EasyPanel.
- Uma conta Cloudflare para o R2.

**Memória.** O build do Next.js é a etapa mais pesada e derruba VPS de 2 GB por falta de
memória. Com 4 GB passa com folga. Se o build do `web` morrer sem mensagem clara, é isso —
adicione swap ou suba a máquina antes de procurar culpa no código.

**A ordem importa e não é preciosismo.** `NEXT_PUBLIC_API_URL` é embutida no build do
frontend, não lida em runtime: se o `web` for buildado antes de a API ter URL, a imagem sai
apontando para `localhost` e a única correção é rebuildar.

```
Postgres → Redis → R2 → api → (anotar URL) → web → APP_URL na api → worker
```

**O que este deploy entrega.** Enquanto não houver adapter de provedor real, as imagens são
gradientes determinísticos do `FakeImageProvider`. Fila, créditos, storage, SSE e moderação são
reais; o pixel não é. É ambiente de validação, não produto.

---

## Passo 0 — Gere o segredo agora

```bash
openssl rand -base64 48
```

Guarde no seu gerenciador de senhas. A API se recusa a subir com menos de 32 caracteres, e
isso é proposital: chave curta em HMAC é forçável offline, e o token assinado é o que autoriza
toda a API.

Este valor não entra no repositório em nenhuma hipótese.

---

## Passo 1 — Crie o projeto

No EasyPanel, **Projects → Create Project**. O nome é seu — o guia usa `waymage`, mas
qualquer um serve, desde que os cinco serviços fiquem no mesmo projeto.

Tudo daqui em diante vive dentro dele. Serviços do mesmo projeto se enxergam por rede interna
— é assim que a API fala com o banco sem expor Postgres à internet.

---

## Passo 2 — Postgres

**+ Serviço → Postgres.**

| Campo   | Valor      |
| ------- | ---------- |
| Nome    | `postgres` |
| Banco   | `waymage`  |
| Usuário | `waymage`  |
| Senha   | gere uma   |

Depois de criar, abra o serviço e copie a **URL de conexão interna** que o EasyPanel exibe
(algo como `postgres://waymage:senha@waymage_postgres:5432/waymage`). Use exatamente a string
que a tela mostrar — o formato do host varia com a versão, e chutar aqui custa uma rodada de
deploy.

**Não publique porta.** O banco só precisa ser alcançável de dentro do projeto.

### Backup

Ainda nesta tela, configure backup para destino **externo** — S3, R2, qualquer coisa fora deste
VPS. Banco e aplicação no mesmo host: perder o host é perder tudo. Faça isso antes do primeiro
usuário real, não depois do primeiro susto.

---

## Passo 3 — Redis

**+ Serviço → Redis.** Nome: `redis`. Copie a URL interna do mesmo jeito
(`redis://waymage_redis:6379`).

Redis aqui é fila (BullMQ) e canal de eventos do progresso ao vivo, não cache descartável —
mas nada nele é fonte da verdade: o estado dos jobs está no Postgres.

---

## Passo 4 — Cloudflare R2

No painel da Cloudflare, **R2 → Create bucket**. Nome: `waymage`.

Depois, **Manage R2 API Tokens → Create API token**, com permissão de **leitura e escrita**
apenas nesse bucket. Anote o Access Key ID, o Secret e o ID da conta — o segredo aparece uma
vez só.

Guarde estes seis valores, que vão para a API e para o worker:

```
S3_ENDPOINT=https://<ID-DA-CONTA>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=waymage
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=true
```

O bucket fica **privado**. O app entrega as imagens por URL assinada de expiração curta; um
bucket público tornaria toda imagem de todo cliente acessível a quem descobrisse a URL.

---

## Passo 5 — Serviço `api`

**+ Serviço → App.** Nome: `api`.

**Cartão Fonte** — aba **Github** (não a aba _Dockerfile_, que serve para colar um Dockerfile
inline):

| Campo            | Valor               |
| ---------------- | ------------------- |
| Repositório      | `thisisway/waymage` |
| Ramo             | `main`              |
| Caminho de Build | `/`                 |

**Salvar.**

O "Caminho de Build" é o **contexto** do `docker build`, e fica na raiz mesmo o app estando em
`apps/api`. É contraintuitivo e é de propósito: num monorepo pnpm, o Dockerfile precisa
enxergar `pnpm-workspace.yaml` e os `packages/` para instalar e gerar o cliente Prisma.

**Cartão Compilação** — role a página até ele. Método **Dockerfile**:

| Campo                | Valor                 |
| -------------------- | --------------------- |
| Arquivo (Dockerfile) | `apps/api/Dockerfile` |

**Salvar.**

**Environment** — cole tudo de uma vez:

```
NODE_ENV=production
API_PORT=3333
DATABASE_URL=<URL interna do Postgres, do passo 2>
REDIS_URL=<URL interna do Redis, do passo 3>
JWT_ACCESS_SECRET=<o segredo do passo 0>
APP_URL=http://localhost:3000
TRUST_PROXY=true
COOKIE_SAMESITE=lax
LOG_LEVEL=info
S3_ENDPOINT=https://<ID-DA-CONTA>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=waymage
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=true
```

`APP_URL` e `COOKIE_SAMESITE` estão provisórios de propósito. O passo 8 corrige os dois, quando
as URLs reais existirem.

**Domains:** adicione um domínio. Aceite o padrão do EasyPanel e **confirme que o HTTPS está
ativo** — o resto depende disso.

**Advanced → Health Check:**

| Campo | Valor     |
| ----- | --------- |
| Path  | `/health` |
| Port  | `3333`    |

`/health` responde sem autenticação de propósito ([D-023](DECISIONS.md#d-023)) e reporta
Postgres, Redis e storage separadamente. Sem ele configurado, uma falha de dependência vira
"funciona mas erra"; com ele apontando para rota autenticada, o EasyPanel entra em ciclo de
restart eterno.

**Deploy.** No log você deve ver `Aplicando migrations...` seguido do Prisma criando as
tabelas, e depois `API em http://localhost:3333 (production)`.

As migrations rodam no entrypoint e **só neste serviço**. Se algum dia precisar separá-las,
`RUN_MIGRATIONS=false` desliga.

---

## Passo 6 — Decida o `COOKIE_SAMESITE`

Copie a URL pública que o EasyPanel deu à API. Antes de seguir, olhe o **formato** dela — é ele
que decide se a sessão vai funcionar.

`easypanel.host` está na **Public Suffix List**. Na prática, o browser trata
`waymage-api.easypanel.host` e `waymage-web.easypanel.host` como **sites diferentes**, não como
subdomínios do mesmo site. Com `SameSite=Lax` o cookie de sessão não acompanha o `fetch`, e o
sintoma engana: o cadastro responde 200 e todo request seguinte volta 401
([D-066](DECISIONS.md#d-066)).

| Formato das duas URLs                                            | `COOKIE_SAMESITE` |
| ---------------------------------------------------------------- | ----------------- |
| `waymage-api.easypanel.host` / `waymage-web.easypanel.host`      | `none`            |
| `waymage-api.SERVIDOR.easypanel.host` / `waymage-web.SERVIDOR.…` | `lax`             |
| Domínio próprio, mesma raiz (`api.` e `app.`)                    | `lax`             |
| Domínios de raízes diferentes                                    | `none`            |

A regra por trás da tabela: se as duas URLs **compartilham um rótulo antes de
`easypanel.host`**, são o mesmo site e `lax` serve. Se cada uma tem o seu, são sites distintos
e precisa de `none`.

`none` exige HTTPS nas duas pontas — por isso a confirmação do certificado no passo anterior.

Anote a decisão; ela é aplicada no passo 8.

---

## Passo 7 — Serviço `web`

**+ Serviço → App.** Nome: `web`.

**Cartão Fonte** — aba **Github**, igual à API:

| Campo            | Valor               |
| ---------------- | ------------------- |
| Repositório      | `thisisway/waymage` |
| Ramo             | `main`              |
| Caminho de Build | `/`                 |

**Cartão Compilação** — método **Dockerfile**:

| Campo                | Valor                 |
| -------------------- | --------------------- |
| Arquivo (Dockerfile) | `apps/web/Dockerfile` |

**Cartão Ambiente** — a variável que a maioria esquece:

```
NEXT_PUBLIC_API_URL=https://<URL pública da api>
```

Ela é **embutida no bundle durante o build**, não lida em runtime. O `apps/web/Dockerfile` já
declara o `ARG` correspondente, e a documentação do EasyPanel diz que as variáveis de ambiente
"são fornecidas ao build e ao container em execução" — então definir aqui basta.

**Como saber se funcionou:** depois do deploy, abra o app e olhe o console do browser. Se os
requests forem para `localhost:3333`, o valor não chegou ao build. Nesse caso a saída é fazer o
próprio Next servir de proxy para a API, com URL lida em runtime — o que também dispensaria o
`COOKIE_SAMESITE` do passo 6.

**Domains:** adicione um domínio, com a porta interna `3000`.

**Deploy.** A tela de login deve abrir.

---

## Passo 8 — Feche o laço na API

Volte ao serviço `api` e ajuste duas variáveis, agora com os valores reais:

```
APP_URL=https://<URL pública do web>
COOKIE_SAMESITE=<o que você decidiu no passo 6>
```

**Redeploy da API.**

`APP_URL` é a origem autorizada no CORS — sessão por cookie exige origem explícita, porque
aceitar qualquer uma junto de credenciais anularia a proteção do `SameSite`. Com o valor
errado, o browser bloqueia todo request e o console mostra erro de CORS.

---

## Passo 9 — Serviço `worker`

**+ Serviço → App.** Nome: `worker`.

**Cartão Fonte** — aba **Github**, igual aos outros: repositório `thisisway/waymage`, ramo
`main`, Caminho de Build `/`.

**Cartão Compilação** — método **Dockerfile**:

| Campo                | Valor                               |
| -------------------- | ----------------------------------- |
| Arquivo (Dockerfile) | `apps/worker-generation/Dockerfile` |

**Cartão Ambiente:**

```
NODE_ENV=production
DATABASE_URL=<mesma da api>
REDIS_URL=<mesma da api>
LOG_LEVEL=info
S3_ENDPOINT=https://<ID-DA-CONTA>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=waymage
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=true
```

**Não** defina `JWT_ACCESS_SECRET`, `APP_URL` nem `COOKIE_SAMESITE` aqui — o worker não atende
HTTP, não tem sessão e não precisa de nenhum deles.

**Sem domínio e sem health check HTTP.** É um processo de fila; o EasyPanel vai reiniciá-lo em
loop se esperar uma porta que nunca abre.

Escala por réplica manual. Cada réplica consome da mesma fila, e a idempotência do job com a
trava de crédito já cobrem execução concorrente.

---

## Passo 10 — Verificação

Nesta ordem, porque cada passo exercita uma camada a mais:

1. **`GET https://<api>/health`** → `status: ok`, com `postgres`, `redis` e `storage` cada um
   em `ok`. Se algum estiver diferente, a resposta já diz qual — pare aqui e resolva.
2. **Cadastre-se pela tela do web.** Se o cadastro passa e a tela seguinte volta 401, é o
   `COOKIE_SAMESITE`: volte ao passo 6.
3. **Crie um projeto e uma cena, e gere.** Quatro imagens em poucos segundos com progresso ao
   vivo. Isso exercita API, Redis, fila, worker e R2 de uma vez — é o teste que vale.
4. **Abra `/billing`.** O crédito saiu do disponível e aparece como consumo. Se ficou preso em
   "reservado", o worker não concluiu o job.
5. **Exporte uma imagem.** Fecha o ciclo: conversão no worker e download por URL assinada.

---

## Auto-deploy

Em cada um dos três serviços de app, ative o deploy automático por push e copie a URL do
webhook para **Settings → Webhooks** do repositório no GitHub.

Uma ressalva: um push que muda só o backend também rebuilda o `web`, e é ali que mora o build
pesado. Se o VPS for apertado, prefira deploy manual do `web`.

---

## Se der errado

| Sintoma                                          | Causa provável                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Cadastro dá 200, tudo depois dá 401              | `COOKIE_SAMESITE` errado para o formato das URLs (passo 6)               |
| Erro de CORS no console do browser               | `APP_URL` da API não é exatamente a URL do web, com `https://`           |
| Telas carregam vazias, requests para `localhost` | `NEXT_PUBLIC_API_URL` não chegou ao build do web — precisa rebuild       |
| Campo de Dockerfile não aparece no cartão Fonte  | Ele fica no cartão **Compilação**, mais abaixo na mesma página           |
| API reinicia sem parar                           | Health check apontando para rota que exige autenticação, ou porta errada |
| API sobe e morre no boot                         | Variável obrigatória faltando — o log diz o nome dela                    |
| `JWT_ACCESS_SECRET precisa de ao menos 32…`      | Segredo curto; gere de novo com `openssl rand -base64 48`                |
| Build do web morre sem mensagem                  | Memória do VPS; adicione swap ou suba a máquina                          |
| Geração fica em `QUEUED` para sempre             | Worker não subiu, ou está com `REDIS_URL` diferente da API               |
| Imagem gerada não carrega na tela                | Credencial do R2 sem permissão de escrita, ou `S3_ENDPOINT` errado       |
| Crédito preso em "reservado"                     | Worker caiu no meio do job; o log dele aponta o passo                    |

A API falha no boot, e não no primeiro request, exatamente para que esses casos apareçam no log
do deploy em vez de virarem 500 intermitente às 3h da manhã.

---

## Dívidas conhecidas antes de convidar usuário real

Nada disto impede o deploy de validação, mas é o que separa "está no ar" de "pode receber
gente":

- **Sem provedor real** — as imagens são placeholder até a Fase 9 fechar com um adapter.
- **Fase 11 inteira**: CSP, varredura de container, Playwright, OpenTelemetry e Sentry.
- **CI nunca observado verde** — `pnpm check` e `pnpm build` passam localmente, mas o workflow
  do GitHub Actions não foi visto rodando.
- **`REVIEW_REQUIRED` falha o job** em vez de entrar em fila, porque o painel de revisão é da
  Fase 10 e ainda não existe.
- **Backup do Postgres** — se você pulou o passo 2, volte lá.
