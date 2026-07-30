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
import { inviteMemberSchema, type InviteMemberInput } from '../auth/auth.schemas';
import {
  CurrentUser,
  Principal,
  type AuthenticatedRequest,
  type RequestPrincipal,
} from '../auth/request-user';
import type { AuthenticatedUser } from '../auth/auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WorkspacesService, type MemberView, type WorkspaceView } from './workspaces.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<WorkspaceView[]> {
    return this.workspaces.listForUser(user.id);
  }

  @Get('current')
  current(@Principal() principal: RequestPrincipal): Promise<WorkspaceView> {
    return this.workspaces.current(principal);
  }

  @Get('current/members')
  members(@Principal() principal: RequestPrincipal): Promise<MemberView[]> {
    return this.workspaces.listMembers(principal);
  }

  @Post('current/members')
  @RequireRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  addMember(
    @Principal() principal: RequestPrincipal,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMemberInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<MemberView> {
    return this.workspaces.addMember(principal, body, requestId(request));
  }

  @Delete('current/members/:memberId')
  @RequireRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @Principal() principal: RequestPrincipal,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.workspaces.removeMember(principal, memberId, requestId(request));
  }
}

function requestId(request: AuthenticatedRequest): string | undefined {
  return request.id ? String(request.id) : undefined;
}
