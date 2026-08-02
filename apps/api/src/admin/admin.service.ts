import { Injectable, Logger } from '@nestjs/common';
import type { SubscriptionStatus } from '@waymage/database';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestPrincipal } from '../auth/request-user';
import { PrismaService } from '../infra/prisma.service';
import { subscriptionState, type SubscriptionState } from '../subscriptions/subscription';

/**
 * Painel da plataforma.
 *
 * É a **única** parte do sistema que atravessa o isolamento entre workspaces de propósito.
 * Todo o resto filtra por `workspaceId` do principal; aqui não há filtro, e é isso que torna
 * cada método daqui uma superfície que precisa ser justificada uma a uma.
 *
 * **O que NÃO está aqui, e não vai estar:** conteúdo de projeto — cenas, referências, imagens
 * geradas. Saber quem usou e quanto é operação; ver o que a pessoa criou é outra coisa, e o
 * produto guarda imagem de gente. A exceção legítima seria a fila de moderação, onde olhar o
 * conteúdo é o trabalho — e ela ainda não existe.
 *
 * **Nenhum valor de credencial**, em hipótese alguma. O painel diz se existe chave, nunca qual.
 */

export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: Date;
  owner: { name: string; email: string } | null;
  subscription: SubscriptionState;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  members: number;
  projects: number;
  /** Ids dos provedores com chave ativa. Nunca o segredo, nem a dica. */
  providers: string[];
  imagesGenerated: number;
}

export interface PlatformOverview {
  workspaces: number;
  activeSubscriptions: number;
  trialing: number;
  imagesLast30Days: number;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(principal: RequestPrincipal): Promise<PlatformOverview> {
    this.trace(principal, 'overview');

    const since = new Date(Date.now() - 30 * 86_400_000);

    const [workspaces, byStatus, images] = await Promise.all([
      this.prisma.workspace.count({ where: { deletedAt: null } }),
      this.prisma.workspace.groupBy({
        by: ['subscriptionStatus'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.usageLedger.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { imagesProduced: true },
      }),
    ]);

    const count = (status: SubscriptionStatus) =>
      byStatus.find((row) => row.subscriptionStatus === status)?._count._all ?? 0;

    return {
      workspaces,
      activeSubscriptions: count('ACTIVE'),
      trialing: count('TRIALING'),
      imagesLast30Days: images._sum.imagesProduced ?? 0,
    };
  }

  /**
   * Lista os workspaces com o que responde "quem está usando e quem está em dia".
   *
   * As contagens vêm numa consulta só, por `_count`: uma por workspace transformaria a
   * primeira tela do painel num N+1 que cresce com o sucesso do produto.
   */
  async workspaces(principal: RequestPrincipal, limit = 100): Promise<WorkspaceSummary[]> {
    this.trace(principal, 'workspaces');

    const rows = await this.prisma.workspace.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        createdAt: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        _count: { select: { members: true, projects: true } },
        members: {
          where: { role: 'OWNER' },
          take: 1,
          select: { user: { select: { name: true, email: true } } },
        },
        providerCredentials: {
          where: { revokedAt: null },
          select: { provider: true },
        },
        usageLedger: { select: { imagesProduced: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      owner: row.members[0]?.user ?? null,
      subscription: subscriptionState(row),
      trialEndsAt: row.trialEndsAt,
      currentPeriodEnd: row.currentPeriodEnd,
      members: row._count.members,
      projects: row._count.projects,
      providers: row.providerCredentials.map((credential) => credential.provider),
      imagesGenerated: row.usageLedger.reduce((total, entry) => total + entry.imagesProduced, 0),
    }));
  }

  /**
   * Muda a assinatura de um workspace.
   *
   * É o que substitui o `UPDATE` manual no banco enquanto não há gateway. Quando a Stripe
   * entrar, ela escreve nos mesmos campos — e este método continua existindo para o caso de
   * precisar corrigir algo à mão.
   */
  async setSubscription(
    principal: RequestPrincipal,
    workspaceId: string,
    input: { status: SubscriptionStatus; until: Date | null },
    requestId?: string,
  ): Promise<WorkspaceSummary> {
    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        subscriptionStatus: input.status,
        // A data vai para o campo que corresponde ao estado: prazo de avaliação e fim de
        // período pago são coisas diferentes, e misturá-las faria o bloqueio errar.
        ...(input.status === 'TRIALING'
          ? { trialEndsAt: input.until }
          : { currentPeriodEnd: input.until }),
      },
      select: { id: true },
    });

    /**
     * A auditoria fica no workspace ALTERADO, não num registro do painel.
     *
     * Assim a interferência aparece para quem foi afetado, e não só para quem a fez. É a
     * diferença entre um administrador prestar contas e um administrador se anotar.
     */
    await this.audit.record({
      workspaceId: updated.id,
      actorUserId: principal.user.id,
      action: 'admin.subscription.set',
      resourceType: 'Workspace',
      resourceId: updated.id,
      metadata: { status: input.status, until: input.until?.toISOString() ?? null },
      ...(requestId ? { requestId } : {}),
    });

    const summary = (await this.workspaces(principal, 1000)).find((row) => row.id === workspaceId);
    if (!summary) throw AppError.notFound('Workspace');

    return summary;
  }

  /**
   * Leitura administrativa fica no log, não na auditoria.
   *
   * Gravar uma linha por consulta encheria a tabela de auditoria de ruído e ainda a associaria
   * a um workspace arbitrário — a listagem não tem um. O log basta para responder "quem olhou
   * o painel e quando".
   */
  private trace(principal: RequestPrincipal, action: string): void {
    this.logger.log({ actorUserId: principal.user.id, action }, 'Acesso administrativo');
  }
}
