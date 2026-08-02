import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { WorkspaceRole } from '@waymage/database';
import { verifyPassword } from '../auth/password';
import type { RequestPrincipal } from '../auth/request-user';
import { AppError } from '../common/app-error';
import { PrismaService } from '../infra/prisma.service';
import { AppStorageService } from '../infra/storage.service';

/**
 * Exclusão de conta.
 *
 * Existe porque o produto guarda duas coisas que não são nossas: **imagens que podem ser de
 * pessoas reais** e **chaves de API de terceiros**. Manter isso depois de alguém pedir para
 * sair não é descuido de produto, é reter dado sem base para reter.
 *
 * Apaga de verdade — os bytes no storage e as linhas no banco. Nada de `deletedAt` aqui: o
 * apagado lógico é útil para desfazer um clique errado, e é exatamente o que não pode
 * acontecer com um pedido de exclusão.
 */

export interface DeletionReport {
  /** Quantos objetos saíram do storage. Vai para o log, não para o usuário. */
  objectsRemoved: number;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AppStorageService,
  ) {}

  /**
   * Apaga o workspace e a conta.
   *
   * **Exige a senha**, mesmo com sessão válida. Uma sessão aberta num computador emprestado
   * não deveria bastar para destruir o trabalho de alguém, e é o mesmo motivo por que bancos
   * pedem a senha de novo antes de uma transferência.
   *
   * Só o dono. Um `ADMIN` convidado administra o workspace; encerrá-lo é decisão de quem o
   * criou.
   */
  async deleteAccount(
    principal: RequestPrincipal,
    password: string,
    requestId?: string,
  ): Promise<DeletionReport> {
    if (principal.role !== WorkspaceRole.OWNER) {
      throw new AppError(
        'NOT_WORKSPACE_OWNER',
        'Apenas o dono do workspace pode excluí-lo.',
        HttpStatus.FORBIDDEN,
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.user.id },
      select: { id: true, passwordHash: true },
    });

    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new AppError('INVALID_PASSWORD', 'Senha incorreta.', HttpStatus.FORBIDDEN);
    }

    /**
     * Os bytes primeiro, as linhas depois.
     *
     * Se a ordem fosse inversa e o storage falhasse no meio, ficariam arquivos órfãos sem
     * nenhuma linha apontando para eles — invisíveis, e por isso permanentes. Falhando nesta
     * ordem, a conta continua existindo e o pedido pode ser repetido.
     */
    const objectsRemoved = await this.storage.deletePrefix(`workspaces/${principal.workspaceId}/`);

    await this.prisma.$transaction(async (tx) => {
      // O workspace leva junto projetos, cenas, assets, gerações e credenciais, por cascata
      // declarada no schema. As chaves de API somem com ele.
      await tx.workspace.delete({ where: { id: principal.workspaceId } });

      // O usuário só sai se não pertencer a mais nenhum workspace: quem foi convidado para o
      // de outra pessoa continua existindo lá.
      const remaining = await tx.workspaceMember.count({ where: { userId: user.id } });
      if (remaining === 0) await tx.user.delete({ where: { id: user.id } });
    });

    /**
     * O registro da exclusão fica fora do banco, no log.
     *
     * Gravá-lo numa tabela exigiria uma linha que sobrevive ao workspace — e uma tabela de
     * auditoria que guarda quem pediu para ser esquecido é o oposto do que ela deveria fazer.
     */
    this.logger.log(
      { workspaceId: principal.workspaceId, objectsRemoved, requestId },
      'Conta excluída a pedido do titular',
    );

    return { objectsRemoved };
  }
}
