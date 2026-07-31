-- Vincula a operacao de edicao ao job que a executa.
-- O worker recebe apenas o id do job pela fila; sem este vinculo nao ha como recuperar a
-- instrucao nem a mascara. Unico porque um job executa exatamente uma edicao.
ALTER TABLE "edit_operations" ADD COLUMN "generationJobId" UUID;

CREATE UNIQUE INDEX "edit_operations_generationJobId_key" ON "edit_operations"("generationJobId");

ALTER TABLE "edit_operations"
  ADD CONSTRAINT "edit_operations_generationJobId_fkey"
  FOREIGN KEY ("generationJobId") REFERENCES "generation_jobs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
