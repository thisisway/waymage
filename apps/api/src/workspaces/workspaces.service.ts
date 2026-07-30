import { HttpStatus, Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@waymage/database';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import type { InviteMemberInput } from '../auth/auth.schemas';
import type { RequestPrincipal } from '../auth/request-user';

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  planCode: string;
  role: WorkspaceRole;
}

export interface MemberView {
  id: string;
  role: WorkspaceRole;
  user: { id: string; name: string; email: string };
  createdAt: Date;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Workspaces do usuário. A lista vem das associações, nunca de um filtro por id do cliente. */
  async listForUser(userId: string): Promise<WorkspaceView[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, slug: true, planCode: true } },
      },
    });

    return memberships.map((m) => ({ ...m.workspace, role: m.role }));
  }

  async current(principal: RequestPrincipal): Promise<WorkspaceView> {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: principal.workspaceId, deletedAt: null },
      select: { id: true, name: true, slug: true, planCode: true },
    });
    if (!workspace) throw AppError.notFound('Workspace');
    return { ...workspace, role: principal.role };
  }

  async listMembers(principal: RequestPrincipal): Promise<MemberView[]> {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId: principal.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Adiciona um usuário existente ao workspace.
   *
   * Convite por e-mail para quem ainda não tem conta exige envio de mensagem e token de
   * aceite — fica para quando houver serviço de e-mail configurado. Até lá, a pessoa se
   * cadastra e é adicionada aqui.
   */
  async addMember(
    principal: RequestPrincipal,
    input: InviteMemberInput,
    requestId?: string,
  ): Promise<MemberView> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      throw new AppError(
        'USER_NOT_REGISTERED',
        'Nenhuma conta encontrada com este e-mail. Peça para a pessoa se cadastrar primeiro.',
        HttpStatus.NOT_FOUND,
      );
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: principal.workspaceId, userId: user.id } },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        'ALREADY_MEMBER',
        'Esta pessoa já faz parte do workspace.',
        HttpStatus.CONFLICT,
      );
    }

    const member = await this.prisma.workspaceMember.create({
      data: {
        workspaceId: principal.workspaceId,
        userId: user.id,
        role: input.role as WorkspaceRole,
      },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'workspace.member_added',
      resourceType: 'WorkspaceMember',
      resourceId: member.id,
      metadata: { role: input.role },
      ...(requestId ? { requestId } : {}),
    });

    return member;
  }

  async removeMember(
    principal: RequestPrincipal,
    memberId: string,
    requestId?: string,
  ): Promise<void> {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: principal.workspaceId },
      select: { id: true, role: true, userId: true },
    });
    if (!member) throw AppError.notFound('Membro');

    if (member.role === WorkspaceRole.OWNER) {
      // Remover o último OWNER deixaria o workspace sem ninguém capaz de administrá-lo.
      const owners = await this.prisma.workspaceMember.count({
        where: { workspaceId: principal.workspaceId, role: WorkspaceRole.OWNER },
      });
      if (owners <= 1) {
        throw new AppError(
          'LAST_OWNER',
          'O workspace precisa de ao menos um proprietário.',
          HttpStatus.CONFLICT,
        );
      }
    }

    await this.prisma.workspaceMember.delete({ where: { id: member.id } });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'workspace.member_removed',
      resourceType: 'WorkspaceMember',
      resourceId: member.id,
      ...(requestId ? { requestId } : {}),
    });
  }
}
