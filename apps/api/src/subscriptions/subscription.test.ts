import { describe, expect, it } from 'vitest';
import { TRIAL_DAYS, subscriptionState, trialEndsFrom } from './subscription';

const NOW = new Date('2026-08-02T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('subscriptionState', () => {
  it('ativa libera', () => {
    const state = subscriptionState(
      { subscriptionStatus: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null },
      NOW,
    );

    expect(state.active).toBe(true);
    expect(state.reason).toBeNull();
  });

  it('avaliação em curso libera e conta os dias', () => {
    const state = subscriptionState(
      { subscriptionStatus: 'TRIALING', trialEndsAt: days(3), currentPeriodEnd: null },
      NOW,
    );

    expect(state.active).toBe(true);
    expect(state.trialDaysLeft).toBe(3);
  });

  it('arredonda o último dia para cima', () => {
    // Com trinta horas restantes, "1 dia" soa como se já tivesse acabado.
    const state = subscriptionState(
      { subscriptionStatus: 'TRIALING', trialEndsAt: days(1.25), currentPeriodEnd: null },
      NOW,
    );

    expect(state.trialDaysLeft).toBe(2);
  });

  it('avaliação vencida bloqueia', () => {
    const state = subscriptionState(
      { subscriptionStatus: 'TRIALING', trialEndsAt: days(-1), currentPeriodEnd: null },
      NOW,
    );

    expect(state.active).toBe(false);
    expect(state.trialDaysLeft).toBe(0);
    expect(state.reason).toContain('avaliação');
  });

  it('avaliação sem prazo gravado não tranca ninguém', () => {
    // Workspace criado antes de o campo existir. Bloquear seria punir por uma migração.
    const state = subscriptionState(
      { subscriptionStatus: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null },
      NOW,
    );

    expect(state.active).toBe(true);
  });

  it('cobrança falha não corta o período já pago', () => {
    // Cartão vence e o banco recusa por engano; o gateway tenta de novo em dias. Cortar no
    // primeiro erro puniria quem quer pagar.
    const state = subscriptionState(
      { subscriptionStatus: 'PAST_DUE', trialEndsAt: null, currentPeriodEnd: days(5) },
      NOW,
    );

    expect(state.active).toBe(true);
  });

  it('cobrança falha bloqueia depois do período pago', () => {
    const state = subscriptionState(
      { subscriptionStatus: 'PAST_DUE', trialEndsAt: null, currentPeriodEnd: days(-1) },
      NOW,
    );

    expect(state.active).toBe(false);
    expect(state.reason).toContain('pagamento');
  });

  it('cancelada bloqueia', () => {
    const state = subscriptionState(
      { subscriptionStatus: 'CANCELED', trialEndsAt: null, currentPeriodEnd: days(30) },
      NOW,
    );

    // Mesmo com período pago em aberto: cancelar é uma decisão do usuário, e mantê-lo dentro
    // seria ignorá-la.
    expect(state.active).toBe(false);
  });
});

describe('trialEndsFrom', () => {
  it('conta os dias de avaliação a partir de agora', () => {
    expect(trialEndsFrom(NOW).getTime()).toBe(days(TRIAL_DAYS).getTime());
  });
});
