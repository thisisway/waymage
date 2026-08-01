import type { PrismaClient } from '@waymage/database';

/**
 * Registro de consumo.
 *
 * Sobreviveu à remoção dos créditos porque não é cobrança: é saber quantas imagens cada
 * workspace produziu e quanto isso custou no fornecedor. Serve a limite de plano, suporte e
 * detecção de abuso — perguntas que continuam existindo quando quem paga a geração é o próprio
 * usuário.
 *
 * Mora aqui, e não num pacote: sem a aritmética de reserva e captura, sobrou uma inserção.
 */
export async function recordUsage(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    generationJobId: string;
    provider: string;
    imagesProduced: number;
    externalCostCents: number;
  },
): Promise<void> {
  await prisma.usageLedger.create({ data: input });
}
