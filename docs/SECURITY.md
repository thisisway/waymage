# Segurança

Modelo de ameaça, controles e o que já está implementado. Cada controle indica a fase em que
entra — o que está marcado ⬜ **ainda não protege nada**.

---

## 1. Ativos e ameaças

| Ativo                                                               | Ameaça principal                                    | Impacto                           |
| ------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------- |
| Imagens e referências de usuários (incluem rostos de pessoas reais) | Acesso cross-tenant, URL vazando, retenção indevida | Crítico — dado biométrico/pessoal |
| Créditos / dinheiro                                                 | Duplo débito, saldo negativo, geração sem cobrança  | Alto                              |
| Chaves de API de provedores                                         | Vazamento em log, repositório ou resposta de erro   | Alto — custo direto               |
| Sessões de usuário                                                  | XSS, CSRF, roubo de refresh token                   | Alto                              |
| Capacidade de geração                                               | Abuso, geração de conteúdo ilícito, DoS por custo   | Alto — legal e financeiro         |

---

## 2. Segredos

**Regra absoluta: nenhum segredo no repositório.** Nem em código, nem em teste, nem em
fixture, nem em comentário, nem em documentação.

- Toda configuração sensível vem de variável de ambiente, validada por Zod no boot.
- `.env` está no `.gitignore`. Apenas `.env.example` é versionado, com valores vazios ou
  placeholders obviamente falsos (`minioadmin`, `dev-only-change-me`).
- Segredos de provedor nunca são gravados no banco. Se algum dia forem (chave por workspace),
  serão cifrados em repouso com chave gerenciada fora do banco.
- Os valores em `.env.example` servem **exclusivamente** para o ambiente Docker local. Não
  são utilizáveis contra nada externo e devem ser trocados em qualquer ambiente compartilhado.

✅ Fase 1: validação de env, `.gitignore`, `.env.example` sem chaves reais.
⬜ Fase 11: rotação de chaves e varredura de segredos no CI.

---

## 3. Autenticação e sessão

⬜ **Fase 2.**

- Senha com argon2id (`memoryCost` ≥ 19 MiB, `timeCost` ≥ 2), nunca bcrypt novo, nunca SHA.
- Access token JWT curto (15 min) + refresh rotacionado (7 dias) com detecção de reuso —
  reuso de refresh revoga a família inteira de tokens.
