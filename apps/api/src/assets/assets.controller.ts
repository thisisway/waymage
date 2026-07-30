import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { WorkspaceRole } from '@waymage/database';
import { RequireRole } from '../auth/auth.guard';
import { Principal, type AuthenticatedRequest, type RequestPrincipal } from '../auth/request-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  completeUploadSchema,
  requestUploadSchema,
  type CompleteUploadInput,
  type RequestUploadInput,
} from './assets.schemas';
import { AssetsService, type AssetView, type UploadTicket } from './assets.service';

/**
 * Upload em três passos (blueprint §16): pedir URL assinada → enviar direto ao storage →
 * confirmar. O arquivo nunca passa pela API.
 */
@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post('assets/upload-url')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  requestUpload(
    @Principal() principal: RequestPrincipal,
    @Body(new ZodValidationPipe(requestUploadSchema)) body: RequestUploadInput,
  ): Promise<UploadTicket> {
    return this.assets.requestUpload(principal, body);
  }

  @Post('assets/complete')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  complete(
    @Principal() principal: RequestPrincipal,
    @Body(new ZodValidationPipe(completeUploadSchema)) body: CompleteUploadInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<AssetView> {
    return this.assets.completeUpload(principal, body.assetId, requestId(request));
  }

  @Get('projects/:projectId/assets')
  list(
    @Principal() principal: RequestPrincipal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<AssetView[]> {
    return this.assets.list(principal, projectId);
  }

  @Get('assets/:assetId')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<AssetView> {
    return this.assets.get(principal, assetId);
  }

  @Delete('assets/:assetId')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.assets.remove(principal, assetId, requestId(request));
  }
}

function requestId(request: AuthenticatedRequest): string | undefined {
  return request.id ? String(request.id) : undefined;
}
