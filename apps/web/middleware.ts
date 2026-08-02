import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cabeçalhos de segurança, com CSP por nonce.
 *
 * A CSP é a única defesa que sobra quando um XSS acontece: os cookies de sessão são
 * `httpOnly`, então o script injetado não os lê, mas ele ainda pode agir em nome do usuário
 * enquanto a página está aberta. Uma política que só aceite scripts nossos fecha isso.
 *
 * **Nonce, e não `'unsafe-inline'`.** Uma CSP que aceita qualquer script inline não protege de
 * nada — é o próprio ataque que ela deveria barrar. O nonce é sorteado por resposta, entra no
 * cabeçalho e nas tags que geramos, e o Next o aplica sozinho aos scripts dele quando encontra
 * uma CSP com nonce.
 *
 * Isso exige renderização por requisição, que este app já faz ([D-068](../../docs/DECISIONS.md)) —
 * o mesmo `force-dynamic` que faz a URL da API ser lida em runtime.
 */

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  /**
   * `connect-src` precisa conhecer a API, que vive noutra origem.
   *
   * Lida do ambiente pela mesma razão que a URL do cliente: em produção ela é injetada no
   * container, e uma política fixa aqui bloquearia toda chamada assim que o domínio mudasse.
   */
  const apiOrigin = originOf(process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL);

  const policy = [
    "default-src 'self'",
    // `strict-dynamic` deixa um script autorizado carregar os seus, que é como o Next monta
    // a página. Sem isso, cada chunk precisaria de nonce próprio.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Estilo inline continua liberado: o Next e o `next/font` injetam `<style>` sem nonce, e
    // CSS injetado não executa código — o risco é ordens de grandeza menor que o de script.
    "style-src 'self' 'unsafe-inline'",
    // `blob:` é o editor de máscara, que desenha em canvas; `data:` são ícones embutidos.
    // `https:` cobre as URLs assinadas do storage, cujo host varia com a conta.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    // Nada de plugin, e nada de nos colocarem dentro de um iframe: clickjacking sobre um
    // editor é um clique roubado em "Gerar".
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  const headers = new Headers(request.headers);
  // O layout lê daqui para pôr o nonce na tag de configuração que ele injeta.
  headers.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers } });

  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Recursos que este produto nunca usa. Negar é mais barato do que auditar depois.
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
}

/** Só a origem: a CSP compara esquema e host, e um caminho na diretiva a invalidaria. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const config = {
  /**
   * Tudo, menos o que o próprio Next serve.
   *
   * Arquivos estáticos não executam script e não precisam de política — passá-los pelo
   * middleware custaria uma execução por recurso, em toda navegação.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
