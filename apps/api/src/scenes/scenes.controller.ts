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
import { Principal, type AuthenticatedRequest, type RequestPrincipal } from '../auth/request-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  autosaveSceneSchema,
  createSceneSchema,
  createVersionSchema,
  type AutosaveSceneInput,
  type CreateSceneInput,
  type CreateVersionInput,
} from './scenes.schemas';
import {
  ScenesService,
  type SceneSummary,
  type SceneView,
  type SceneVersionDetail,
  type SceneVersionView,
} from './scenes.service';

@Controller()
export class ScenesController {
  constructor(private readonly scenes: ScenesService) {}

  @Get('projects/:projectId/scenes')
  list(
    @Principal() principal: RequestPrincipal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<SceneSummary[]> {
    return this.scenes.list(principal, projectId);
  }

  @Post('projects/:projectId/scenes')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Principal() principal: RequestPrincipal,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(createSceneSchema)) body: CreateSceneInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<SceneView> {
    return this.scenes.create(principal, projectId, body, requestId(request));
  }

  @Get('scenes/:sceneId')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ): Promise<SceneView> {
    return this.scenes.get(principal, sceneId);
  }

  /** Autosave. Responde 409 quando a cena mudou desde a leitura do cliente. */
  @Patch('scenes/:sceneId')
  @RequireRole(WorkspaceRole.MEMBER)
  autosave(
    @Principal() principal: RequestPrincipal,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body(new ZodValidationPipe(autosaveSceneSchema)) body: AutosaveSceneInput,
  ): Promise<SceneView> {
    return this.scenes.autosave(principal, sceneId, body);
  }

  @Delete('scenes/:sceneId')
  @RequireRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.scenes.remove(principal, sceneId, requestId(request));
  }

  @Post('scenes/:sceneId/versions')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.CREATED)
  createVersion(
    @Principal() principal: RequestPrincipal,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body(new ZodValidationPipe(createVersionSchema)) body: CreateVersionInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<SceneVersionDetail> {
    return this.scenes.createVersion(principal, sceneId, body, requestId(request));
  }

  @Get('scenes/:sceneId/versions')
  listVersions(
    @Principal() principal: RequestPrincipal,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ): Promise<SceneVersionView[]> {
    return this.scenes.listVersions(principal, sceneId);
  }

  @Get('scene-versions/:versionId')
  getVersion(
    @Principal() principal: RequestPrincipal,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<SceneVersionDetail> {
    return this.scenes.getVersion(principal, versionId);
  }

  @Post('scene-versions/:versionId/duplicate')
  @RequireRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.CREATED)
  duplicateVersion(
    @Principal() principal: RequestPrincipal,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SceneView> {
    return this.scenes.duplicateVersion(principal, versionId, requestId(request));
  }
}

function requestId(request: AuthenticatedRequest): string | undefined {
  return request.id ? String(request.id) : undefined;
}
