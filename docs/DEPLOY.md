# Deploy no EasyPanel

Roteiro do primeiro deploy. Alvo e justificativa em [D-019](DECISIONS.md#d-019).

O que sobe: **três serviços** a partir deste repositório — `web`, `api` e `worker` — mais
Postgres e Redis pelos templates do EasyPanel. Storage em Cloudflare R2
([D-021](DECISIONS.md#d-021)).

---

## Antes de começar

**A ordem importa.** `NEXT_PUBLIC_API_URL` é embutida no build do frontend, não lida em
runtime — então a API precisa existir e ter URL antes de o web ser buildado. Subir o web
primeiro produz uma imagem apontando para `localhost`, e a única correção é rebuildar.

Sequência: Postgres → Redis → **api** → anotar a URL da API → **web** → **worker**.

**O que este deploy entrega.** Enquanto não houver adapter de provedor real, as imagens são
gradientes determinísticos do `FakeImageProvider`. O fluxo inteiro é real — fila, créditos,
storage, SSE, moderação —, o pixel não. É ambiente de validação, não produto.

---

## 1. Postgres e Redis

Templates do EasyPanel. Anote as URLs internas; dentro da rede do projeto elas têm a forma
`postgres://usuario:senha@nome-do-servico:5432/waymage` e `redis://nome-do-servico:6379`.

Ative **backup para fora do host** antes do primeiro usuário real. Banco e aplicação no mesmo
VPS: perder o host é perder tudo.

## 2. Cloudflare R2

Crie o bucket e um token de API com permissão de leitura e escrita nele. As credenciais são
suas — preencha direto no EasyPanel, elas não pertencem ao repositório.

```
S3_ENDPOINT=https://<id-da-conta>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=<nome-do-bucket>
S3_ACCESS_KEY_ID=<token>
S3_SECRET_ACCESS_KEY=<segredo>
S3_FORCE_PATH_STYLE=true
```

## 3. Serviço `api`

- **Build:** Dockerfile `apps/api/Dockerfile`, contexto na **raiz** do repositório.
- **Porta:** `3333`.
- **Health check:** `/health` — responde sem autenticação, de propósito
  ([D-023](DECISIONS.md#d-023)). Sem isso o EasyPanel entra em ciclo de restart.
- As migrations rodam no entrypoint, e **só neste serviço**: dois containers subindo juntos
  aplicariam migration em paralelo.

Variáveis:

```
NODE_ENV=production
API_PORT=3333
DATABASE_URL=<url interna do postgres>
REDIS_URL=<url interna do redis>
APP_URL=<URL pública do serviço web>
JWT_ACCESS_SECRET=<32+ caracteres aleatórios>
TRUST_PROXY=true
COOKIE_SAMESITE=none
LOG_LEVEL=info
# + as seis variáveis de R2 acima
```

Gere o segredo com `openssl rand -base64 48`. A API se recusa a subir com menos de 32
caracteres, o que é proposital: chave curta em HMAC é forçável offline.

### Por que `COOKIE_SAMESITE=none` aqui

`easypanel.host` está na **Public Suffix List**. Isso faz `waymage-web.easypanel.host` e
`waymage-api.easypanel.host` serem **sites diferentes** para o browser, não subdomínios do
mesmo site — e com `SameSite=Lax` o cookie de sessão não acompanha o `fetch`.

O sintoma engana: o login responde 200, e todo request seguinte volta 401.

**Exceção que vale conferir.** Se as duas URLs geradas compartilharem um rótulo antes de
`easypanel.host` — por exemplo `waymage-web.abc123.easypanel.host` e
`waymage-api.abc123.easypanel.host` —, então elas são o mesmo site registrável e `lax`
funciona. Olhe as URLs reais depois de criar os serviços:

| URLs geradas                                                     | Use    |
| ---------------------------------------------------------------- | ------ |
| `waymage-web.easypanel.host` / `waymage-api.easypanel.host`      | `none` |
| `waymage-web.SERVIDOR.easypanel.host` / `waymage-api.SERVIDOR.…` | `lax`  |
| Domínio próprio, mesma raiz (`app.` e `api.`)                    | `lax`  |
| Domínios de raízes diferentes                                    | `none` |

`none` exige HTTPS nas duas pontas — o EasyPanel emite certificado nos domínios padrão, então
confirme que as duas URLs abrem em `https://` antes de escolher.

## 4. Serviço `web`

- **Build:** Dockerfile `apps/web/Dockerfile`, contexto na **raiz**.
- **Build arg:** `NEXT_PUBLIC_API_URL=https://<URL pública da api>` — sem isto o frontend
  buildado aponta para `localhost` e nada funciona.
- **Porta:** `3000`.

Depois de o web existir, volte ao serviço `api` e ajuste `APP_URL` para a URL do web: é ela
que autoriza a origem no CORS. Origem errada bloqueia todo request do browser.

## 5. Serviço `worker`

- **Build:** Dockerfile `apps/worker-generation/Dockerfile`, contexto na **raiz**.
- **Sem porta e sem health check HTTP** — é um processo de fila, não um servidor.
- Mesmas variáveis de banco, Redis e R2 da API. **Não** precisa de `JWT_ACCESS_SECRET`,
  `APP_URL` nem `COOKIE_SAMESITE`.

Escala por réplica manual. Cada réplica consome da mesma fila; a idempotência do job e a
trava de crédito já cobrem execução concorrente.

---

## Verificação depois de subir

1. `GET https://<api>/health` → `status: ok` e as três dependências em `ok`. É o mesmo
   endpoint que o EasyPanel usa para decidir se o container está vivo.
2. Cadastro pela tela do web. Se o cadastro passa e a tela seguinte volta 401, é o
   `COOKIE_SAMESITE` — confira a tabela acima.
3. Gere uma cena. Quatro imagens em poucos segundos, com progresso ao vivo: isso exercita
   API, Redis, fila, worker e R2 de uma vez.
4. Confira em `/billing` que o crédito saiu do disponível e voltou como consumo.

## O que ainda não está pronto para tráfego real

Nada disto impede o deploy de validação, mas cada item é uma dívida consciente antes de
convidar usuário de verdade:

- **Sem provedor real** — as imagens são placeholder até a Fase 9 fechar.
- **Fase 11 inteira**: CSP, varredura de container, Playwright, OpenTelemetry e Sentry.
- **CI nunca observado verde** — `pnpm check` e `pnpm build` passam localmente, mas o
  workflow do GitHub Actions não foi visto rodando.
- **`REVIEW_REQUIRED` falha o job** em vez de entrar em fila, porque o painel de revisão é da
  Fase 10 e ainda não existe.
