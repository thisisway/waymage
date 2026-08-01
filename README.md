# Waymage

Plataforma de geração e edição de imagens com IA, orientada a **cenas** em vez de prompts.

O usuário atua como diretor criativo: descreve a intenção visual e configura sujeito,
cenário, câmera, iluminação, composição, estilo e saída. O sistema converte isso num
`SceneSpec` estruturado, valida conflitos, compila o prompt, escolhe o provedor, executa a
geração de forma assíncrona e guarda os resultados versionados.

> **Estado: Fases 1 a 7 concluídas.** O ciclo criativo fecha: criar cena, anexar referências,
> gerar, comparar lado a lado, **variar**, **refinar** e **exportar** — com um ledger de
> créditos que reserva antes e devolve quando a geração falha. Tudo com um provedor falso, sem
> nenhuma chave de API. Falta edição por máscara e provedores reais.
> Detalhes em [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Requisitos

| Ferramenta | Versão         |
| ---------- | -------------- |
| Node.js    | ≥ 22           |
| pnpm       | ≥ 10           |
| Docker     | com Compose v2 |

---

## Execução local

```bash
# 1. Configuração — nenhum segredo real é necessário
cp .env.example .env

# 2. Dependências
pnpm install

# 3. Infraestrutura: PostgreSQL, Redis e MinIO (bucket criado automaticamente)
pnpm infra:up

# 4. Banco de dados — aplica migrations e gera o Prisma Client
pnpm db:migrate

# 5. Sobe web + api + worker
pnpm dev
```

> O passo 4 é obrigatório antes de `pnpm dev`, `pnpm typecheck` ou `pnpm build`: o Prisma
> Client é gerado ali e o restante do código depende dos tipos dele
> ([D-016](docs/DECISIONS.md#d-016)).

| Serviço          | Endereço                                            |
| ---------------- | --------------------------------------------------- |
| Web              | http://localhost:3000                               |
| API              | http://localhost:3333                               |
| Health           | http://localhost:3333/health                        |
| Console do MinIO | http://localhost:9011 (`minioadmin` / `minioadmin`) |

As portas de infraestrutura são deslocadas das padrão — Postgres em **5442**, Redis em
**6389**, MinIO em **9010/9011** — para conviver com outros projetos na mesma máquina
([D-017](docs/DECISIONS.md#d-017)).

### Verificar que está tudo ligado

```bash
# Postgres, Redis e S3 devem aparecer como "ok"
curl http://localhost:3333/health
```

Depois abra http://localhost:3000, crie uma conta, um projeto e uma cena, e clique em
**Gerar**. O cadastro já cria o workspace; a cena nasce com um SceneSpec válido,
o editor salva sozinho 800 ms depois de cada alteração, e a geração produz 4 imagens com
progresso em tempo real — sem nenhuma chave de API.

---

## Deploy

Alvo: **EasyPanel** ([D-019](docs/DECISIONS.md#d-019)). O roteiro passo a passo está em
[docs/DEPLOY.md](docs/DEPLOY.md). Há um Dockerfile por app, todos buildados a partir da
**raiz** do monorepo:

```bash
docker build -f apps/api/Dockerfile               -t waymage-api .
docker build -f apps/worker-generation/Dockerfile -t waymage-worker .
docker build -f apps/web/Dockerfile               -t waymage-web  \
  --build-arg NEXT_PUBLIC_API_URL=https://api.seudominio.com
```

Pontos que mordem se passarem despercebidos:

- **`API_URL` no serviço web**, sem o prefixo `NEXT_PUBLIC_`: a URL da API é lida em runtime
  ([D-068](docs/DECISIONS.md#d-068)). `NEXT_PUBLIC_API_URL` continua servindo o
  desenvolvimento local, onde ela nunca muda.
- **Só a API aplica migrations**, no entrypoint (`prisma migrate deploy`). O worker sobe
  direto. Defina `RUN_MIGRATIONS=false` se preferir rodá-las como passo separado.
- **`TRUST_PROXY=true`** atrás do proxy do EasyPanel, senão o rate limit enxerga todos os
  requests vindos do mesmo IP.
- **`NODE_ENV=production`** é o que remove as rotas `/dev/*`.
- **`JWT_ACCESS_SECRET` precisa de 32+ caracteres** e a API se recusa a subir sem isso.
- **`COOKIE_SAMESITE=none`** quando web e API não compartilham o site registrável — o que
  inclui os domínios padrão do EasyPanel, porque `easypanel.host` está na Public Suffix List.
  Errar aqui faz o login responder 200 e todo request seguinte voltar 401.
- Storage de produção: Cloudflare R2 ([D-021](docs/DECISIONS.md#d-021)) — só variáveis de
  ambiente, o código é o mesmo. MinIO fica para desenvolvimento local.
- Configure **backup do Postgres para fora do host** antes do primeiro usuário real.

---

## Comandos

| Comando                        | O que faz                                              |
| ------------------------------ | ------------------------------------------------------ |
| `pnpm dev`                     | Sobe web, api e worker com recarga automática          |
| `pnpm check`                   | Lint + typecheck + testes (o que o CI roda)            |
| `pnpm lint`                    | ESLint                                                 |
| `pnpm typecheck`               | TypeScript em modo estrito                             |
| `pnpm test`                    | Vitest em todos os packages                            |
| `pnpm build`                   | Build de produção                                      |
| `pnpm format`                  | Prettier                                               |
| `pnpm db:migrate`              | Aplica migrations em desenvolvimento                   |
| `pnpm db:studio`               | Prisma Studio                                          |
| `pnpm infra:up` / `infra:down` | Sobe/derruba os containers                             |
| `pnpm infra:reset`             | Derruba **e apaga os volumes** (perde os dados locais) |

---

## Estrutura

```text
apps/
  web/                 Next.js (App Router) — shell do editor
  api/                 NestJS + Fastify — HTTP, validação, fila
  worker-generation/   Consumidor BullMQ — provider, storage, eventos

packages/
  scene-spec/          Schema Zod do SceneSpec, tipos, validação de conflitos
  prompt-compiler/     SceneSpec → prompt, por seções e por capabilities do provedor
  billing/             Carteira e ledger append-only, usado por api e worker
  domain/              Contratos api ↔ worker: fila, eventos, máquina de estados
  provider-sdk/        Interface ImageProvider + FakeImageProvider
  storage/             Adapter S3/MinIO e convenção de chaves
  database/            Prisma schema, migrations e client gerado

infra/docker/          Compose de desenvolvimento
docs/                  Arquitetura, decisões, roadmap, segurança
```

---

## Como o sistema funciona

O `SceneSpec` é a fonte da verdade — não a string de prompt. Ele é definido **uma única
vez** em Zod (`packages/scene-spec`) e usado pelo front, pela API e pelo worker, o que
elimina divergência de validação entre as camadas.

```
SceneSpec → validação de conflitos → prompt compiler → ImageProvider → storage
```

A cena tem duas faces: um **rascunho** editável, onde o autosave escreve, e **snapshots
imutáveis** (`SceneVersion`), criados explicitamente e antes de cada geração. Assim toda
imagem gerada aponta para um SceneSpec que não muda mais, sem gerar uma versão por tecla
digitada ([D-024](docs/DECISIONS.md#d-024)).

### Resultados

Cada geração produz uma grade. A partir de qualquer imagem dá para **variar** (mesma
especificação, outra saída), **refinar** (mesma imagem em qualidade final) ou **exportar**
em PNG, JPEG ou WebP. Variação e refinamento registram de qual resultado nasceram, o que
permite ler a linha do tempo de trás para frente.

### Créditos

Cada geração **reserva** créditos antes de começar e só os **captura** quando entrega imagem.
Falha do provedor, timeout ou cancelamento devolvem tudo — o usuário só paga pelo que recebeu.
Rejeição por política de conteúdo é a exceção, porque ali o pedido partiu dele.

O ledger é append-only: nenhum saldo muda sem uma transação correspondente, e
`GET /billing/reconcile` prova que a soma do extrato bate com o saldo.

### Sessão e isolamento

Sessão em cookie `httpOnly` (o front nunca lê o token), com CSRF double-submit nas mutações.
`workspaceId` é sempre resolvido da sessão, nunca aceito do cliente — e recurso de outro
workspace responde 404, não 403, para não confirmar que existe.

A geração é assíncrona: a API valida, reserva créditos e enfileira; o worker executa e
publica progresso por Redis pub/sub, que a API reemite por SSE.

### Provedor falso

A escolha do provedor é do `ModelRouter`. O `FakeImageProvider` simula latência, emite
progresso e gera PNGs determinísticos sem rede e sem custo. Gatilhos de falha ficam no
próprio prompt:

| Gatilho       | Efeito                            |
| ------------- | --------------------------------- |
| `[[fail]]`    | Falha transitória (retentável)    |
| `[[timeout]]` | Job nunca conclui                 |
| `[[blocked]]` | Rejeição por política de conteúdo |

Adapters reais só entram na Fase 9 — depois do fluxo funcionar ponta a ponta.

---

## Segurança

Nenhum segredo no repositório. Toda configuração vem de variável de ambiente validada por
Zod no boot; `.env` está no `.gitignore` e só `.env.example` é versionado, com valores de
desenvolvimento local.

Os controles previstos e o que já está implementado estão em
[docs/SECURITY.md](docs/SECURITY.md). **Não há autenticação em runtime nesta fase** — a API
não deve ser exposta fora de `localhost`.

---

## Documentação

| Documento                                                                                                | Conteúdo                                     |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)                                               | Análise, riscos, fases e critérios de aceite |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                                             | Módulos, fronteiras, fluxos, dados           |
| [docs/DECISIONS.md](docs/DECISIONS.md)                                                                   | Decisões técnicas e o porquê de cada uma     |
| [docs/ROADMAP.md](docs/ROADMAP.md)                                                                       | Fases e estado atual                         |
| [docs/SECURITY.md](docs/SECURITY.md)                                                                     | Modelo de ameaça e controles                 |
| [arquitetura_sistema_geracao_imagens_claude_code.md](arquitetura_sistema_geracao_imagens_claude_code.md) | Blueprint original                           |
