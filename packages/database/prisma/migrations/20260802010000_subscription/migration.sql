-- Assinatura do workspace.
--
-- O acesso ao editor passa a ser cobrado por mensalidade; a geracao continua sendo paga pelo
-- usuario direto ao fornecedor, com a chave dele (BYOK).
--
-- Workspaces existentes entram como ACTIVE, e nao TRIALING: eles ja estavam usando o produto,
-- e dar-lhes um prazo de avaliacao retroativo seria cortar o acesso de quem ja estava dentro.

CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

ALTER TABLE "workspaces"
  ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  ADD COLUMN "trialEndsAt" TIMESTAMPTZ(6),
  ADD COLUMN "currentPeriodEnd" TIMESTAMPTZ(6);

UPDATE "workspaces" SET "subscriptionStatus" = 'ACTIVE';
