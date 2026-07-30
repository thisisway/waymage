# Roadmap

Estado atual: **Fases 1 e 2 concluídas**. Próxima: Fase 3 (cenas, versões e autosave).

Legenda: ✅ concluída · 🔜 próxima · ⬜ planejada

---

## ✅ Fase 1 — Fundação

Repositório executável sem nenhuma dependência de API paga.

- [x] Monorepo pnpm + Turborepo, TypeScript estrito
- [x] ESLint 9 (flat config) + Prettier + Vitest
- [x] `packages/scene-spec` — schema Zod v1.0, tipos, fixtures, 14 regras de conflito, testes
- [x] `packages/domain` — contrato da fila e dos eventos de progresso (api ↔ worker)
- [x] `packages/database` — Prisma, 22 entidades, migration inicial aplicada
- [x] `packages/storage` — `StorageService` S3/MinIO e convenção de chaves
- [x] `packages/provider-sdk` — `ImageProvider`, capabilities, `FakeImageProvider`, registry
- [x] `apps/api` — NestJS + Fastify, env validado, `/health`, filtro de erro, `requestId`
- [x] `apps/worker-generation` — worker BullMQ com FakeImageProvider + storage
- [x] `apps/web` — Next.js App Router + Tailwind, shell e página de status
- [x] Docker Compose: Postgres, Redis, MinIO
- [x] `.env.example`, README, documentação

**Aceite (verificado):** `pnpm check` verde (56 testes); `/health` reporta postgres, redis e
storage como `ok`; `pnpm dev` sobe os três processos; `POST /dev/smoke-generation` percorre
API → fila → worker → FakeImageProvider → MinIO e grava 4 PNGs, sem nenhuma chave de API.

---

## ✅ Fase 2 — Auth, tenancy e imagens de container

- [x] `User` + registro e login (scrypt da stdlib, ver D-020)
- [x] Access token JWT (15 min) + refresh opaco rotacionado com detecção de reuso
- [x] Cookies httpOnly + proteção CSRF double-submit (D-022)
- [x] `Workspace` + `WorkspaceMember` + papéis (OWNER/ADMIN/MEMBER/VIEWER)
- [x] Guard global — `workspaceId` resolvido da sessão, nunca do body (D-023)
- [x] `Project` CRUD com soft delete e RBAC por rota
- [x] `AuditLog` das operações de escrita
- [x] Rate limit em `/auth/*` com contador no Redis
- [x] Telas: login, cadastro, lista de projetos
- [x] Dockerfile por app + entrypoint que aplica migrations
- [x] 14 testes de integração de isolamento cross-tenant

**Aceite (verificado):** Bob recebe **404** — não 403 — ao ler, alterar ou apagar projeto da
Alice; mutação sem CSRF é recusada; login com e-mail inexistente e com senha errada devolvem
resposta idêntica; reuso de refresh revoga a família inteira. As três imagens buildam, e a
imagem de produção aplica migrations, responde `/health` sem sessão e não expõe `/dev/*`.

**Pendente da fase:** convite por e-mail para quem ainda não tem conta (depende de serviço de
e-mail) e troca de workspace ativo na UI (hoje o guard usa a associação mais antiga).

---

## 🔜 Fase 3 — Cenas, versões e autosave

- [ ] `Scene` CRUD
- [ ] `SceneVersion` imutável, `parentVersionId`, `changeSummary`, duplicação
- [ ] Autosave: debounce 800 ms, `revision` otimista, detecção de conflito
- [ ] Estados `salvando` / `salvo` / `erro`
- [ ] Painel direito de propriedades do SceneSpec com validação inline
- [ ] Snapshot explícito antes de gerar

**Aceite:** editar, recarregar, estado preservado; navegar entre duas versões.

---

## ⬜ Fase 4 — Assets e referências

- [ ] `POST /assets/upload-url` (URL assinada) → PUT direto → `POST /assets/complete`
- [ ] Validação de MIME real (magic bytes), tamanho e hash
- [ ] Worker de miniatura + remoção de metadados EXIF
- [ ] Biblioteca no painel esquerdo, com status de processamento
- [ ] `ReferenceBinding` com `role`, `weight`, `preserve`
- [ ] Exclusão com política de retenção

**Aceite:** subir JPEG, ver miniatura, vincular como `identity` peso 0.9, encontrar no SceneSpec persistido.

---

## ⬜ Fase 5 — Geração ponta a ponta (marco funcional)

- [ ] `packages/prompt-compiler` com snapshots de teste
- [ ] Máquina de estados do `GenerationJob`, transições validadas e testadas
- [ ] `POST /generation-jobs` com idempotency key
- [ ] Worker: moderar → compilar → rotear → gerar → armazenar → avaliar
- [ ] `GET /generation-jobs/:id/events` (SSE)
- [ ] Grade de 4 resultados no canvas
- [ ] Resumo da cena e custo estimado antes de gerar

**Aceite:** clicar em Gerar produz 4 placeholders com progresso real, sem chave de API.

---

## ⬜ Fase 6 — Créditos

- [ ] `CreditWallet` + `CreditTransaction` (ledger append-only)
- [ ] `estimate → reserve → capture → release → refund`
- [ ] Idempotência transacional, saldo negativo impossível
- [ ] `UsageLedger` com custo interno e custo do provedor
- [ ] Telas de billing e consumo

**Aceite:** saldo insuficiente bloqueia antes de enfileirar; falha do provedor devolve reserva; soma do ledger = saldo.

---

## ⬜ Fase 7 — Resultados

- [ ] Seleção de resultado
- [ ] `variation` e `refine`
- [ ] Timeline inferior / histórico
- [ ] Comparação lado a lado
- [ ] `ExportJob` + download assinado

---

## ⬜ Fase 8 — Edição localizada

- [ ] Canvas Konva com zoom e pan
- [ ] `MaskAsset`: pintar, apagar, inverter, feather, expandir/contrair
- [ ] `EditOperation` gerando nova versão
- [ ] Before/after e indicação de áreas bloqueadas

---

## ⬜ Fase 9 — Segundo provedor e roteamento

- [ ] Dois adapters reais atrás de `ImageProvider`
- [ ] `ModelRouter` com scoring (capability 0.35 / qualidade 0.25 / custo 0.15 / latência 0.10 / confiabilidade 0.15)
- [ ] Estimativa comparativa e fallback automático
- [ ] Testes de contrato por adapter
- [ ] Painel de execução (`ProviderRun`)

**Primeira fase que usa chave de API real.**

---

## ⬜ Fase 10 — Moderação, consentimento, auditoria e admin

- [ ] Moderação de texto, referências, prompt compilado, imagem final e exportação
- [ ] Decisões `ALLOW` / `ALLOW_WITH_WARNING` / `REVIEW_REQUIRED` / `BLOCK`
- [ ] `ConsentRecord` para pessoas reais, com revogação
- [ ] Política de retenção e exclusão
- [ ] Painel administrativo

---

## ⬜ Fase 11 — Hardening

- [ ] Playwright ponta a ponta com FakeImageProvider
- [ ] Rate limiting, CSP, headers de segurança
- [ ] Acessibilidade e performance
- [ ] OpenTelemetry + Sentry
- [ ] CI: install → lint → typecheck → test → build → migrations check → scan
- [ ] Runbook de rollback

---

## Critérios de aceite do MVP

O MVP fecha quando os 20 passos do §34 do blueprint funcionarem ponta a ponta — o que ocorre
ao término da Fase 10.
