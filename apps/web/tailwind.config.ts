import type { Config } from 'tailwindcss';

/**
 * Identidade visual própria: superfícies escuras e neutras, uma cor de acento quente.
 * A intenção é uma ferramenta criativa — o conteúdo é a imagem, a interface recua.
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          base: '#0d0e12',
          raised: '#15171d',
          overlay: '#1c1f27',
          hover: '#232733',
          border: '#282c37',
        },
        ink: {
          primary: '#e9eaee',
          secondary: '#9aa0ae',
          muted: '#646b7c',
        },
        accent: {
          DEFAULT: '#d97757',
          soft: '#f0a58a',
          dim: '#7a3f2a',
        },
        state: {
          ok: '#4ba97a',
          warn: '#d9a441',
          error: '#d95757',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Cascadia Code', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
