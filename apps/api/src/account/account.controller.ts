import { Body, Controller, Delete, HttpCode, HttpStatus, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { clearOptions, COOKIE } from '../auth/cookies';
import { Principal, type AuthenticatedRequest, type RequestPrincipal } from '../auth/request-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccountService } from './account.service';

const deleteAccountSchema = z.object({
  /** Confirmação por senha: sessão aberta não basta para destruir o trabalho de alguém. */
  password: z.string().min(1),
});

type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

@Controller()
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Principal() principal: RequestPrincipal,
    @Body(new ZodValidationPipe(deleteAccountSchema)) body: DeleteAccountInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.account.deleteAccount(
      principal,
      body.password,
      request.id ? String(request.id) : undefined,
    );

    // Os cookies saem junto: deixar a sessão de pé apontaria para uma conta que não existe
    // mais, e o próximo request voltaria 401 sem explicar por quê.
    void reply
      .setCookie(COOKIE.access, '', clearOptions.access)
      .setCookie(COOKIE.refresh, '', clearOptions.refresh)
      .setCookie(COOKIE.csrf, '', clearOptions.csrf);
  }
}
