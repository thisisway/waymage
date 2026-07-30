# Roadmap

Estado atual: **Fases 1 a 5 concluídas — o primeiro marco funcional existe.** Próxima: Fase 6 (créditos).

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

## ✅ Fase 3 — Cenas, versões e autosave

- [x] `Scene` CRUD com rascunho mutável separado dos snapshots (D-024)
- [x] `SceneVersion` imutável, `parentVersionId`, `changeSummary`, duplicação
- [x] Autosave: debounce 800 ms, compare-and-swap no banco, 409 em conflito (D-025)
- [x] Indicador `salvando` / `salvo` / `conflito` / `erro`, com `aria-live`
- [x] Inspetor com as 8 seções do SceneSpec e validação inline
- [x] Linha do tempo das versões
- [x] TanStack Query para dado do servidor, Zustand para o editor (D-027)
- [x] CI no GitHub Actions: lint, typecheck, testes, build e as 3 imagens

**Aceite (verificado):** editar e recarregar preserva o trabalho; a segunda aba salvando com
revisão velha recebe `SCENE_REVISION_CONFLICT` com `currentRevision`, e o valor da primeira
permanece; snapshot congela o rascunho e não muda quando o rascunho evolui; as 8 rotas novas
respondem 404 cross-tenant.

**Pendente da fase:** restaurar uma versão antiga para o rascunho (a duplicação cria cena
nova; restaurar entra na Fase 7 com a linha do tempo interativa).

---

## ✅ Fase 4 — Assets e referências

- [x] `POST /assets/upload-url` (URL assinada) → PUT direto → `POST /assets/complete`
- [x] Tipo real por assinatura de bytes; SVG fora da lista (D-028)
- [x] Tamanho real conferido no bucket, hash SHA-256, quarentena do que não passa
- [x] Worker de miniatura em fila própria + remoção de EXIF comprovada por teste (D-029)
- [x] Biblioteca no painel esquerdo, com status de processamento e polling que para sozinho
- [x] Referências com `role`, `weight` e `preserve`; `ReferenceBinding` materializado no
      snapshot (D-031)
- [x] Exclusão apaga os bytes do bucket e preserva a linha para auditoria

**Aceite (verificado):** upload real do browser ao MinIO (CORS confirmado), miniatura gerada
pelo worker, asset em `READY` com URL assinada. Um HTML com `<script>` declarado como PNG
chega ao bucket, é **recusado** no `complete` com `UNSUPPORTED_FILE_TYPE` e apagado. Um asset
de outro workspace referenciado dentro do SceneSpec é bloqueado com `REFERENCE_ASSET_NOT_FOUND`.

**Pendente da fase:** varredura de malware e política de retenção automática (Fase 10);
análise de referência mais rica que cor dominante e dimensões.

---

## ✅ Fase 5 — Geração ponta a ponta (marco funcional)

- [x] `packages/prompt-compiler` — 10 seções do blueprint, snapshots de teste (D-032)
- [x] Máquina de estados com transições validadas em todo passo (D-033)
- [x] `POST /generation-jobs` com idempotency key e snapshot automático da cena
- [x] Worker: moderar → compilar → rotear → gerar → armazenar → avaliar
- [x] `GET /generation-jobs/:id/events` (SSE com heartbeat, D-034)
- [x] Grade de resultados com seleção e score de aderência
- [x] Resumo, provedor, custo e tempo estimados antes de gerar
- [x] `PromptCompilation` e `ProviderRun` persistidos — nunca só o prompt
- [x] `DevController` removido: a rota real de geração o substituiu

**Aceite (verificado):** clicar em Gerar produz **4 imagens** com progresso real chegando por
SSE (`SUBMITTING → PROCESSING → DOWNLOADING → MODERATING_OUTPUT → EVALUATING → COMPLETED`),
sem nenhuma chave de API. A mesma idempotency key devolve o mesmo job. O banco guarda o
SceneSpec normalizado, o prompt, o negative prompt e a versão do compilador — e nenhuma URL
assinada.

**Pendente da fase:** reserva e captura de créditos (Fase 6) — o job registra a estimativa mas
ainda não debita; variação e refinamento (Fase 7).

---

## 🔜 Fase 6 — Créditos

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
- [ ] Scan de container e `pnpm audit` no CI (o pipeline base já existe desde a Fase 3)
- [ ] Runbook de rollback

---

## Critérios de aceite do MVP

O MVP fecha quando os 20 passos do §34 do blueprint funcionarem ponta a ponta — o que ocorre
ao término da Fase 10.
