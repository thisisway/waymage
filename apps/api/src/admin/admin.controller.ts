import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { z } from 'zod';
import { PlatformAdmin } from '../auth/auth.guard';
import { Principal, type AuthenticatedRequest, type RequestPrincipal } from '../auth/request-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminService, type PlatformOverview, type WorkspaceSummary } from './admin.service';

const setSubscriptionSchema = z.object({
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED']),
  /** Prazo de avaliação ou fim do período pago, conforme o estado. */
  until: z.coerce.date().nullable().default(null),
});

type SetSubscriptionInput = z.infer<typeof setSubscriptionSchema>;

/**
 * Painel da plataforma.
 *
 * `@PlatformAdmin()` na CLASSE, e não em cada método: um marcador esquecido aqui abriria dado
 * de todos os workspaces para qualquer usuário autenticado, e é o tipo de omissão que passa
 * despercebida numa revisão.
 */
@Controller('admin')
@PlatformAdmin()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(@Principal() principal: RequestPrincipal): Promise<PlatformOverview> {
    return this.admin.overview(principal);
  }

  @Get('workspaces')
  workspaces(@Principal() principal: RequestPrincipal): Promise<WorkspaceSummary[]> {
    return this.admin.workspaces(principal);
  }

  @Patch('workspaces/:workspaceId/subscription')
  setSubscription(
    @Principal() principal: RequestPrincipal,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body(new ZodValidationPipe(setSubscriptionSchema)) body: SetSubscriptionInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<WorkspaceSummary> {
    return this.admin.setSubscription(
      principal,
      workspaceId,
      body,
      request.id ? String(request.id) : undefined,
    );
  }
}
