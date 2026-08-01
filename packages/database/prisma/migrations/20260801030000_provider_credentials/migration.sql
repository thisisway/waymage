-- Chave de API do proprio usuario (BYOK).
--
-- O valor vai cifrado em `secretSealed`; `secretHint` guarda so os quatro ultimos caracteres,
-- para a tela identificar a chave sem exibi-la.
CREATE TABLE "provider_credentials" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "secretSealed" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_credentials_workspaceId_provider_idx"
    ON "provider_credentials"("workspaceId", "provider");

-- Uma chave ATIVA por provedor em cada workspace. Parcial de proposito: credenciais
-- revogadas ficam no historico e nao podem ocupar o lugar da vigente.
CREATE UNIQUE INDEX "provider_credentials_active_key"
    ON "provider_credentials"("workspaceId", "provider")
    WHERE "revokedAt" IS NULL;

ALTER TABLE "provider_credentials"
    ADD CONSTRAINT "provider_credentials_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_credentials"
    ADD CONSTRAINT "provider_credentials_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
