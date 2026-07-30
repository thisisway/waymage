import { CreditTransactionType, type PrismaClient } from '@waymage/database';

/**
 * Carteira e ledger de créditos (blueprint §15).
 *
 * Duas regras governam tudo aqui:
 *
 * 1. **Append-only.** Nenhum saldo muda sem uma `CreditTransaction` correspondente, na mesma
 *    transação de banco. O extrato é a verdade; `wallet.balance` é cache dela. Sem isso, um
 *    saldo divergente é impossível de auditar — não há como saber o que aconteceu.
 * 2. **Idempotência.** Toda operação exige uma chave. A mesma chave nunca executa duas vezes,
 *    garantido por índice único no banco, não por checagem prévia — a checagem tem janela de
 *    corrida; o índice não.
 *
 * Mora num package porque a API reserva e o worker captura ou devolve. São processos
 * diferentes fazendo movimentos da mesma conta, e duas implementações da mesma regra
 * financeira divergem na primeira alteração.
 */

export interface WalletBalance {
  /** Disponível para gastar. Já desconta o que está reservado. */
  balance: number;
  /** Preso em gerações em voo. Volta ao saldo se a geração falhar. */
  reserved: number;
}

export class InsufficientCreditsError extends Error {
  readonly code = 'INSUFFICIENT_CREDITS';

  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Créditos insuficientes: são necessários ${required} e há ${available} disponíveis.`);
    this.name = 'InsufficientCreditsError';
  }
}

export async function getWallet(prisma: PrismaClient, workspaceId: string): Promise<WalletBalance> {
  const wallet = await prisma.creditWallet.findUnique({
    where: { workspaceId },
    select: { balance: true, reserved: true },
  });
  return wallet ?? { balance: 0, reserved: 0 };
}

/**
 * Credita a carteira. Usado em compra, bônus e ajuste administrativo.
 *
 * `amount` positivo sempre — devolver crédito é `release`, não um grant negativo.
 */
export async function grantCredits(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    amount: number;
    type: Extract<CreditTransactionType, 'PURCHASE' | 'BONUS' | 'REFUND' | 'ADMIN_ADJUSTMENT'>;
    idempotencyKey: string;
    note?: string;
  },
): Promise<WalletBalance> {
  assertPositive(input.amount);

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.creditWallet.upsert({
      where: { workspaceId: input.workspaceId },
      create: { workspaceId: input.workspaceId, balance: 0, reserved: 0 },
      update: {},
      select: { id: true, balance: true, reserved: true },
    });

    const existing = await findExisting(tx, input.workspaceId, input.idempotencyKey);
    if (existing) return { balance: wallet.balance, reserved: wallet.reserved };

    const updated = await tx.creditWallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: input.amount } },
      select: { balance: true, reserved: true },
    });

    await tx.creditTransaction.create({
      data: {
        workspaceId: input.workspaceId,
        walletId: wallet.id,
        type: input.type,
        amount: input.amount,
        balanceAfter: updated.balance,
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? null,
      },
    });

    return updated;
  });
}

/**
 * Reserva créditos antes de submeter ao provedor.
 *
 * O `UPDATE` condicional é o que impede duas gerações simultâneas de passarem ambas pela
 * verificação de saldo: ler, comparar em memória e depois escrever deixa uma janela entre a
 * leitura e a escrita. Aqui a condição `balance >= amount` faz parte da própria escrita, e o
 * Postgres a avalia atomicamente — mesmo padrão do autosave (docs/DECISIONS.md D-025).
 */
export async function reserveCredits(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    amount: number;
    /** Opcional: compra e bônus não pertencem a job nenhum. */
    generationJobId?: string;
    idempotencyKey: string;
  },
): Promise<WalletBalance> {
  assertPositive(input.amount);

  return prisma.$transaction(
    async (tx) => {
      // `findUnique` e não `upsert`: a carteira nasce junto do workspace, e o upsert tomaria
      // um lock de escrita na linha antes mesmo de sabermos se há saldo — o que serializa
      // toda reserva concorrente cedo demais e faz as últimas estourarem o tempo limite.
      const wallet = await tx.creditWallet.findUniqueOrThrow({
        where: { workspaceId: input.workspaceId },
        select: { id: true, balance: true, reserved: true },
      });

      const existing = await findExisting(tx, input.workspaceId, input.idempotencyKey);
      if (existing) return { balance: wallet.balance, reserved: wallet.reserved };

      const { count } = await tx.creditWallet.updateMany({
        where: { id: wallet.id, balance: { gte: input.amount } },
        data: {
          balance: { decrement: input.amount },
          reserved: { increment: input.amount },
        },
      });

      if (count === 0) {
        // O saldo lido acima pode estar velho se outra reserva venceu a corrida; relê para
        // que a mensagem de erro diga o valor real.
        const current = await tx.creditWallet.findUniqueOrThrow({
          where: { id: wallet.id },
          select: { balance: true },
        });
        throw new InsufficientCreditsError(input.amount, current.balance);
      }

      const updated = await tx.creditWallet.findUniqueOrThrow({
        where: { id: wallet.id },
        select: { balance: true, reserved: true },
      });

      await tx.creditTransaction.create({
        data: {
          workspaceId: input.workspaceId,
          walletId: wallet.id,
          type: CreditTransactionType.RESERVATION,
          // Negativo: sai do saldo disponível.
          amount: -input.amount,
          balanceAfter: updated.balance,
          generationJobId: input.generationJobId ?? null,
          idempotencyKey: input.idempotencyKey,
        },
      });

      return updated;
    },
    // Reservas concorrentes na mesma carteira serializam no lock da linha. O padrão de 5 s do
    // Prisma derruba as últimas da fila quando várias chegam juntas.
    { timeout: 20_000, maxWait: 20_000 },
  );
}

/**
 * Confirma o gasto: o que estava reservado sai de vez.
 *
 * O saldo disponível não muda — ele já havia sido debitado na reserva. O que some é a
 * reserva.
 */
export async function captureCredits(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    amount: number;
    generationJobId?: string;
    idempotencyKey: string;
    note?: string;
  },
): Promise<WalletBalance> {
  return settleReservation(prisma, { ...input, kind: 'capture' });
}

/**
 * Devolve a reserva ao saldo.
 *
 * Falha de provedor, timeout e cancelamento caem aqui: o usuário não recebeu imagem nenhuma,
 * então não pode pagar. Rejeição por política de conteúdo é a exceção — ali o pedido foi do
 * usuário e o custo foi incorrido, então é `capture`.
 */
export async function releaseCredits(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    amount: number;
    generationJobId?: string;
    idempotencyKey: string;
    note?: string;
  },
): Promise<WalletBalance> {
  return settleReservation(prisma, { ...input, kind: 'release' });
}

async function settleReservation(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    amount: number;
    generationJobId?: string;
    idempotencyKey: string;
    note?: string;
    kind: 'capture' | 'release';
  },
): Promise<WalletBalance> {
  assertPositive(input.amount);

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.creditWallet.findUniqueOrThrow({
      where: { workspaceId: input.workspaceId },
      select: { id: true, balance: true, reserved: true },
    });

    const existing = await findExisting(tx, input.workspaceId, input.idempotencyKey);
    if (existing) return { balance: wallet.balance, reserved: wallet.reserved };

    // Nunca liberar mais do que está reservado: um retry mal contabilizado inflaria o saldo
    // a partir do nada. A constraint do banco recusaria, mas travar aqui dá erro legível.
    const amount = Math.min(input.amount, wallet.reserved);

    const updated = await tx.creditWallet.update({
      where: { id: wallet.id },
      data: {
        reserved: { decrement: amount },
        ...(input.kind === 'release' ? { balance: { increment: amount } } : {}),
      },
      select: { balance: true, reserved: true },
    });

    await tx.creditTransaction.create({
      data: {
        workspaceId: input.workspaceId,
        walletId: wallet.id,
        type:
          input.kind === 'capture' ? CreditTransactionType.CAPTURE : CreditTransactionType.RELEASE,
        // Capture não mexe no disponível (já saiu na reserva); release devolve.
        amount: input.kind === 'release' ? amount : 0,
        balanceAfter: updated.balance,
        generationJobId: input.generationJobId ?? null,
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? null,
      },
    });

    return updated;
  });
}

/** Registra custo interno e custo do provedor, para medir margem (blueprint §15.1, item 5). */
export async function recordUsage(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    generationJobId: string;
    provider: string;
    imagesProduced: number;
    creditsCharged: number;
    externalCostCents: number;
  },
): Promise<void> {
  await prisma.usageLedger.create({ data: input });
}

/**
 * Soma de todas as transações. Deve bater com `wallet.balance`.
 *
 * É a verificação que prova a integridade do ledger: se divergir, algum saldo foi alterado
 * sem transação — exatamente o que a regra append-only proíbe.
 */
export async function reconcile(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<{ ledgerSum: number; walletBalance: number; consistent: boolean }> {
  const [aggregate, wallet] = await Promise.all([
    prisma.creditTransaction.aggregate({
      where: { workspaceId },
      _sum: { amount: true },
    }),
    getWallet(prisma, workspaceId),
  ]);

  const ledgerSum = aggregate._sum.amount ?? 0;
  return { ledgerSum, walletBalance: wallet.balance, consistent: ledgerSum === wallet.balance };
}

/** Transações compartilham a mesma chave só quando são a mesma operação repetida. */
async function findExisting(
  tx: Pick<PrismaClient, 'creditTransaction'>,
  workspaceId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const found = await tx.creditTransaction.findUnique({
    where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
    select: { id: true },
  });
  return found !== null;
}

function assertPositive(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    // Crédito é inteiro por decisão: ponto flutuante em dinheiro acumula erro de
    // arredondamento que ninguém consegue explicar depois.
    throw new Error(`Valor de crédito inválido: ${amount}. Deve ser inteiro positivo.`);
  }
}

/** Créditos dados a um workspace novo, para o produto ser utilizável sem compra. */
export const WELCOME_CREDITS = 100;
