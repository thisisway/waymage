# Roadmap

Estado atual: **Fases 1 a 8 concluídas; Fases 9 e 10 parciais.** O modelo de negócio mudou
para mensalidade + chave do próprio usuário (BYOK, D-070): os créditos foram removidos, e o
que falta do BYOK é o adapter real do provedor.

Estado anterior: O roteamento, o fallback e a suíte
de contrato estão prontos e verificados contra dois provedores fake de perfis diferentes. Os
dois adapters reais dependem de chave de API e, portanto, de autorização.

Legenda: ✅ concluída · 🔜 próxima · ⬜ planejada

**Fora da numeração original:** o modelo de negócio mudou para mensalidade + chave do próprio
usuário (D-070). O BYOK está completo; a assinatura tem o modelo e o bloqueio (D-080), e falta
a integração com a Stripe.

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

## ✅ Fase 6 — Créditos

- [x] `packages/billing` — ledger append-only, usado por API e worker (D-038)
- [x] `estimate → reserve → capture → release`, com chave idempotente derivada do job
- [x] Saldo negativo impossível por `CHECK` no banco, não por checagem (D-036)
- [x] Reserva por compare-and-swap: reservas simultâneas não estouram o saldo (D-037)
- [x] `UsageLedger` com imagens produzidas, créditos cobrados e custo do provedor
- [x] 100 créditos de boas-vindas no cadastro (D-040)
- [x] Tela de créditos com extrato, e saldo na topbar do editor
- [x] `GET /billing/reconcile` — conferência de integridade exposta

**Aceite (verificado):** saldo insuficiente devolve **402** e não enfileira nada; falha do
provedor (`[[fail]]`) **devolve** os 4 créditos; rejeição por política de conteúdo
(`[[blocked]]`) **cobra**; cancelar devolve por inteiro; dez reservas simultâneas contra saldo
para três resultam em exatamente três aceitas; a soma do extrato bate com o saldo em todos os
casos.

**Pendente da fase:** compra de créditos (depende de gateway de pagamento) e limite por plano
— `planCode` existe no workspace mas ainda não altera nada.

---

## ✅ Fase 7 — Resultados

- [x] Seleção de resultado (desde a Fase 5)
- [x] `variation` — mesma versão da cena, seed nova (D-041)
- [x] `refine` — mesma seed, qualidade final, uma imagem só
- [x] Linhagem em `sourceResultId`; histórico de gerações por cena
- [x] Comparação lado a lado, limitada a duas imagens (D-043)
- [x] `ExportJob` com conversão de formato no worker e download assinado (D-042)

**Aceite (verificado):** contra a infra real, o histórico da cena mostra
`TEXT_TO_IMAGE → VARIATION (4 imagens) → REFINE (1 imagem)`, ambas as derivações apontando
para o mesmo resultado de origem; a exportação converte o PNG para JPEG de verdade (assinatura
`FF D8 FF`, 14 KB) e a URL vem com `Content-Disposition: attachment`.

**Pendente da fase:** ZIP para exportação de múltiplos resultados (hoje baixa um arquivo por
imagem) e restaurar uma versão antiga da cena para o rascunho.

---

## ✅ Fase 8 — Edição localizada

- [x] Canvas de pintura com zoom e pan (sem Konva — ver D-050)
- [x] `MaskAsset`: pintar, apagar, limpar, inverter, feather
- [x] `EditOperation` ligada ao job, à máscara e ao asset produzido
- [x] `POST /generation-results/:id/edit` → job `MASKED_EDIT`, uma imagem, seed preservada
- [x] `ImageProvider.edit()` no pipeline, com imagem base e máscara fora de `references`
- [x] Expandir/contrair a máscara, por desfoque com limiar (D-053)
- [x] Resultado composto através da máscara: fora dela, os pixels originais (D-078)
- [x] Base enviada ao provedor com a região contornada (D-078)
- [x] Desfazer no editor de máscara, com `Ctrl+Z` e colchetes para espessura
- [x] Antes-e-depois com cortina entre o resultado de origem e o editado (D-054)
- [x] Travas do SceneSpec no inspetor, e aviso das ativas no editor de máscara (D-055)

**Aceite (verificado):** `pnpm check` verde (204 testes); fluxo real contra Postgres, Redis e
MinIO — gerar 4 rascunhos → pintar máscara → `MASKED_EDIT` → PNG de 6.477 bytes no bucket,
seed preservada (772914146 → 772914146) e carteira em 95 créditos (4 do rascunho + 1 da
edição). `EditOperation` fecha a linhagem com `resultAssetId`, e `ProviderRun` não guarda
nenhuma URL assinada.

---

## 🔜 Fase 9 — Segundo provedor e roteamento

- [x] `ModelRouter` com scoring (capability 0.35 / qualidade 0.25 / custo 0.15 / latência 0.10 / confiabilidade 0.15)
- [x] Elegibilidade separada da pontuação (D-056)
- [x] Confiabilidade calculada da última hora de `ProviderRun`
- [x] Estimativa comparativa, com o motivo de cada descarte
- [x] Fallback automático, com reserva complementada só quando a troca ocorre (D-058)
- [x] Suíte de contrato rodando contra dois perfis (D-061)
- [x] Painel de execução: tentativas visíveis quando houve troca de provedor
- [x] Adapter real do Google Gemini, com a chave do usuário (D-070, D-075)
- [ ] **Pendente:** um segundo fornecedor real, quando houver demanda

**O que falta é a única parte que exige chave de API real — e portanto autorização.** Até lá,
dois perfis fake (`fake-rapido` e `fake-estudio`) diferem em custo, latência, teto de saídas e
capacidades, que é o que o roteador pesa.

**Aceite (verificado):** `pnpm check` verde (238 testes); contra Postgres, Redis e MinIO — a
estimativa lista os dois provedores com preço e motivo; ligar fundo transparente inverte a
escolha e descarta `fake-rapido` com a justificativa; e um job com falha dirigida
(`[[fail:fake-rapido]]`) cai para `fake-estudio`, grava as duas tentativas em `ProviderRun`,
recompila o prompt para o segundo (sem negative prompt, dobrado no principal), completa a
reserva de 1 para 3 e cobra 3 — carteira 100 → 97, nada preso em reserva.

---

## 🔜 Fase 10 — Moderação, consentimento, auditoria e admin

- [x] Moderação nos cinco pontos: texto, referência, prompt compilado, imagem final, exportação
- [x] Decisões `ALLOW` / `ALLOW_WITH_WARNING` / `REVIEW_REQUIRED` / `BLOCK` (D-062)
- [x] Barrado por nós devolve o crédito; barrado pelo fornecedor não (D-063)
- [x] Ressalvas visíveis na tela junto do resultado
- [ ] **Pendente:** `ConsentRecord` para pessoas reais, com revogação
- [ ] **Pendente:** política de retenção e exclusão
- [ ] **Pendente:** painel administrativo — sem ele, `REVIEW_REQUIRED` falha o job em vez de
      entrar numa fila, porque não existe quem revise

**Aceite (verificado):** `pnpm check` verde (247 testes); contra Postgres, Redis e MinIO, as
quatro cenas — `BLOCK`, `REVIEW_REQUIRED`, `ALLOW_WITH_WARNING` e `ALLOW` — produzem
respectivamente falha com crédito devolvido (100 → 100), falha com crédito devolvido,
conclusão com aviso na tela e cobrança, e conclusão silenciosa. Só as três primeiras gravam
`ModerationDecision`.

---

## 🔜 Fase 11 — Hardening

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
