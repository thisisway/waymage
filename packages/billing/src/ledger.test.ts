import { PrismaClient } from '@waymage/database';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  captureCredits,
  getWallet,
  grantCredits,
  InsufficientCreditsError,
  reconcile,
  releaseCredits,
  reserveCredits,
} from './ledger';

/**
 * Ledger de créditos, contra o Postgres de verdade.
 *
 * As movimentações aqui não referenciam um `GenerationJob`: o vínculo é opcional (uma compra
 * não pertence a job nenhum) e montar a fixture completa — usuário, projeto, cena, versão —
 * só para exercitar aritmética de saldo obscureceria o que está sendo testado. O vínculo real
 * é coberto pelos testes de integração da API.
 *
 * Aqui mock não serve para nada: o que está sob teste é justamente o comportamento
 * transacional do banco — o `UPDATE` condicional que serializa reservas simultâneas, o
 * índice único que garante idempotência e a constraint que recusa saldo negativo. Um mock
 * confirmaria apenas que o código chama o que eu escrevi que ele chama.
 */

const prisma = new PrismaClient();

/** Cria um workspace descartável; o teste não pode depender de estado de outro. */
async function newWorkspace(): Promise<string> {
  const id = randomUUID();
  await prisma.workspace.create({
    data: { id, name: `Teste ${id.slice(0, 8)}`, slug: `teste-${id.slice(0, 8)}` },
  });
  return id;
}

beforeAll(async () => {
  await prisma.$connect();
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('crédito e débito', () => {
  it('credita e reflete no saldo', async () => {
    const workspaceId = await newWorkspace();

    const wallet = await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `welcome:${workspaceId}`,
    });

    expect(wallet).toEqual({ balance: 100, reserved: 0 });
  });

  it('reserva move do disponível para o reservado, sem sumir com nada', async () => {
    const workspaceId = await newWorkspace();
    await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });

    const wallet = await reserveCredits(prisma, {
      workspaceId,
      amount: 30,
      idempotencyKey: `r:${workspaceId}`,
    });

    expect(wallet).toEqual({ balance: 70, reserved: 30 });
  });

  it('captura consome a reserva e não devolve nada ao saldo', async () => {
    const workspaceId = await newWorkspace();
    const jobId = randomUUID();
    await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });
    await reserveCredits(prisma, { workspaceId, amount: 30, idempotencyKey: `r:${jobId}` });

    const wallet = await captureCredits(prisma, {
      workspaceId,
      amount: 30,
      idempotencyKey: `c:${jobId}`,
    });

    // O disponível já havia sido debitado na reserva; o que some é a reserva.
    expect(wallet).toEqual({ balance: 70, reserved: 0 });
  });

  it('devolução recompõe o saldo por inteiro', async () => {
    const workspaceId = await newWorkspace();
    const jobId = randomUUID();
    await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });
    await reserveCredits(prisma, { workspaceId, amount: 30, idempotencyKey: `r:${jobId}` });

    const wallet = await releaseCredits(prisma, {
      workspaceId,
      amount: 30,
      idempotencyKey: `rel:${jobId}`,
    });

    // Falha do provedor não pode custar nada ao usuário.
    expect(wallet).toEqual({ balance: 100, reserved: 0 });
  });
});

describe('saldo insuficiente', () => {
  it('recusa reserva maior que o disponível', async () => {
    const workspaceId = await newWorkspace();
    await grantCredits(prisma, {
      workspaceId,
      amount: 10,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });

    await expect(
      reserveCredits(prisma, {
        workspaceId,
        amount: 50,
        idempotencyKey: `r:${workspaceId}`,
      }),
    ).rejects.toThrow(InsufficientCreditsError);

    // E nada foi movido.
    expect(await getWallet(prisma, workspaceId)).toEqual({ balance: 10, reserved: 0 });
  });

  it('o reservado não conta como disponível', async () => {
    const workspaceId = await newWorkspace();
    await grantCredits(prisma, {
      workspaceId,
      amount: 50,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });
    await reserveCredits(prisma, {
      workspaceId,
      amount: 40,
      idempotencyKey: `r1:${workspaceId}`,
    });

    // Sobram 10 disponíveis: os 40 estão presos numa geração em voo.
    await expect(
      reserveCredits(prisma, {
        workspaceId,
        amount: 20,
        idempotencyKey: `r2:${workspaceId}`,
      }),
    ).rejects.toThrow(InsufficientCreditsError);
  });

  it('a constraint do banco recusa saldo negativo mesmo por escrita direta', async () => {
    const workspaceId = await newWorkspace();
    await grantCredits(prisma, {
      workspaceId,
      amount: 10,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });

    // Simula um script de manutenção ou correção manual passando por cima da aplicação.
    await expect(
      prisma.creditWallet.update({ where: { workspaceId }, data: { balance: -1 } }),
    ).rejects.toThrow();

    expect((await getWallet(prisma, workspaceId)).balance).toBe(10);
  });
});

