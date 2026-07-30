import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '@waymage/database';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import { AuthService } from './auth.service';
import { COOKIE, CSRF_HEADER } from './cookies';
import type { AuthenticatedRequest } from './request-user';

/** Marca rotas abertas. O guard é global: acesso público é opt-in explícito, nunca o default. */
export const PUBLIC_ROUTE = 'waymage:public';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Papel mínimo exigido. Ausente = qualquer membro do workspace serve. */
export const REQUIRED_ROLE = 'waymage:role';
export const RequireRole = (role: WorkspaceRole) => SetMetadata(REQUIRED_ROLE, role);

/**
 * Dispensa a verificação de CSRF.
 *
 * Só é correto em rotas que **não** usam credencial ambiente do browser: quem faz login
 * ainda não tem cookie de sessão nem token CSRF, então exigi-lo tornaria impossível entrar.
 * A autorização dessas rotas vem do corpo da requisição (e-mail e senha), que um site
 * atacante não conhece.
 *
 * Nunca aplicar em rota que se autoriza por cookie — `/auth/refresh` e `/auth/logout` usam
 * o cookie de refresh e por isso continuam exigindo CSRF.
 */
export const SKIP_CSRF = 'waymage:skip-csrf';
export const NoCsrf = () => SetMetadata(SKIP_CSRF, true);

/** Hierarquia de papéis. Número maior = mais poder. */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function roleSatisfies(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Métodos que alteram estado precisam de CSRF; leitura não. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Guard global de autenticação, tenancy e RBAC.
 *
 * Faz três coisas, nesta ordem, porque cada uma depende da anterior:
 *   1. valida CSRF em mutações (a sessão é cookie, logo o browser a envia sozinho);
 *   2. valida o access token e resolve o usuário;
 *   3. resolve a associação com o workspace e confere o papel.
 *
 * Ser global e exigir `@Public()` para abrir é deliberado: um endpoint novo que alguém
 * esqueça de anotar nasce protegido, e não exposto.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!skipCsrf && MUTATING_METHODS.has(request.method)) this.assertCsrf(request);
    if (isPublic) return true;

    const token = request.cookies?.[COOKIE.access];
    if (!token) {
      throw new AppError('UNAUTHENTICATED', 'Faça login para continuar.', HttpStatus.UNAUTHORIZED);
    }

    const claims = await this.auth.verifyAccessToken(token);

    // Associação lida a cada request, nunca do token: remover alguém de um workspace precisa
    // ter efeito imediato, não em até 15 minutos.
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId: claims.sub, workspace: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        workspaceId: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });

    if (!membership) {
      throw new AppError(
        'NO_WORKSPACE',
        'Sua conta não pertence a nenhum workspace.',
        HttpStatus.FORBIDDEN,
      );
    }

    const requiredRole = this.reflector.getAllAndOverride<WorkspaceRole | undefined>(
      REQUIRED_ROLE,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRole && !roleSatisfies(membership.role, requiredRole)) {
      throw new AppError(
        'INSUFFICIENT_ROLE',
        'Você não tem permissão para esta ação.',
        HttpStatus.FORBIDDEN,
      );
    }

    request.principal = {
      user: membership.user,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    return true;
  }

  /**
   * Double-submit: o cookie `csrf` (legível) precisa bater com o header enviado pelo cliente.
   *
   * Funciona porque um site atacante consegue fazer o browser mandar o cookie, mas não
   * consegue ler o valor dele para replicar no header — a same-origin policy impede.
   */
  private assertCsrf(request: AuthenticatedRequest): void {
    const cookie = request.cookies?.[COOKIE.csrf];
    const header = request.headers[CSRF_HEADER];
    const sent = Array.isArray(header) ? header[0] : header;

    if (!cookie || !sent || !equalsConstantTime(cookie, sent)) {
      throw new AppError('CSRF_TOKEN_INVALID', 'Requisição inválida.', HttpStatus.FORBIDDEN);
    }
  }
}

function equalsConstantTime(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
