import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { WorkspaceRole } from '@waymage/database';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from './auth.service';

/**
 * Identidade e associação resolvidas pelos guards e anexadas à requisição.
 *
 * `workspaceId` vive **aqui**, nunca no body ou na query. Aceitar workspace do cliente é
 * IDOR por construção: bastaria trocar um id no JSON para ler dados alheios.
 */
export interface RequestPrincipal {
  user: AuthenticatedUser;
  workspaceId: string;
  role: WorkspaceRole;
}

export type AuthenticatedRequest = FastifyRequest & {
  principal?: RequestPrincipal;
};

/** `@CurrentUser()` no controller. Só existe depois do AuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.principal?.user;
});

/** `@Principal()` quando o handler também precisa do workspace e do papel. */
export const Principal = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.principal;
});
