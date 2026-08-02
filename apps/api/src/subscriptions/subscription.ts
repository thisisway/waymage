import type { SubscriptionStatus } from '@waymage/database';

/**
 * Se o workspace pode usar o produto.
 *
 * O Waymage cobra o **acesso ao editor**; a geração é paga pelo usuário direto ao fornecedor,
 * com a chave dele (docs/DECISIONS.md D-070). São duas cobranças distintas, e confundi-las
 * levaria a bloquear quem está em dia com uma e não com a outra.
 *
 * Função pura, sem banco nem relógio do sistema: o `agora` entra por parâmetro. É o que
 * permite testar "o dia seguinte ao fim da avaliação" sem esperar um dia.
 */

export interface SubscriptionInput {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  /** Pode gerar? É a única pergunta que o resto do sistema faz. */
  active: boolean;
  /** Dias restantes de avaliação. `null` fora dela. */
  trialDaysLeft: number | null;
  /** Por que está bloqueado. Vai para a tela; vazio quando ativo. */
  reason: string | null;
}

/** Duração da avaliação de quem se cadastra. */
export const TRIAL_DAYS = 14;

export function subscriptionState(
  workspace: SubscriptionInput,
  now: Date = new Date(),
): SubscriptionState {
  switch (workspace.subscriptionStatus) {
    case 'ACTIVE':
      return active('ACTIVE');

    case 'TRIALING': {
      // Avaliação sem prazo gravado conta como aberta: o defeito seria trancar quem se
      // cadastrou antes de este campo existir.
      if (!workspace.trialEndsAt) return active('TRIALING');

      const msLeft = workspace.trialEndsAt.getTime() - now.getTime();
      if (msLeft <= 0) {
        return {
          status: 'TRIALING',
          active: false,
          trialDaysLeft: 0,
          reason: 'Seu período de avaliação terminou. Assine para continuar gerando.',
        };
      }

      return {
        status: 'TRIALING',
        active: true,
        // Arredonda para cima: com trinta horas restantes, "1 dia" soa como já acabou.
        trialDaysLeft: Math.ceil(msLeft / 86_400_000),
        reason: null,
      };
    }

    case 'PAST_DUE': {
      /**
       * Cobrança falhou não é cancelamento.
       *
       * Cartão vence, banco recusa por engano, o gateway tenta de novo em dias. Cortar o
       * acesso no primeiro erro puniria quem quer pagar. O período já pago continua valendo;
       * depois dele, bloqueia.
       */
      const stillPaid = workspace.currentPeriodEnd !== null && workspace.currentPeriodEnd > now;

      return stillPaid
        ? active('PAST_DUE')
        : {
            status: 'PAST_DUE',
            active: false,
            trialDaysLeft: null,
            reason: 'Não conseguimos processar o pagamento. Atualize a forma de pagamento.',
          };
    }

    case 'CANCELED':
    default:
      return {
        status: 'CANCELED',
        active: false,
        trialDaysLeft: null,
        reason: 'Sua assinatura está inativa. Assine para continuar gerando.',
      };
  }
}

function active(status: SubscriptionStatus): SubscriptionState {
  return { status, active: true, trialDaysLeft: null, reason: null };
}

/** Quando a avaliação de um cadastro novo termina. */
export function trialEndsFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
}
