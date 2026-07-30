-- Linhagem de resultados: variação e refinamento registram de qual resultado nasceram, o que
-- permite reconstruir "rascunho A → variação A2 → refino final".
ALTER TABLE "generation_jobs" ADD COLUMN "sourceResultId" UUID;

ALTER TABLE "generation_jobs"
  ADD CONSTRAINT "generation_jobs_sourceResultId_fkey"
  FOREIGN KEY ("sourceResultId") REFERENCES "generation_results"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Exportação produz um asset por resultado, não um só: `assetId` singular não comportava
-- exportar a grade inteira.
ALTER TABLE "export_jobs" DROP CONSTRAINT IF EXISTS "export_jobs_assetId_fkey";
ALTER TABLE "export_jobs" DROP COLUMN IF EXISTS "assetId";
ALTER TABLE "export_jobs"
  ADD COLUMN "assetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "errorMessage" TEXT;
