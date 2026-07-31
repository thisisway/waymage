import {
  ModelRouter,
  ProviderError,
  PROVIDER_QUALITY,
  createProviderRegistry,
  type ImageProvider,
  type RoutingContext,
  type RoutingRequest,
} from '@waymage/provider-sdk';
import type { PrismaClient } from '@waymage/database';
import { env } from './config/env';

/**
 * Provedores disponíveis neste worker.
 *
 * A lista vem de `@waymage/provider-sdk` para ser a mesma que a API usa ao estimar — uma
 * estimativa feita sobre outro conjunto de provedores nao seria estimativa de nada.
 * Adapters reais entram lá, e apenas lá: o resto do worker fala com `ImageProvider`.
 */
export const providerRegistry = createProviderRegistry({
  latencyMs: env.FAKE_PROVIDER_LATENCY_MS,
});

export const modelRouter = new ModelRouter(providerRegistry);

/** Janela da taxa de sucesso recente. Curta o bastante para reagir a uma queda em curso. */
const RELIABILITY_WINDOW_MS = 60 * 60 * 1000;

/**
 * Taxa de sucesso por provedor na última hora.
 *
 * Uma consulta por job. Vale o custo: rotear para um fornecedor que está falhando agora
 * queima crédito e tempo até o fallback, e a informação já está no banco.
 *
 * Provedor sem execução recente fica de fora do mapa e conta como 1 — presumir o pior
 * congelaria um fornecedor novo, ou um que acabou de voltar, para sempre.
 */
export async function recentReliability(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<Record<string, number>> {
  const runs = await prisma.providerRun.groupBy({
    by: ['provider', 'status'],
    where: { createdAt: { gte: new Date(now.getTime() - RELIABILITY_WINDOW_MS) } },
    _count: { _all: true },
  });

  const totals = new Map<string, { ok: number; total: number }>();
  for (const run of runs) {
    const entry = totals.get(run.provider) ?? { ok: 0, total: 0 };
    const count = run._count._all;
    // `RUNNING` e `PENDING` ainda nao votaram: contá-los como falha puniria um provedor
    // apenas por estar ocupado.
    if (run.status === 'SUCCEEDED') entry.ok += count;
    if (run.status === 'SUCCEEDED' || run.status === 'FAILED') entry.total += count;
    totals.set(run.provider, entry);
  }

  return Object.fromEntries(
    [...totals].filter(([, e]) => e.total > 0).map(([id, e]) => [id, e.ok / e.total]),
  );
}

export function routingContext(reliability: Record<string, number>): RoutingContext {
  return { quality: PROVIDER_QUALITY, reliability };
}

/**
 * Os provedores que podem executar este job, do melhor para o pior.
 *
 * Devolve uma lista e nao um so porque o fallback precisa saber para onde ir. Provedor
 * forcado devolve lista de um: quem escolheu a dedo nao quer que o sistema troque por outro
 * pelas costas — a comparacao entre dois fornecedores deixaria de valer.
 */
export async function resolveCandidates(
  strategy: string,
  request: RoutingRequest,
  context: RoutingContext,
): Promise<ImageProvider[]> {
  if (strategy && strategy !== 'auto') return [providerRegistry.get(strategy)];

  const ranked = await modelRouter.rank(request, context);
  const eligible = ranked.filter((entry) => entry.eligible);

  if (eligible.length === 0) {
    const why = ranked.map((entry) => `${entry.provider}: ${entry.notes.join(', ')}`).join('; ');
    throw new ProviderError(
      'invalid_request',
      'NO_ELIGIBLE_PROVIDER',
      `Nenhum provedor atende a este pedido. ${why}`,
    );
  }

  return eligible.map((entry) => providerRegistry.get(entry.provider));
}
