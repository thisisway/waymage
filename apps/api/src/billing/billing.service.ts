import { HttpStatus, Injectable } from '@nestjs/common';
import {
  InsufficientCreditsError,
  getWallet,
  grantCredits,
  reconcile,
  releaseCredits,
  reserveCredits,
  type WalletBalance,
} from '@waymage/billing';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import type { RequestPrincipal } from '../auth/request-user';

export interface TransactionView {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  generationJobId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface UsageView {
  provider: string;
  imagesProduced: number;
  creditsCharged: number;
  externalCostCents: number;
  createdAt: Date;
}

/**
 * Fachada da carteira para a API.
 *
 * A aritmética vive em `@waymage/billing` porque o worker também a executa. Aqui ficam só a
 * tradução de erro para HTTP e as consultas de leitura.
 */
@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  wallet(principal: RequestPrincipal): Promise<WalletBalance> {
    return getWallet(this.prisma, principal.workspaceId);
  }

  async transactions(principal: RequestPrincipal): Promise<TransactionView[]> {
    return this.prisma.creditTransaction.findMany({
      where: { workspaceId: principal.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        generationJobId: true,
        note: true,
        createdAt: true,
      },
    });
  }

  async usage(principal: RequestPrincipal): Promise<UsageView[]> {
    return this.prisma.usageLedger.findMany({
      where: { workspaceId: principal.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        provider: true,
        imagesProduced: true,
        creditsCharged: true,
        externalCostCents: true,
        createdAt: true,
      },
    });
  }

  /** Reserva para uma geração. Traduz saldo insuficiente em 402, não em 500. */
  async reserve(input: {
    workspaceId: string;
    amount: number;
    generationJobId: string;
  }): Promise<WalletBalance> {
    try {
      return await reserveCredits(this.prisma, {
        ...input,
        // Chave derivada do job: um retry da criação nunca debita duas vezes.
        idempotencyKey: `reserve:${input.generationJobId}`,
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        throw new AppError(
          'GENERATION_INSUFFICIENT_CREDITS',
          'Créditos insuficientes.',
          HttpStatus.PAYMENT_REQUIRED,
          { required: error.required, available: error.available },
        );
      }
      throw error;
    }
  }

  /** Cancelamento devolve a reserva: o usuário não recebeu imagem nenhuma. */
  release(input: { workspaceId: string; amount: number; generationJobId: string; note?: string }) {
    return releaseCredits(this.prisma, {
      ...input,
      idempotencyKey: `release:${input.generationJobId}`,
    });
  }

  /** Créditos de boas-vindas, para o produto ser utilizável sem compra. */
  welcome(workspaceId: string, amount: number) {
    return grantCredits(this.prisma, {
      workspaceId,
      amount,
      type: 'BONUS',
      idempotencyKey: `welcome:${workspaceId}`,
      note: 'Créditos de boas-vindas',
    });
  }

  /** Conferência de integridade — soma do extrato contra o saldo. */
  reconcile(principal: RequestPrincipal) {
    return reconcile(this.prisma, principal.workspaceId);
  }
}