- Ambos em cookie `httpOnly` + `Secure` + `SameSite=Lax`. O front nunca lê o token. Ver
  [D-009](DECISIONS.md#d-009).
- CSRF: double-submit token em toda mutação, já que a sessão é por cookie.
- Rate limit em `/auth/login` e `/auth/register` por IP e por identificador.
- Resposta de login idêntica para usuário inexistente e senha errada (sem enumeração).

---

## 4. Autorização e isolamento multi-tenant

⬜ **Fase 2** — é o controle mais crítico do sistema.

- Toda entidade multi-tenant carrega `workspaceId`. Já está no schema Prisma (Fase 1).
- `workspaceId` é resolvido **do contexto da sessão**, nunca aceito do body ou da query.
  Aceitar do cliente é IDOR por construção.
- Guard global exige workspace resolvido; endpoints que não exigem são opt-out explícito.
- RBAC por papel de membro: `OWNER` > `ADMIN` > `MEMBER` > `VIEWER`.
- Recurso de outro workspace responde **404**, não 403 — 403 confirma existência.
- Cada endpoint ganha um teste de integração que tenta acessá-lo com sessão de outro
  workspace. Sem esse teste, o endpoint não é considerado pronto.

---

## 5. Uploads e armazenamento

⬜ **Fase 4** (bucket privado já configurado na Fase 1).

- Bucket **privado**. Sem leitura anônima, sem URL pública, nunca.
- Fluxo: `POST /assets/upload-url` → PUT direto no storage → `POST /assets/complete`.
- URL assinada com expiração curta (upload 5 min, leitura 15 min), escopo de método e chave.
- Validação no `complete`: tipo real por **magic bytes** (não confiar em `Content-Type` nem em
  extensão), tamanho máximo, hash do conteúdo.
- Formatos aceitos: JPEG, PNG, WebP. Nada de SVG (vetor de XSS) nem de arquivos com payload
  embutido.
- Remoção de metadados EXIF na geração da miniatura — EXIF carrega GPS e identificação de
  dispositivo.
- Chaves de objeto incluem `workspaceId` no caminho, o que torna vazamento cross-tenant
  visível em auditoria.
- Varredura de malware e política de retenção: Fase 10.

---

## 6. Entradas e saídas

- Toda entrada HTTP é validada por Zod na borda (D-010). Nada não validado chega a service.
- `SceneSpec` é validado pelo mesmo schema no front e na API.
- Queries só via Prisma; `$queryRaw` exige parâmetros — concatenação de SQL é proibida.
- Saída HTML: React escapa por padrão. `dangerouslySetInnerHTML` é proibido sem revisão.
- ⬜ Fase 11: CSP restritiva, `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy`.

---

## 7. Dinheiro e idempotência

⬜ **Fase 6.**

- Ledger **append-only**. Nunca atualizar saldo sem gravar a transação correspondente.
- Toda operação financeira dentro de uma transação Postgres, com lock na wallet.
- Saldo negativo impedido por constraint, não apenas por checagem na aplicação.
- `Idempotency-Key` obrigatória em criação de job e em operação de crédito; chave repetida
  devolve o resultado original em vez de executar de novo.
- Reserva **antes** de submeter ao provedor; captura só após sucesso; release automático em
  falha não imputável ao usuário.
- ⬜ Webhooks (se houver): verificação de assinatura + janela de timestamp + registro de ID
  processado, contra replay.

---

## 8. Abuso e conteúdo

⬜ **Fase 10.**

- Moderação em seis pontos: texto enviado, imagens de referência, máscaras, prompt compilado,
  imagem final e exportação.
- Decisões: `ALLOW`, `ALLOW_WITH_WARNING`, `REVIEW_REQUIRED`, `BLOCK`.
- Consentimento quando há pessoa real: confirmação de autorização, registro, revogação com
  exclusão, limite em transformações sensíveis, trilha de auditoria.
- Rate limiting de geração por workspace e por usuário — abuso aqui custa dinheiro real.

---

## 9. Logs e observabilidade

- Logs estruturados (Pino), com `requestId`, `workspaceId`, `jobId`.
- **Nunca logar:** senha, token, cookie, header `Authorization`, chave de provedor, URL
  assinada completa, conteúdo de imagem, e-mail em texto claro fora do contexto necessário.
- Erros retornados ao cliente seguem o formato do blueprint e **não** expõem stack trace,
  SQL, nome de tabela ou mensagem interna:

  ```json
  {
    "code": "GENERATION_INSUFFICIENT_CREDITS",
    "message": "Créditos insuficientes.",
    "details": {},
    "requestId": "..."
  }
  ```

  ✅ Implementado na Fase 1 (`apps/api/src/common/http-exception.filter.ts`): exceções não
  tratadas viram `INTERNAL_ERROR` genérico, com o detalhe apenas no log do servidor.

- ⬜ Auditoria de toda ação administrativa e de escrita relevante (`AuditLog`, Fase 2).

---

## 10. Dependências e infraestrutura

- Lockfile commitado; instalação com `--frozen-lockfile` no CI.
- ⬜ Fase 11: `pnpm audit` e scan de imagem de container no CI.
- Princípio de menor privilégio: credencial de storage limitada ao bucket; usuário do banco
  sem `SUPERUSER`; container sem root quando possível.
- As credenciais do `docker-compose.yml` são de desenvolvimento local e não devem ser
  reaproveitadas em nenhum ambiente exposto.

---

## 11. Estado atual — resumo honesto

| Controle                                   | Estado             |
| ------------------------------------------ | ------------------ |
| Segredos fora do repositório, env validado | ✅ Fase 1          |
| Erros sem vazamento de detalhe interno     | ✅ Fase 1          |
| Bucket privado, credencial escopada        | ✅ Fase 1 (config) |
| `workspaceId` no modelo de dados           | ✅ Fase 1 (schema) |
| Autenticação, RBAC, isolamento em runtime  | ⬜ Fase 2          |
| Validação de upload, URL assinada          | ⬜ Fase 4          |
| Ledger transacional, idempotência          | ⬜ Fase 6          |
| Moderação, consentimento, retenção         | ⬜ Fase 10         |
| CSP, rate limiting, scan no CI             | ⬜ Fase 11         |

**Não há autenticação em runtime hoje.** A API da Fase 1 expõe apenas `/health` e não deve ser
exposta fora de `localhost`.