describe('concorrência', () => {
  it('reservas simultâneas não estouram o saldo', async () => {
    const workspaceId = await newWorkspace();
    await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });

    // Dez pedidos de 30 ao mesmo tempo, com 100 disponíveis: no máximo três podem passar.
    const attempts = Array.from({ length: 10 }, () =>
      reserveCredits(prisma, {
        workspaceId,
        amount: 30,
        idempotencyKey: randomUUID(),
      }).then(
        () => 'ok' as const,
        () => 'recusado' as const,
      ),
    );

    const outcomes = await Promise.all(attempts);
    const accepted = outcomes.filter((outcome) => outcome === 'ok').length;

    expect(accepted).toBe(3);

    const wallet = await getWallet(prisma, workspaceId);
    expect(wallet.balance).toBe(10);
    expect(wallet.reserved).toBe(90);
    // O total nunca pode crescer nem encolher por conta de corrida.
    expect(wallet.balance + wallet.reserved).toBe(100);
  }, 30_000);
});

describe('idempotência', () => {
  it('a mesma chave de reserva não debita duas vezes', async () => {
    const workspaceId = await newWorkspace();
    const jobId = randomUUID();
    await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });

    const input = {
      workspaceId,
      amount: 30,
      idempotencyKey: `reserve:${jobId}`,
    };
    await reserveCredits(prisma, input);
    await reserveCredits(prisma, input);
    await reserveCredits(prisma, input);

    // Um retry de rede não pode virar três cobranças.
    expect(await getWallet(prisma, workspaceId)).toEqual({ balance: 70, reserved: 30 });
  });

  it('a mesma chave de captura não consome a reserva duas vezes', async () => {
    const workspaceId = await newWorkspace();
    const jobId = randomUUID();
    await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });
    await reserveCredits(prisma, { workspaceId, amount: 30, idempotencyKey: `r:${jobId}` });

    const input = { workspaceId, amount: 30, idempotencyKey: `c:${jobId}` };
    await captureCredits(prisma, input);
    await captureCredits(prisma, input);

    expect(await getWallet(prisma, workspaceId)).toEqual({ balance: 70, reserved: 0 });
  });

  it('devolver mais do que está reservado não cria crédito do nada', async () => {
    const workspaceId = await newWorkspace();
    const jobId = randomUUID();
    await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });
    await reserveCredits(prisma, { workspaceId, amount: 10, idempotencyKey: `r:${jobId}` });

    // Valor errado por bug de contabilidade: o teto é o que está de fato reservado.
    const wallet = await releaseCredits(prisma, {
      workspaceId,
      amount: 999,
      idempotencyKey: `rel:${jobId}`,
    });

    expect(wallet).toEqual({ balance: 100, reserved: 0 });
  });
});

describe('integridade do ledger', () => {
  it('a soma das transações bate com o saldo depois de um ciclo completo', async () => {
    const workspaceId = await newWorkspace();
    const failed = randomUUID();
    const succeeded = randomUUID();

    await grantCredits(prisma, {
      workspaceId,
      amount: 100,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });

    // Uma geração que falha e devolve.
    await reserveCredits(prisma, { workspaceId, amount: 20, idempotencyKey: `r:${failed}` });
    await releaseCredits(prisma, { workspaceId, amount: 20, idempotencyKey: `rel:${failed}` });

    // Uma que dá certo e cobra.
    await reserveCredits(prisma, { workspaceId, amount: 35, idempotencyKey: `r:${succeeded}` });
    await captureCredits(prisma, { workspaceId, amount: 35, idempotencyKey: `c:${succeeded}` });

    const result = await reconcile(prisma, workspaceId);

    // Se divergir, algum saldo mudou sem transação — o que a regra append-only proíbe.
    expect(result.consistent).toBe(true);
    expect(result.walletBalance).toBe(65);
    expect(result.ledgerSum).toBe(65);
  }, 30_000);

  it('toda movimentação deixa uma transação para trás', async () => {
    const workspaceId = await newWorkspace();
    const jobId = randomUUID();

    await grantCredits(prisma, {
      workspaceId,
      amount: 50,
      type: 'BONUS',
      idempotencyKey: `w:${workspaceId}`,
    });
    await reserveCredits(prisma, { workspaceId, amount: 10, idempotencyKey: `r:${jobId}` });
    await captureCredits(prisma, { workspaceId, amount: 10, idempotencyKey: `c:${jobId}` });

    const types = (
      await prisma.creditTransaction.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: { type: true },
      })
    ).map((t) => t.type);

    expect(types).toEqual(['BONUS', 'RESERVATION', 'CAPTURE']);
  });

  it('recusa valor não inteiro ou não positivo', async () => {
    const workspaceId = await newWorkspace();

    for (const amount of [0, -5, 1.5]) {
      await expect(
        grantCredits(prisma, { workspaceId, amount, type: 'BONUS', idempotencyKey: randomUUID() }),
      ).rejects.toThrow(/inválido/);
    }
  });
});
