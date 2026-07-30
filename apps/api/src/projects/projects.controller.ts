import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { WorkspaceRole } from '@waymage/database';
import { RequireRole } from '../auth/auth.guard';
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '../auth/auth.schemas';
import { Principal, type AuthenticatedRequest, type RequestPrincipal } from '../auth/request-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProjectsService, type ProjectView } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Principal() principal: RequestPrincipal): Promise<ProjectView[]> {
    return this.projects.list(principal);
  }

  @Get(':projectId')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectView> {
    return this.projects.get(principal, projectId);
  }

  @Post()
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Principal() principal: RequestPrincipal,
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProjectView> {
    return this.projects.create(principal, body, requestId(request));
  }

  @Patch(':projectId')
  @RequireRole(WorkspaceRole.MEMBER)
  update(
    @Principal() principal: RequestPrincipal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProjectView> {
    return this.projects.update(principal, projectId, body, requestId(request));
  }

  /** Apagar projeto leva junto cenas e gerações: exige ADMIN, não MEMBER. */
  @Delete(':projectId')
  @RequireRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.projects.remove(principal, projectId, requestId(request));
  }
}

function requestId(request: AuthenticatedRequest): string | undefined {
  return request.id ? String(request.id) : undefined;
}
