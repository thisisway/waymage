-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('REFERENCE', 'MASK', 'GENERATED', 'THUMBNAIL', 'EXPORT');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING_UPLOAD', 'PROCESSING', 'READY', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "ReferenceRole" AS ENUM ('IDENTITY', 'FACE', 'BODY', 'WARDROBE', 'PRODUCT', 'SCENE', 'STYLE', 'POSE', 'PALETTE', 'LOGO');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('DRAFT', 'QUEUED', 'VALIDATING', 'MODERATING_INPUT', 'COMPILING', 'ROUTING', 'SUBMITTING', 'PROCESSING', 'DOWNLOADING', 'MODERATING_OUTPUT', 'EVALUATING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'VARIATION', 'REFINE', 'MASKED_EDIT');

-- CreateEnum
CREATE TYPE "ProviderRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ModerationTarget" AS ENUM ('PROMPT_TEXT', 'REFERENCE_IMAGE', 'MASK', 'COMPILED_PROMPT', 'OUTPUT_IMAGE', 'EXPORT');

-- CreateEnum
CREATE TYPE "ModerationVerdict" AS ENUM ('ALLOW', 'ALLOW_WITH_WARNING', 'REVIEW_REQUIRED', 'BLOCK');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('PURCHASE', 'BONUS', 'RESERVATION', 'CAPTURE', 'RELEASE', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "planCode" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersionId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sceneId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sceneSpec" JSONB NOT NULL,
    "specVersion" TEXT NOT NULL,
    "parentVersionId" UUID,
    "changeSummary" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "kind" "AssetKind" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "originalName" TEXT,
    "analysis" JSONB,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_bindings" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sceneVersionId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "role" "ReferenceRole" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "preserve" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mask_assets" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "featherPx" INTEGER NOT NULL DEFAULT 0,
    "inverted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mask_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "sceneId" UUID NOT NULL,
    "sceneVersionId" UUID NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'DRAFT',
    "operationType" "OperationType" NOT NULL DEFAULT 'TEXT_TO_IMAGE',
    "requestedCount" INTEGER NOT NULL DEFAULT 4,
    "providerStrategy" TEXT NOT NULL DEFAULT 'auto',
    "selectedProvider" TEXT,
    "estimatedCredits" INTEGER NOT NULL DEFAULT 0,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "actualCredits" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_results" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "generationJobId" UUID NOT NULL,
    "providerRunId" UUID,
    "assetId" UUID NOT NULL,
    "thumbnailAssetId" UUID,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "seed" BIGINT,
    "safetyStatus" "ModerationVerdict" NOT NULL DEFAULT 'ALLOW',
    "evaluation" JSONB,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "generationJobId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerModel" TEXT,
    "providerJobId" TEXT,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "costExternal" INTEGER,
    "latencyMs" INTEGER,
    "status" "ProviderRunStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_compilations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "generationJobId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "referenceInstructions" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "normalizedSpec" JSONB NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_compilations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edit_operations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceResultId" UUID NOT NULL,
    "maskId" UUID,
    "resultAssetId" UUID,
    "instruction" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edit_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kits" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_wallets" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "generationJobId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_ledger" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "generationJobId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "imagesProduced" INTEGER NOT NULL DEFAULT 0,
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "externalCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_decisions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "target" "ModerationTarget" NOT NULL,
    "verdict" "ModerationVerdict" NOT NULL,
    "generationJobId" UUID,
    "assetId" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "moderator" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "declaredById" UUID NOT NULL,
    "subjectLabel" TEXT,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "format" TEXT NOT NULL,
    "resultIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assetId" UUID,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspace_members_userId_idx" ON "workspace_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "projects_workspaceId_deletedAt_idx" ON "projects"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_currentVersionId_key" ON "scenes"("currentVersionId");

-- CreateIndex
CREATE INDEX "scenes_workspaceId_projectId_deletedAt_idx" ON "scenes"("workspaceId", "projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "scene_versions_workspaceId_sceneId_createdAt_idx" ON "scene_versions"("workspaceId", "sceneId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "scene_versions_sceneId_versionNumber_key" ON "scene_versions"("sceneId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "assets_storageKey_key" ON "assets"("storageKey");

-- CreateIndex
CREATE INDEX "assets_workspaceId_kind_status_idx" ON "assets"("workspaceId", "kind", "status");

-- CreateIndex
CREATE INDEX "assets_projectId_deletedAt_idx" ON "assets"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "reference_bindings_workspaceId_idx" ON "reference_bindings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "reference_bindings_sceneVersionId_assetId_role_key" ON "reference_bindings"("sceneVersionId", "assetId", "role");

-- CreateIndex
CREATE INDEX "mask_assets_workspaceId_idx" ON "mask_assets"("workspaceId");

-- CreateIndex
CREATE INDEX "generation_jobs_workspaceId_status_createdAt_idx" ON "generation_jobs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "generation_jobs_sceneId_createdAt_idx" ON "generation_jobs"("sceneId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "generation_jobs_workspaceId_idempotencyKey_key" ON "generation_jobs"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "generation_results_workspaceId_generationJobId_idx" ON "generation_results"("workspaceId", "generationJobId");

-- CreateIndex
CREATE INDEX "generation_results_generationJobId_selected_idx" ON "generation_results"("generationJobId", "selected");

-- CreateIndex
CREATE INDEX "provider_runs_workspaceId_provider_createdAt_idx" ON "provider_runs"("workspaceId", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "provider_runs_generationJobId_idx" ON "provider_runs"("generationJobId");

-- CreateIndex
CREATE INDEX "prompt_compilations_workspaceId_generationJobId_idx" ON "prompt_compilations"("workspaceId", "generationJobId");

-- CreateIndex
CREATE INDEX "edit_operations_workspaceId_sourceResultId_idx" ON "edit_operations"("workspaceId", "sourceResultId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_kits_workspaceId_name_key" ON "brand_kits"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "credit_wallets_workspaceId_key" ON "credit_wallets"("workspaceId");

-- CreateIndex
CREATE INDEX "credit_transactions_walletId_createdAt_idx" ON "credit_transactions"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_workspaceId_idempotencyKey_key" ON "credit_transactions"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "usage_ledger_workspaceId_createdAt_idx" ON "usage_ledger"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_decisions_workspaceId_verdict_createdAt_idx" ON "moderation_decisions"("workspaceId", "verdict", "createdAt");

-- CreateIndex
CREATE INDEX "consent_records_workspaceId_assetId_idx" ON "consent_records"("workspaceId", "assetId");

-- CreateIndex
CREATE INDEX "export_jobs_workspaceId_status_createdAt_idx" ON "export_jobs"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_createdAt_idx" ON "audit_logs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "scene_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "scene_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_versions" ADD CONSTRAINT "scene_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_sceneVersionId_fkey" FOREIGN KEY ("sceneVersionId") REFERENCES "scene_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_bindings" ADD CONSTRAINT "reference_bindings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mask_assets" ADD CONSTRAINT "mask_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_sceneVersionId_fkey" FOREIGN KEY ("sceneVersionId") REFERENCES "scene_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_results" ADD CONSTRAINT "generation_results_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_results" ADD CONSTRAINT "generation_results_providerRunId_fkey" FOREIGN KEY ("providerRunId") REFERENCES "provider_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_results" ADD CONSTRAINT "generation_results_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_results" ADD CONSTRAINT "generation_results_thumbnailAssetId_fkey" FOREIGN KEY ("thumbnailAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_compilations" ADD CONSTRAINT "prompt_compilations_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edit_operations" ADD CONSTRAINT "edit_operations_sourceResultId_fkey" FOREIGN KEY ("sourceResultId") REFERENCES "generation_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edit_operations" ADD CONSTRAINT "edit_operations_maskId_fkey" FOREIGN KEY ("maskId") REFERENCES "mask_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edit_operations" ADD CONSTRAINT "edit_operations_resultAssetId_fkey" FOREIGN KEY ("resultAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "credit_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_declaredById_fkey" FOREIGN KEY ("declaredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
