import {
  ModelRouter,
  ProviderError,
  PROVIDER_QUALITY,
  createWorkspaceRegistry,
  type ImageProvider,
  type ProviderRegistry,
  type RoutingContext,
  type RoutingRequest,
} from '@waymage/provider-sdk';
import { openSecret } from '@waymage/domain';
import type { PrismaClient } from '@waymage/database';
import { env } from './config/env';

/**
 * Provedores disponíveis para UM job.
 *
 * Deixou de ser um registro do processo quando a chave passou a ser do usuário (D-070): dois
 * workspaces têm contas diferentes no mesmo fornecedor, e um registro compartilhado geraria
 * a imagem de um na fatura do outro.
 *
 * A chave é decifrada aqui, usada, e não sobrevive ao job — não entra em log, em `ProviderRun`
 * nem em mensagem de erro.
 */
export async function registryFor(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<ProviderRegistry> {
  const rows = await prisma.providerCredential.findMany({
    where: { workspaceId, revokedAt: null },
    select: { provider: true, secretSealed: true },
  });

  const credentials = rows.map((row) => ({
    provider: row.provider,
    secret: openSecret(row.secretSealed, env.CREDENTIALS_ENCRYPTION_KEY),
  }));

  return createWorkspaceRegistry({
    credentials,
    // Fora de produção os fakes ficam disponíveis, para o desenvolvimento não exigir chave.
    includeFakes: env.NODE_ENV !== 'production',
    fakeLatencyMs: env.FAKE_PROVIDER_LATENCY_MS,
  });
}

/** Marca a credencial como usada. Ajuda a identificar chave esquecida meses depois. */
export async function markCredentialUsed(
  prisma: PrismaClient,
  workspaceId: string,
  provider: string,
): Promise<void> {
  await prisma.providerCredential.updateMany({
    where: { workspaceId, provider, revokedAt: null },
    data: { lastUsedAt: new Date() },
  });
}

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
  registry: ProviderRegistry,
  strategy: string,
  request: RoutingRequest,
  context: RoutingContext,
): Promise<ImageProvider[]> {
  if (registry.ids().length === 0) {
    throw new ProviderError(
      'invalid_request',
      'NO_PROVIDER_CREDENTIAL',
      'Nenhuma chave de IA cadastrada neste workspace. Cadastre uma em Chaves de IA para gerar.',
    );
  }

  if (strategy && strategy !== 'auto') return [registry.get(strategy)];

  const ranked = await new ModelRouter(registry).rank(request, context);
  const eligible = ranked.filter((entry) => entry.eligible);

  if (eligible.length === 0) {
    const why = ranked.map((entry) => `${entry.provider}: ${entry.notes.join(', ')}`).join('; ');
    throw new ProviderError(
      'invalid_request',
      'NO_ELIGIBLE_PROVIDER',
      `Nenhum provedor atende a este pedido. ${why}`,
    );
  }

  return eligible.map((entry) => registry.get(entry.provider));
}
