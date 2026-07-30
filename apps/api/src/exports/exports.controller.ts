import {
  Body,
  Controller,
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
import { createExportSchema, type CreateExportInput } from './exports.schemas';
import { ExportsService, type ExportJobView } from './exports.service';

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post()
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Principal() principal: RequestPrincipal,
    @Body(new ZodValidationPipe(createExportSchema)) body: CreateExportInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<ExportJobView> {
    return this.exports.create(principal, body, requestId(request));
  }

  @Get()
  list(@Principal() principal: RequestPrincipal): Promise<ExportJobView[]> {
    return this.exports.list(principal);
  }

  @Get(':exportId')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('exportId', ParseUUIDPipe) exportId: string,
  ): Promise<ExportJobView> {
    return this.exports.get(principal, exportId);
  }
}

function requestId(request: AuthenticatedRequest): string | undefined {
  return request.id ? String(request.id) : undefined;
}
