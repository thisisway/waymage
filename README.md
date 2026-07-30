# Waymage

Plataforma de geração e edição de imagens com IA, orientada a **cenas** em vez de prompts.

O usuário atua como diretor criativo: descreve a intenção visual e configura sujeito,
cenário, câmera, iluminação, composição, estilo e saída. O sistema converte isso num
`SceneSpec` estruturado, valida conflitos, compila o prompt, escolhe o provedor, executa a
geração de forma assíncrona e guarda os resultados versionados.

> **Estado: Fase 1 (fundação) concluída.** Ainda não há autenticação, upload nem geração a
> partir da UI. O que existe roda ponta a ponta com um provedor falso, sem nenhuma chave de
> API. Detalhes em [docs/ROADMAP.md](docs/ROADMAP.md).

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

# Enfileira uma geração: o worker produz 4 PNGs e grava no MinIO
curl -X POST http://localhost:3333/dev/smoke-generation

# Progresso publicado pelo worker
curl http://localhost:3333/dev/events
```

Os arquivos aparecem no console do MinIO, em
`waymage-dev/workspaces/<workspaceId>/…/generations/<jobId>/`.

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
  domain/              Contratos compartilhados api ↔ worker (fila, eventos)
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

Cada alteração de cena cria uma `SceneVersion` imutável, e toda geração aponta para uma
versão específica: sempre dá para saber exatamente o que gerou uma imagem.

A geração é assíncrona: a API valida, reserva créditos e enfileira; o worker executa e
publica progresso por Redis pub/sub, que a API reemite por SSE.

### Provedor falso

`IMAGE_PROVIDER_DEFAULT=fake` é o padrão. O `FakeImageProvider` simula latência, emite
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
