import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import { WorkspaceRole } from '@waymage/database';
import { CREDENTIAL_PROVIDERS, type CredentialProvider } from '@waymage/provider-sdk';
import { Public, RequireRole } from '../auth/auth.guard';
import { Principal, type AuthenticatedRequest, type RequestPrincipal } from '../auth/request-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { saveCredentialSchema, type SaveCredentialInput } from './credentials.schemas';
import { CredentialsService, type CredentialView } from './credentials.service';

/**
 * Chaves de API do próprio usuário.
 *
 * Não existe rota que devolva o valor de uma chave. Nem para quem a cadastrou, nem para o
 * dono do workspace — é a única garantia real de que ela não vaza por uma tela, um log de
 * requisição ou um cache de browser.
 *
 * Só `ADMIN`: a chave é a conta de nuvem de quem paga, e quem gera imagem não precisa dela
 * para gerar.
 */
@Controller()
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  /** Catálogo de provedores. Público porque é informação de produto, não de workspace. */
  @Get('provider-catalog')
  @Public()
  catalog(): readonly CredentialProvider[] {
    return CREDENTIAL_PROVIDERS;
  }

  @Get('provider-credentials')
  @RequireRole(WorkspaceRole.ADMIN)
  list(@Principal() principal: RequestPrincipal): Promise<CredentialView[]> {
    return this.credentials.list(principal);
  }

  @Put('provider-credentials/:provider')
  @RequireRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  save(
    @Principal() principal: RequestPrincipal,
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(saveCredentialSchema)) body: SaveCredentialInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<CredentialView> {
    return this.credentials.save(principal, provider, body.secret, requestId(request));
  }

  @Delete('provider-credentials/:provider')
  @RequireRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Principal() principal: RequestPrincipal,
    @Param('provider') provider: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.credentials.revoke(principal, provider, requestId(request));
  }
}

function requestId(request: AuthenticatedRequest): string | undefined {
  return request.id ? String(request.id) : undefined;
}
