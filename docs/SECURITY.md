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

✅ **Fase 2.**

- Senha com **scrypt** (N=2^17, r=8, p=1), da stdlib do Node — memory-hard e aceito pelo
  OWASP. Ver [D-020](DECISIONS.md#d-020) para por que não argon2id.
- Access token JWT curto (15 min) + refresh **opaco** rotacionado (7 dias), guardado só como
  hash SHA-256. Reuso de refresh revoga a família inteira de tokens.
- Ambos em cookie `httpOnly` + `Secure` (fora de dev) + `SameSite=Lax`. O front nunca lê o
  token. O refresh tem `path=/auth`, então nem é enviado no resto da API.
- CSRF: double-submit em toda mutação, exceto login e cadastro, que não se autorizam por
  cookie ([D-022](DECISIONS.md#d-022)).
- Rate limit em `/auth/*` por IP, com contador no Redis — 10 logins / 5 min, 5 cadastros / h.
- Resposta de login **idêntica** para usuário inexistente e senha errada, incluindo o tempo
  de resposta: um hash dummy é verificado quando o e-mail não existe, para que a latência não
  denuncie quem está cadastrado. Coberto por teste.

⬜ Pendente: verificação de e-mail e segundo fator.

---

## 4. Autorização e isolamento multi-tenant

✅ **Fase 2** — é o controle mais crítico do sistema.

- Toda entidade multi-tenant carrega `workspaceId`.
- `workspaceId` é resolvido **do contexto da sessão**, nunca aceito do body ou da query.
  Aceitar do cliente é IDOR por construção. Vive em `request.principal`, e é a única fonte
  que os services consultam.
- Guard global (`APP_GUARD`): rota nova nasce protegida; abrir exige `@Public()` explícito
  ([D-023](DECISIONS.md#d-023)).
- RBAC por papel: `OWNER` > `ADMIN` > `MEMBER` > `VIEWER`, com `@RequireRole()` por rota.
  Criar projeto exige MEMBER; apagar exige ADMIN.
- Toda query filtra por `workspaceId` **e** `deletedAt: null`. Escrita confirma
  pertencimento antes de alterar — `update` só por id permitiria editar recurso alheio
  conhecendo o UUID.
- Recurso de outro workspace responde **404**, não 403 — 403 confirma existência.
- `test/tenancy.integration.test.ts` roda contra Postgres real e cobre leitura, alteração e
  exclusão cross-tenant, mais listagem de projetos e de membros. Teste com mock não pegaria
  o risco real, que é um `where` esquecendo `workspaceId`.

⬜ Pendente: troca de workspace ativo (hoje o guard usa a associação mais antiga do usuário).

---

## 5. Uploads e armazenamento

✅ **Fase 4.**

- Bucket **privado**. Sem leitura anônima, sem URL pública, nunca. A única forma de o browser
  ver uma imagem é URL assinada de 15 minutos, renovada a cada listagem.
- Fluxo: `POST /assets/upload-url` → PUT direto no storage → `POST /assets/complete`. O
  arquivo nunca passa pela API.
- URL de upload assinada por 5 minutos, com método **e** `Content-Type` no escopo da
  assinatura.
- A chave no bucket é gerada a partir de ids nossos, **nunca** derivada do nome enviado —
  derivar permitiria path traversal (`../../outro-workspace/…`) e colisão entre usuários.
- Validação no `complete`: tipo real por **assinatura de bytes** ([D-028](DECISIONS.md#d-028)),
  tamanho real conferido no bucket (a URL assinada não limita quantos bytes cabem nela) e
  hash SHA-256. O que não passa é apagado do bucket e marcado `QUARANTINED`.
- Formatos aceitos: JPEG, PNG, WebP. **SVG está fora**: é XML, executa script, é vetor de XSS.
- EXIF removido na miniatura — carrega GPS e identificação do aparelho
  ([D-029](DECISIONS.md#d-029), com teste).
- O worker revalida a assinatura antes de processar: entre a confirmação e o processamento,
  quem tivesse a URL assinada ainda válida poderia ter trocado o objeto.
- Decodificação de imagem acontece **só no worker** — a superfície de ataque de um
  decodificador fica fora do processo que atende HTTP ([D-030](DECISIONS.md#d-030)).
- Chaves incluem `workspaceId` no caminho, o que torna vazamento cross-tenant visível.
- Excluir apaga os **bytes** do bucket; a linha sobrevive para auditoria.
- Os `assetId` dentro do `SceneSpec` são conferidos contra o workspace a cada gravação — sem
  isso, o IDOR entraria por dentro de um campo JSON, onde os guards não olham.

⬜ Pendente: varredura de malware e política de retenção automática (Fase 10).

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

✅ **Fase 6.**

- Ledger **append-only**. Nenhum saldo muda sem a transação correspondente, na mesma transação
  de banco ([D-038](DECISIONS.md#d-038)).
- Saldo negativo impedido por `CHECK` no Postgres, não apenas por checagem na aplicação
  ([D-036](DECISIONS.md#d-036)) — protege inclusive contra script de manutenção e correção
  manual. Coberto por teste.
- Reserva por **compare-and-swap**: a condição de saldo faz parte da escrita, então reservas
  simultâneas não podem ambas passar ([D-037](DECISIONS.md#d-037)).
- Chave idempotente derivada do job em toda operação (`reserve:`, `capture:`, `release:`),
  garantida por índice único — não por checagem prévia, que tem janela de corrida.
- Reserva **antes** de enfileirar; captura só após entrega; devolução automática em falha não
  imputável ao usuário ([D-039](DECISIONS.md#d-039)).
- `GET /billing/reconcile` expõe a conferência: soma do extrato contra o saldo.
- Créditos são inteiros — ponto flutuante em dinheiro acumula erro inexplicável.

⬜ Pendente: compra de créditos e, se houver webhook de pagamento, verificação de assinatura
com janela de timestamp e registro de ID processado contra replay.

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

| Controle                                     | Estado             |
| -------------------------------------------- | ------------------ |
| Segredos fora do repositório, env validado   | ✅ Fase 1          |
| Autenticação, RBAC, isolamento em runtime    | ✅ Fase 2          |
| CSRF, rate limit em `/auth/*`, auditoria     | ✅ Fase 2          |
| Container sem root, migrations no entrypoint | ✅ Fase 2          |
| Erros sem vazamento de detalhe interno       | ✅ Fase 1          |
| Bucket privado, credencial escopada          | ✅ Fase 1 (config) |
| `workspaceId` no modelo de dados             | ✅ Fase 1 (schema) |
| Validação de upload, URL assinada            | ⬜ Fase 4          |
| Ledger transacional, idempotência            | ⬜ Fase 6          |
| Moderação, consentimento, retenção           | ⬜ Fase 10         |
| CSP, headers de segurança, scan no CI        | ⬜ Fase 11         |

**O que ainda falta antes de expor publicamente:** verificação de e-mail, CSP e headers de
segurança, e backup do banco configurado. `/dev/*` já não existe fora de desenvolvimento, e
`NODE_ENV=production` é o que garante isso — conferir a variável no ambiente antes do
primeiro deploy.
