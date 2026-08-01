import { HttpStatus, Injectable } from '@nestjs/common';
import { sealSecret, secretHint } from '@waymage/domain';
import { credentialProvider } from '@waymage/provider-sdk';
import { AuditService } from '../audit/audit.service';
import type { RequestPrincipal } from '../auth/request-user';
import { AppError } from '../common/app-error';
import { env } from '../config/env';
import { PrismaService } from '../infra/prisma.service';

/**
 * Chaves de API trazidas pelo usuário (BYOK).
 *
 * A regra que organiza este serviço inteiro: **o valor entra e nunca mais sai**. Não há
 * endpoint que devolva a chave, nem para quem a cadastrou. O que a tela recebe são os quatro
 * últimos caracteres, o bastante para reconhecer qual é sem ajudar quem a roubasse.
 *
 * A chave é acesso à conta de nuvem do cliente. Tudo aqui parte disso.
 */

export interface CredentialView {
  provider: string;
  /** Últimos quatro caracteres. Vazio quando a chave é curta demais para revelar parte dela. */
  hint: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: RequestPrincipal): Promise<CredentialView[]> {
    const credentials = await this.prisma.providerCredential.findMany({
      where: { workspaceId: principal.workspaceId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      // `secretSealed` fora do select de propósito: o valor cifrado não tem por que trafegar
      // até aqui, e o que não é carregado não vaza por engano num log de erro.
      select: { provider: true, secretHint: true, createdAt: true, lastUsedAt: true },
    });

    return credentials.map((credential) => ({
      provider: credential.provider,
      hint: credential.secretHint,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
    }));
  }

  /**
   * Cadastra ou substitui a chave de um provedor.
   *
   * Substituir revoga a anterior em vez de sobrescrevê-la: o registro de quem cadastrou o quê
   * e quando sobrevive à troca, e é ele que responde "desde quando esta chave está em uso"
   * quando alguém precisar investigar uma cobrança inesperada.
   */
  async save(
    principal: RequestPrincipal,
    provider: string,
    secret: string,
    requestId?: string,
  ): Promise<CredentialView> {
    const known = credentialProvider(provider);
    if (!known) {
      throw new AppError(
        'UNKNOWN_PROVIDER',
        `Provedor desconhecido: ${provider}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (known.keyPrefix && !secret.startsWith(known.keyPrefix)) {
      // Erra cedo, com mensagem útil. Não é autorização: prefixo certo não prova nada, e o
      // teste de verdade é o fornecedor aceitar a chave na primeira geração.
      throw new AppError(
        'INVALID_KEY_FORMAT',
        `A chave do ${known.label} começa com "${known.keyPrefix}". Confira se copiou a chave certa.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.providerCredential.updateMany({
        where: { workspaceId: principal.workspaceId, provider, revokedAt: null },
        data: { revokedAt: now },
      });

      return tx.providerCredential.create({
        data: {
          workspaceId: principal.workspaceId,
          provider,
          secretSealed: sealSecret(secret, env.CREDENTIALS_ENCRYPTION_KEY),
          secretHint: secretHint(secret),
          createdById: principal.user.id,
        },
        select: { provider: true, secretHint: true, createdAt: true, lastUsedAt: true },
      });
    });

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'credential.save',
      resourceType: 'ProviderCredential',
      resourceId: provider,
      // Nem a dica entra na auditoria: o registro precisa dizer que houve troca, não o que
      // foi trocado.
      metadata: { provider },
      ...(requestId ? { requestId } : {}),
    });

    return {
      provider: created.provider,
      hint: created.secretHint,
      createdAt: created.createdAt,
      lastUsedAt: created.lastUsedAt,
    };
  }

  /**
   * Revoga a chave.
   *
   * Marcação, não exclusão: apagar a linha levaria junto o histórico de que existiu uma chave
   * ali, e é exatamente esse histórico que explica gerações antigas.
   */
  async revoke(principal: RequestPrincipal, provider: string, requestId?: string): Promise<void> {
    const { count } = await this.prisma.providerCredential.updateMany({
      where: { workspaceId: principal.workspaceId, provider, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) throw AppError.notFound('Credencial');

    await this.audit.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.user.id,
      action: 'credential.revoke',
      resourceType: 'ProviderCredential',
      resourceId: provider,
      metadata: { provider },
      ...(requestId ? { requestId } : {}),
    });
  }
}
