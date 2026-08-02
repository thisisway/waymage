import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WorkspaceRole } from '@waymage/database';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../infra/prisma.service';
import type { LoginInput, RegisterInput } from './auth.schemas';
import { trialEndsFrom } from '../subscriptions/subscription';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TTL_SECONDS,
  hashRefreshToken,
  issueCsrfToken,
  issueRefreshToken,
  type AccessTokenClaims,
} from './tokens';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

/** Contexto de auditoria da requisição. Nunca inclui cookie, token ou senha. */
export interface RequestContext {
  ipAddress?: string;
  requestId?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(
    input: RegisterInput,
    ctx: RequestContext = {},
  ): Promise<{ user: AuthenticatedUser; tokens: SessionTokens; workspaceId: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      // Cadastro precisa dizer que o e-mail está em uso — é o único jeito de o usuário
      // entender o erro. O canal de enumeração aqui é mitigado por rate limit, não por
      // mensagem vaga, que só tornaria o produto ruim sem impedir a mesma descoberta.
      throw new AppError(
        'EMAIL_ALREADY_REGISTERED',
        'Este e-mail já está cadastrado.',
        HttpStatus.CONFLICT,
      );
    }

    const passwordHash = await hashPassword(input.password);
    const workspaceName = input.workspaceName ?? `Workspace de ${input.name}`;

    // Usuário, workspace e associação de dono nascem juntos ou não nascem: um usuário sem
    // workspace não conseguiria fazer absolutamente nada no produto.
    const { user, workspace } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
        select: { id: true, email: true, name: true },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: workspaceName,
          slug: await this.uniqueSlug(tx, workspaceName),
          members: { create: { userId: user.id, role: WorkspaceRole.OWNER } },
          // A avaliação começa no cadastro, não na primeira geração: o relógio precisa ser
          // previsível para quem contrata, e "quando você começou a usar" não é uma data.
          trialEndsAt: trialEndsFrom(),
        },
        select: { id: true },
      });

      return { user, workspace };
    });

    const tokens = await this.issueSession(user.id, user.email);

    await this.audit.record({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: 'auth.register',
      resourceType: 'User',
      resourceId: user.id,
      ...ctx,
    });

    return { user, tokens, workspaceId: workspace.id };
  }

  async login(
    input: LoginInput,
    ctx: RequestContext = {},
  ): Promise<{ user: AuthenticatedUser; tokens: SessionTokens }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Sempre gasta o tempo do scrypt, mesmo sem usuário: senão a diferença de latência
    // entre "e-mail existe" e "não existe" enumera a base de usuários.
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!user || !valid) {
      // Resposta idêntica nos dois casos.
      throw new AppError(
        'INVALID_CREDENTIALS',
        'E-mail ou senha incorretos.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tokens = await this.issueSession(user.id, user.email);

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.login',
      resourceType: 'User',
      resourceId: user.id,
      ...ctx,
    });

    return { user: { id: user.id, email: user.email, name: user.name }, tokens };
  }

  /**
   * Rotação de refresh com detecção de reuso.
   *
   * Cada refresh vale uma única troca. Se um token já consumido reaparecer, o cookie foi
   * copiado — não há como saber se quem apresentou é o dono ou o atacante, então a família
   * inteira cai e os dois precisam entrar de novo.
   */
  async refresh(
    refreshToken: string,
    ctx: RequestContext = {},
  ): Promise<{ user: AuthenticatedUser; tokens: SessionTokens }> {
    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        family: true,
        userId: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });

    if (!stored) throw this.invalidSession();

    if (stored.consumedAt || stored.revokedAt) {
      await this.revokeFamily(stored.family);
      this.logger.warn(
        { userId: stored.userId, family: stored.family, requestId: ctx.requestId },
        'Reuso de refresh token detectado; família revogada',
      );
      await this.audit.record({
        actorUserId: stored.userId,
        action: 'auth.refresh_reuse_detected',
        resourceType: 'RefreshToken',
        resourceId: stored.id,
        ...ctx,
      });
      throw this.invalidSession();
    }

    if (stored.expiresAt.getTime() <= Date.now()) throw this.invalidSession();

    const next = issueRefreshToken(stored.family);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: next.tokenHash,
          family: next.family,
          expiresAt: next.expiresAt,
        },
      }),
    ]);

    return {
      user: stored.user,
      tokens: {
        accessToken: await this.signAccessToken(stored.user.id, stored.user.email),
        refreshToken: next.token,
        csrfToken: issueCsrfToken(),
      },
    };
  }

  /** Logout derruba a família inteira: sair numa aba encerra a sessão daquele login. */
  async logout(refreshToken: string | undefined, ctx: RequestContext = {}): Promise<void> {
    if (!refreshToken) return;

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      select: { family: true, userId: true },
    });
    if (!stored) return;

    await this.revokeFamily(stored.family);
    await this.audit.record({
      actorUserId: stored.userId,
      action: 'auth.logout',
      resourceType: 'User',
      resourceId: stored.userId,
      ...ctx,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      return await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: ACCESS_TOKEN_ISSUER,
      });
    } catch {
      throw this.invalidSession();
    }
  }

  private async issueSession(userId: string, email: string): Promise<SessionTokens> {
    const refresh = issueRefreshToken(randomUUID());

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refresh.tokenHash,
        family: refresh.family,
        expiresAt: refresh.expiresAt,
      },
    });

    return {
      accessToken: await this.signAccessToken(userId, email),
      refreshToken: refresh.token,
      csrfToken: issueCsrfToken(),
    };
  }

  private signAccessToken(userId: string, email: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, email } satisfies AccessTokenClaims, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      audience: ACCESS_TOKEN_AUDIENCE,
      issuer: ACCESS_TOKEN_ISSUER,
    });
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private invalidSession(): AppError {
    return new AppError('INVALID_SESSION', 'Sessão inválida ou expirada.', HttpStatus.UNAUTHORIZED);
  }

  /** Slug legível e único. Colisão resolvida por sufixo curto, não por tentativa e erro. */
  private async uniqueSlug(
    tx: {
      workspace: {
        findUnique: (args: { where: { slug: string }; select: { id: true } }) => Promise<unknown>;
      };
    },
    name: string,
  ): Promise<string> {
    const base =
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace';

    if (!(await tx.workspace.findUnique({ where: { slug: base }, select: { id: true } }))) {
      return base;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
  }
}
