import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService, type AuthenticatedUser, type SessionTokens } from './auth.service';
import { NoCsrf, Public } from './auth.guard';
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from './auth.schemas';
import {
  accessCookieOptions,
  clearOptions,
  COOKIE,
  csrfCookieOptions,
  refreshCookieOptions,
} from './cookies';
import { CurrentUser, type AuthenticatedRequest } from './request-user';

interface SessionResponse {
  user: AuthenticatedUser;
  /**
   * O token CSRF, tambem no corpo.
   *
   * O cookie `wm_csrf` e legivel por JavaScript, mas so pelo JavaScript do MESMO host. Em
   * producao a API e o frontend vivem em subdominios diferentes, e `document.cookie` da
   * pagina nao enxerga o cookie da API — a pagina recebe e devolve o cookie normalmente, mas
   * nao consegue LER o valor para espelhar no header.
   *
   * Devolver aqui resolve sem afrouxar nada: o CORS so autoriza a nossa origem a ler esta
   * resposta, entao continua valendo que apenas a nossa pagina conhece o token. E a
   * verificacao no servidor segue sendo cookie contra header.
   */
  csrfToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Sem CSRF: quem se cadastra ainda não tem cookie algum. A autorização é o corpo.
  @Public()
  @NoCsrf()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { user, tokens } = await this.auth.register(body, context(request));
    setSessionCookies(reply, tokens);
    return { user, csrfToken: tokens.csrfToken };
  }

  @Public()
  @NoCsrf()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { user, tokens } = await this.auth.login(body, context(request));
    setSessionCookies(reply, tokens);
    return { user, csrfToken: tokens.csrfToken };
  }

  /**
   * Público porque quem chama ainda não tem access token válido — é justamente o que vem
   * buscar. A autorização vem do refresh token no cookie, validado no service.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const token = request.cookies?.[COOKIE.refresh] ?? '';
    const { user, tokens } = await this.auth.refresh(token, context(request));
    setSessionCookies(reply, tokens);
    return { user, csrfToken: tokens.csrfToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(request.cookies?.[COOKIE.refresh], context(request));
    clearSessionCookies(reply);
  }

  /**
   * Sessao atual, e o token CSRF junto.
   *
   * O token sai do proprio cookie da requisicao: o browser o envia mesmo sem conseguir le-lo,
   * entao esta rota e o caminho pelo qual a pagina recupera o valor depois de um recarregamento.
   */
  @Get('me')
  me(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ): SessionResponse {
    return { user, csrfToken: request.cookies?.[COOKIE.csrf] ?? '' };
  }
}

function setSessionCookies(reply: FastifyReply, tokens: SessionTokens): void {
  void reply
    .setCookie(COOKIE.access, tokens.accessToken, accessCookieOptions)
    .setCookie(COOKIE.refresh, tokens.refreshToken, refreshCookieOptions)
    .setCookie(COOKIE.csrf, tokens.csrfToken, csrfCookieOptions);
}

function clearSessionCookies(reply: FastifyReply): void {
  void reply
    .setCookie(COOKIE.access, '', clearOptions.access)
    .setCookie(COOKIE.refresh, '', clearOptions.refresh)
    .setCookie(COOKIE.csrf, '', clearOptions.csrf);
}

/** Contexto de auditoria. Só IP e requestId — nada que identifique conteúdo da requisição. */
function context(request: AuthenticatedRequest): { ipAddress?: string; requestId?: string } {
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(request.id ? { requestId: String(request.id) } : {}),
  };
}
