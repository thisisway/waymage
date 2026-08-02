import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { QueryProvider } from '../components/query-provider';
import { ToastViewport } from '../components/ui/toast';
import './globals.css';

/**
 * Plus Jakarta Sans, a fonte do Way Cloud Design System.
 *
 * Via `next/font` e não `<link>` para o Google Fonts: os arquivos são baixados no build e
 * servidos do nosso domínio. Isso elimina uma requisição a terceiro no carregamento, evita o
 * salto de layout da troca de fonte, e mantém a CSP fechada — sem `font-src` externo.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

/**
 * Renderização por requisição, e não no build.
 *
 * Sem isto o Next pré-renderiza as páginas e o layout roda UMA vez, durante o build — o que
 * congelaria a URL da API na imagem e anularia toda a leitura em runtime abaixo.
 *
 * O custo é baixo aqui: toda tela deste app já busca os dados no cliente, então a versão
 * estática nunca continha conteúdo real, só o esqueleto.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Waymage',
  description: 'Direção criativa de imagens com IA, orientada a cenas.',
};

/**
 * Configuração lida em runtime, não embutida no bundle.
 *
 * `NEXT_PUBLIC_*` é substituída textualmente durante o build, então a URL da API ficaria
 * congelada na imagem e trocar de ambiente exigiria rebuildar o frontend. Pior: plataformas
 * que só injetam variáveis no container em execução — o EasyPanel entre elas — não têm como
 * fornecê-la, e o app sai apontando para `localhost`.
 *
 * O layout é Server Component, então `process.env` aqui é lido a cada resposta. O valor
 * desce numa tag `<script>` e o cliente o consome em `apiUrl()`.
 *
 * `API_URL` sem o prefixo de propósito: com `NEXT_PUBLIC_` o Next substituiria esta leitura
 * também, e voltaríamos ao valor de build.
 */
function runtimeConfig(): string {
  const url = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';
  // A URL vem da nossa configuração, não do usuário — mas escapar `<` custa nada e fecha a
  // porta de um `</script>` acidental encerrar a tag no meio.
  return `window.__WAYMAGE_API_URL__=${JSON.stringify(url).replace(/</g, '\\u003c')}`;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // O nonce vem do middleware, que também escreveu a CSP desta resposta. Sem ele a tag abaixo
  // é bloqueada pelo browser — e o app sai apontando para `localhost`.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <head>
        {/* Antes de qualquer bundle: quando o código do cliente rodar, o valor já existe. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: runtimeConfig() }} />
      </head>
      <body className="min-h-screen font-sans">
        <QueryProvider>
          {children}
          <ToastViewport />
        </QueryProvider>
      </body>
    </html>
  );
}
