import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { QueryProvider } from '../components/query-provider';
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

export const metadata: Metadata = {
  title: 'Waymage',
  description: 'Direção criativa de imagens com IA, orientada a cenas.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <body className="min-h-screen font-sans">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
