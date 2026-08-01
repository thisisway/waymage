-- Remove o sistema de creditos.
--
-- No modelo BYOK a chave do fornecedor e do proprio usuario: nos deixamos de pagar a geracao,
-- e com isso some a razao de existir da reserva -> captura -> devolucao. O acesso passa a ser
-- cobrado por mensalidade, e o consumo do fornecedor e cobrado dele, direto.
--
-- `usage_ledger` SOBREVIVE: saber quantas imagens cada workspace gerou serve a limite de
-- plano, suporte e deteccao de abuso. So a coluna de creditos sai.

ALTER TABLE "generation_jobs" DROP COLUMN IF EXISTS "estimatedCredits";
ALTER TABLE "generation_jobs" DROP COLUMN IF EXISTS "reservedCredits";
ALTER TABLE "generation_jobs" DROP COLUMN IF EXISTS "actualCredits";

ALTER TABLE "usage_ledger" DROP COLUMN IF EXISTS "creditsCharged";

DROP TABLE IF EXISTS "credit_transactions";
DROP TABLE IF EXISTS "credit_wallets";

DROP TYPE IF EXISTS "CreditTransactionType";
