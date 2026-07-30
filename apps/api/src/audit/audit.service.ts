import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';

export interface AuditEntry {
  workspaceId?: string;
  actorUserId?: string;
  /** Verbo estável, `recurso.acao` (ex.: `project.create`). Nunca traduzir. */
  action: string;
  resourceType: string;
  resourceId?: string;
  /** Metadados NÃO sensíveis. Nunca senha, token, cookie ou URL assinada. */
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Trilha de auditoria append-only.
 *
 * Falha de auditoria **não** derruba a operação: se o insert do log quebrar, o usuário não
 * deve perder o projeto que acabou de criar. O erro vai para o log da aplicação, onde o
 * monitoramento enxerga. A troca é deliberada — auditoria aqui é para investigação, não é
 * controle de acesso.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          workspaceId: entry.workspaceId ?? null,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          metadata: (entry.metadata ?? {}) as object,
          ipAddress: entry.ipAddress ?? null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (error) {
      this.logger.error({ action: entry.action, err: error }, 'Falha ao gravar auditoria');
    }
  }
}
