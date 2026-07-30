-- Saldo negativo impossível por CONSTRAINT, não por checagem na aplicação.
--
-- O blueprint §15.1 exige "impedir saldo negativo". Verificar em código protege contra o
-- caminho conhecido; a constraint protege contra o desconhecido — um script de manutenção,
-- uma correção manual em produção, um bug futuro num caminho novo. O banco recusa e a
-- transação inteira volta atrás.
ALTER TABLE "credit_wallets"
  ADD CONSTRAINT "credit_wallets_balance_non_negative" CHECK ("balance" >= 0),
  ADD CONSTRAINT "credit_wallets_reserved_non_negative" CHECK ("reserved" >= 0);

-- O saldo registrado em cada transação também não pode ser negativo: se ficasse, o extrato
-- contaria uma história que a carteira não confirma.
ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_balance_after_non_negative" CHECK ("balanceAfter" >= 0);

-- Consulta do extrato é sempre por workspace e ordenada por data.
CREATE INDEX "credit_transactions_workspaceId_createdAt_idx"
  ON "credit_transactions" ("workspaceId", "createdAt" DESC);
