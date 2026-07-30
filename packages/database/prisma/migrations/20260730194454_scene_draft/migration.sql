/*
  Warnings:

  - Added the required column `draftSpec` to the `scenes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `specVersion` to the `scenes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "draftSpec" JSONB NOT NULL,
ADD COLUMN     "specVersion" TEXT NOT NULL;
