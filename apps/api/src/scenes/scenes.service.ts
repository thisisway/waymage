import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@waymage/database';
import {
  createEmptySceneSpec,
  parseSceneSpec,
  SceneSpecParseError,
  SCENE_SPEC_VERSION,
  validateSceneSpec,
  type SceneSpec,
  type ValidationIssue,
} from '@waymage/scene-spec';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import type { RequestPrincipal } from '../auth/request-user';
import type { AutosaveSceneInput, CreateSceneInput, CreateVersionInput } from './scenes.schemas';

export interface SceneView {
  id: string;
  projectId: string;
  name: string;
  sceneSpec: SceneSpec;
  revision: number;
  currentVersionId: string | null;
  /** Conflitos detectados no rascunho atual, para exibição inline no editor. */
  issues: ValidationIssue[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SceneSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: Date;
}

export interface SceneVersionView {
  id: string;
  versionNumber: number;
  changeSummary: string | null;
  parentVersionId: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
}

export interface SceneVersionDetail extends SceneVersionView {
  sceneSpec: SceneSpec;
  specVersion: string;
}

@Injectable()
export class ScenesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: RequestPrincipal, projectId: string): Promise<SceneSummary[]> {
    await this.assertProject(principal, projectId);

    return this.prisma.scene.findMany({
      where: { workspaceId: principal.workspaceId, projectId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, revision: true, updatedAt: true },
    });
  }

  async get(principal: RequestPrincipal, sceneId: string): Promise<SceneView> {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, workspaceId: principal.workspaceId, deletedAt: null },
      select: sceneSelect,
    });
    if (!scene) throw AppError.notFound('Cena');
    return toView(scene);
  }

  async create(
    principal: RequestPrincipal,
    projectId: string,
    input: CreateSceneInput,
    requestId?: string,
  ): Promise<SceneView> {
    await this.assertProject(principal, projectId);

    const spec =
      input.sceneSpec === undefined ? createEmptySceneSpec() : this.parse(input.sceneSpec);

    const scene = await this.prisma.scene.create({
      data: {
        workspaceId: principal.workspaceId,
        projectId,
        name: input.name,
        draftSpec: spec as unknown as Prisma.InputJsonValue,
        specVersion: spec.version,
      },
      select: sceneSelect,
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'scene.create',
      resourceType: 'Scene',
      resourceId: scene.id,
      ...(requestId ? { requestId } : {}),
    });

    return toView(scene);
  }

  /**
   * Autosave com trava otimista.
   *
   * A gravação é um compare-and-swap no próprio banco: o `UPDATE` casa `revision` junto do
   * id, então duas abas salvando ao mesmo tempo não podem ambas vencer. Ler o registro,
   * comparar em memória e depois escrever deixaria uma janela entre a leitura e a escrita —
   * e a segunda aba sobrescreveria a primeira em silêncio.
   *
   * Só grava rascunho válido: SceneSpec quebrado é recusado antes de tocar o banco.
   */
  async autosave(
    principal: RequestPrincipal,
    sceneId: string,
    input: AutosaveSceneInput,
  ): Promise<SceneView> {
    const data: Prisma.SceneUpdateManyMutationInput = { revision: { increment: 1 } };

    if (input.name !== undefined) data.name = input.name;
    if (input.sceneSpec !== undefined) {
      const spec = this.parse(input.sceneSpec);
      data.draftSpec = spec as unknown as Prisma.InputJsonValue;
      data.specVersion = spec.version;
    }

    const { count } = await this.prisma.scene.updateMany({
      where: {
        id: sceneId,
        workspaceId: principal.workspaceId,
        deletedAt: null,
        revision: input.revision,
      },
      data,
    });

    if (count === 0) {
      // Nada foi gravado por um de dois motivos, e a resposta precisa distinguir: a cena não
      // existe (ou é de outro workspace) → 404; existe mas mudou desde a leitura → 409 com o
      // estado atual, para o editor mostrar o conflito em vez de perder o trabalho.
      const current = await this.prisma.scene.findFirst({
        where: { id: sceneId, workspaceId: principal.workspaceId, deletedAt: null },
        select: sceneSelect,
      });
      if (!current) throw AppError.notFound('Cena');

      throw new AppError(
        'SCENE_REVISION_CONFLICT',
        'Esta cena foi alterada em outro lugar. Recarregue para ver a versão mais recente.',
        HttpStatus.CONFLICT,
        { currentRevision: current.revision, yourRevision: input.revision },
      );
    }

    return this.get(principal, sceneId);
  }

  /**
   * Snapshot imutável do rascunho.
   *
   * É o que garante a regra do blueprint: toda geração aponta para um SceneSpec que não muda
   * mais. Criado explicitamente pelo usuário e, a partir da Fase 5, automaticamente antes de
   * cada geração.
   */
  async createVersion(
    principal: RequestPrincipal,
    sceneId: string,
    input: CreateVersionInput,
    requestId?: string,
  ): Promise<SceneVersionDetail> {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, workspaceId: principal.workspaceId, deletedAt: null },
      select: { id: true, draftSpec: true, specVersion: true, currentVersionId: true },
    });
    if (!scene) throw AppError.notFound('Cena');

    // Recusa snapshot de rascunho inválido: uma versão imutável quebrada ficaria para sempre.
    const spec = this.parse(scene.draftSpec);

    const version = await this.prisma.$transaction(async (tx) => {
      // Numeração dentro da transação: duas requisições simultâneas não podem gerar o mesmo
      // número. A constraint única em (sceneId, versionNumber) é a rede de segurança.
      const last = await tx.sceneVersion.findFirst({
        where: { sceneId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });

      const created = await tx.sceneVersion.create({
        data: {
          workspaceId: principal.workspaceId,
          sceneId,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          sceneSpec: spec as unknown as Prisma.InputJsonValue,
          specVersion: scene.specVersion,
          parentVersionId: scene.currentVersionId,
          changeSummary: input.changeSummary ?? null,
          createdById: principal.user.id,
        },
        select: versionSelect,
      });

      await tx.scene.update({
        where: { id: sceneId },
        data: { currentVersionId: created.id },
      });

      return created;
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'scene.version_create',
      resourceType: 'SceneVersion',
      resourceId: version.id,
      metadata: { sceneId, versionNumber: version.versionNumber },
      ...(requestId ? { requestId } : {}),
    });

    return toVersionDetail(version);
  }

  async listVersions(principal: RequestPrincipal, sceneId: string): Promise<SceneVersionView[]> {
    await this.get(principal, sceneId);

    const versions = await this.prisma.sceneVersion.findMany({
      where: { sceneId, workspaceId: principal.workspaceId },
      orderBy: { versionNumber: 'desc' },
      select: versionSelect,
    });

    return versions.map(toVersionView);
  }

  async getVersion(principal: RequestPrincipal, versionId: string): Promise<SceneVersionDetail> {
    const version = await this.prisma.sceneVersion.findFirst({
      where: { id: versionId, workspaceId: principal.workspaceId },
      select: versionSelect,
    });
    if (!version) throw AppError.notFound('Versão');
    return toVersionDetail(version);
  }

  /** Cria uma cena nova a partir de uma versão — explorar variação sem tocar no original. */
  async duplicateVersion(
    principal: RequestPrincipal,
    versionId: string,
    requestId?: string,
  ): Promise<SceneView> {
    const version = await this.prisma.sceneVersion.findFirst({
      where: { id: versionId, workspaceId: principal.workspaceId },
      select: {
        sceneSpec: true,
        specVersion: true,
        versionNumber: true,
        scene: { select: { id: true, name: true, projectId: true, deletedAt: true } },
      },
    });
    if (!version || version.scene.deletedAt) throw AppError.notFound('Versão');

    const scene = await this.prisma.scene.create({
      data: {
        workspaceId: principal.workspaceId,
        projectId: version.scene.projectId,
        name: `${version.scene.name} (cópia da v${version.versionNumber})`,
        draftSpec: version.sceneSpec as Prisma.InputJsonValue,
        specVersion: version.specVersion,
      },
      select: sceneSelect,
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'scene.duplicate_version',
      resourceType: 'Scene',
      resourceId: scene.id,
      metadata: { sourceVersionId: versionId },
      ...(requestId ? { requestId } : {}),
    });

    return toView(scene);
  }

  async remove(principal: RequestPrincipal, sceneId: string, requestId?: string): Promise<void> {
    await this.get(principal, sceneId);

    await this.prisma.scene.update({
      where: { id: sceneId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'scene.delete',
      resourceType: 'Scene',
      resourceId: sceneId,
      ...(requestId ? { requestId } : {}),
    });
  }

  /** Confirma que o projeto é do workspace antes de criar ou listar cenas dentro dele. */
  private async assertProject(principal: RequestPrincipal, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId: principal.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw AppError.notFound('Projeto');
  }

  private parse(input: unknown): SceneSpec {
    try {
      return parseSceneSpec(input);
    } catch (error) {
      if (error instanceof SceneSpecParseError) {
        throw new AppError('SCENE_SPEC_INVALID', 'SceneSpec inválido.', HttpStatus.BAD_REQUEST, {
          expectedVersion: SCENE_SPEC_VERSION,
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      throw error;
    }
  }
}

const sceneSelect = {
  id: true,
  projectId: true,
  name: true,
  draftSpec: true,
  revision: true,
  currentVersionId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const versionSelect = {
  id: true,
  versionNumber: true,
  sceneSpec: true,
  specVersion: true,
  changeSummary: true,
  parentVersionId: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

type SceneRow = {
  id: string;
  projectId: string;
  name: string;
  draftSpec: unknown;
  revision: number;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toView(scene: SceneRow): SceneView {
  // O rascunho gravado sempre passou por `parseSceneSpec`, então isto não deve falhar. Se
  // falhar, o problema é dado corrompido no banco — e estourar é melhor que devolver lixo.
  const sceneSpec = parseSceneSpec(scene.draftSpec);

  return {
    id: scene.id,
    projectId: scene.projectId,
    name: scene.name,
    sceneSpec,
    revision: scene.revision,
    currentVersionId: scene.currentVersionId,
    issues: validateSceneSpec(sceneSpec),
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  };
}

type VersionRow = {
  id: string;
  versionNumber: number;
  sceneSpec: unknown;
  specVersion: string;
  changeSummary: string | null;
  parentVersionId: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
};

function toVersionView(version: VersionRow): SceneVersionView {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    changeSummary: version.changeSummary,
    parentVersionId: version.parentVersionId,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  };
}

function toVersionDetail(version: VersionRow): SceneVersionDetail {
  return {
    ...toVersionView(version),
    sceneSpec: parseSceneSpec(version.sceneSpec),
    specVersion: version.specVersion,
  };
}
