import { Injectable } from '@nestjs/common';
import { AssetKind, AssetStatus, type Prisma } from '@waymage/database';
import { AppError } from '../common/app-error';
import { createEmptySceneSpec } from '@waymage/scene-spec';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { AppStorageService } from '../infra/storage.service';
import type { CreateProjectInput, UpdateProjectInput } from './projects.schemas';
import type { RequestPrincipal } from '../auth/request-user';

export interface ProjectView {
  /** Só na criação: a cena que nasceu junto, para a tela ir direto ao editor. */
  firstSceneId?: string;
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Última imagem gerada no projeto. É a capa do cartão na lista. */
  previewUrl: string | null;
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
    private readonly storage: AppStorageService,
  ) {}

  async list(principal: RequestPrincipal): Promise<ProjectView[]> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId: principal.workspaceId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: projectSelect,
    });

    return this.withPreviews(principal.workspaceId, projects);
  }

  /**
   * Anexa a capa de cada projeto.
   *
   * Uma consulta só para todos os projetos, e não uma por projeto: a lista é a primeira tela
   * depois do login e N+1 aqui apareceria como lentidão logo na entrada.
   */
  private async withPreviews(
    workspaceId: string,
    projects: Omit<ProjectView, 'previewUrl'>[],
  ): Promise<ProjectView[]> {
    if (projects.length === 0) return [];

    const assets = await this.prisma.asset.findMany({
      where: {
        workspaceId,
        projectId: { in: projects.map((project) => project.id) },
        kind: AssetKind.GENERATED,
        status: AssetStatus.READY,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { projectId: true, storageKey: true },
    });

    // Ordenado por data desc: o primeiro de cada projeto é o mais recente.
    const latest = new Map<string, string>();
    for (const asset of assets) {
      if (asset.projectId && !latest.has(asset.projectId)) {
        latest.set(asset.projectId, asset.storageKey);
      }
    }

    return Promise.all(
      projects.map(async (project) => {
        const key = latest.get(project.id);
        return {
          ...project,
          previewUrl: key ? await this.storage.signedReadUrl(key) : null,
        };
      }),
    );
  }

  async get(principal: RequestPrincipal, projectId: string): Promise<ProjectView> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId: principal.workspaceId, deletedAt: null },
      select: projectSelect,
    });
    if (!project) throw AppError.notFound('Projeto');

    const [withPreview] = await this.withPreviews(principal.workspaceId, [project]);
    return withPreview as ProjectView;
  }

  async create(
    principal: RequestPrincipal,
    input: CreateProjectInput,
    requestId?: string,
  ): Promise<ProjectView> {
    /**
     * O projeto nasce com a primeira cena.
     *
     * Sem isto, criar um projeto levava a uma lista vazia com outro formulário de nome — dois
     * batismos antes de qualquer coisa acontecer. A cena continua sendo a unidade que guarda
     * o `SceneSpec`, as versões e as gerações; o que sai é o passo, não o conceito.
     *
     * Numa transação: um projeto sem cena seria exatamente a tela vazia que se quis evitar,
     * e agora sem formulário para sair dela.
     */
    const { project, firstScene } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId: principal.workspaceId,
          name: input.name,
          description: input.description ?? null,
        },
        select: projectSelect,
      });

      const spec = createEmptySceneSpec();
      const scene = await tx.scene.create({
        data: {
          workspaceId: principal.workspaceId,
          projectId: created.id,
          // O nome do projeto, e não "Cena 1": na esmagadora maioria dos casos o projeto TEM
          // uma cena só, e repetir o nome é mais reconhecível do que numerar.
          name: input.name,
          draftSpec: spec as unknown as Prisma.InputJsonValue,
          specVersion: spec.version,
        },
        select: { id: true },
      });

      return { project: created, firstScene: scene };
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'project.create',
      resourceType: 'Project',
      resourceId: project.id,
      ...(requestId ? { requestId } : {}),
    });

    return { ...project, previewUrl: null, firstSceneId: firstScene.id };
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

    return { ...project, previewUrl: null };
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
