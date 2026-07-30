import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../infra/prisma.service';
import type { CreateProjectInput, UpdateProjectInput } from './projects.schemas';
import type { RequestPrincipal } from '../auth/request-user';

export interface ProjectView {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const projectSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * CRUD de projetos.
 *
 * Regra invariável: **toda** consulta filtra por `workspaceId` vindo do principal, e nunca de
 * parâmetro do cliente. `deletedAt: null` acompanha, porque soft delete sem filtro é o mesmo
 * que não ter apagado.
 *
 * Recurso de outro workspace responde 404, não 403 — 403 confirmaria que o id existe.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: RequestPrincipal): Promise<ProjectView[]> {
    return this.prisma.project.findMany({
      where: { workspaceId: principal.workspaceId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: projectSelect,
    });
  }

  async get(principal: RequestPrincipal, projectId: string): Promise<ProjectView> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId: principal.workspaceId, deletedAt: null },
      select: projectSelect,
    });
    if (!project) throw AppError.notFound('Projeto');
    return project;
  }

  async create(
    principal: RequestPrincipal,
    input: CreateProjectInput,
    requestId?: string,
  ): Promise<ProjectView> {
    const project = await this.prisma.project.create({
      data: {
        workspaceId: principal.workspaceId,
        name: input.name,
        description: input.description ?? null,
      },
      select: projectSelect,
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'project.create',
      resourceType: 'Project',
      resourceId: project.id,
      ...(requestId ? { requestId } : {}),
    });

    return project;
  }

  async update(
    principal: RequestPrincipal,
    projectId: string,
    input: UpdateProjectInput,
    requestId?: string,
  ): Promise<ProjectView> {
    // Confirma pertencimento antes de escrever: `update` por id só, sem o filtro de
    // workspace, permitiria alterar projeto alheio conhecendo o UUID.
    await this.get(principal, projectId);

    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      },
      select: projectSelect,
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'project.update',
      resourceType: 'Project',
      resourceId: project.id,
      metadata: { fields: Object.keys(input) },
      ...(requestId ? { requestId } : {}),
    });

    return project;
  }

  /** Soft delete: cenas, assets e gerações continuam referenciáveis para auditoria. */
  async remove(principal: RequestPrincipal, projectId: string, requestId?: string): Promise<void> {
    await this.get(principal, projectId);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'project.delete',
      resourceType: 'Project',
      resourceId: projectId,
      ...(requestId ? { requestId } : {}),
    });
  }
}
