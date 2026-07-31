import type { Config } from 'tailwindcss';

/**
 * Way Cloud Design System v1.0 traduzido para Tailwind.
 *
 * Os tokens do DS entram como fonte única: cor primária, escala tipográfica, raios e sombras.
 * As superfícies intermediárias do modo escuro foram derivadas de `#0B1023` porque o DS não
 * as especifica — ver docs/DECISIONS.md D-044.
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Superfícies em cinza NEUTRO, não na Way Dark.
         *
         * É uma ferramenta de trabalho com imagem: qualquer dominante de cor no fundo
         * contamina a percepção do que está sendo produzido — um fundo azulado faz a imagem
         * gerada parecer mais quente do que é. Figma, Lightroom e DaVinci usam cinza neutro
         * pela mesma razão. Ver docs/DECISIONS.md D-046.
         *
         * O ganho é duplo: sobre cinza, o Way Blue destaca de verdade; sobre navy, ele se
         * dissolvia no fundo.
         */
        surface: {
          base: '#171717',
          raised: '#1E1E1E',
          overlay: '#262626',
          hover: '#303030',
          border: '#2E2E2E',
        },
        ink: {
          primary: '#F5F5F5',
          secondary: '#B4B4B4',
          muted: '#7A7A7A',
        },
        /** Way Blue e sua rampa, direto do DS. */
        accent: {
          DEFAULT: '#1D66FF',
          10: '#E8F0FF',
          20: '#C2D5FF',
          40: '#7FABFF',
          80: '#1349C0',
        },
        state: {
          ok: '#17C86A',
          warn: '#FFB800',
          error: '#FF3B30',
        },
      },

      fontFamily: {
        sans: ['var(--font-jakarta)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Cascadia Code', 'monospace'],
      },

      /** Escala tipográfica do DS, com peso e tracking já embutidos. */
      fontSize: {
        display: ['48px', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '800' }],
        h1: ['32px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '800' }],
        h2: ['24px', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '700' }],
        h3: ['18px', { lineHeight: '1.4', fontWeight: '700' }],
        body: ['15px', { lineHeight: '1.6', fontWeight: '400' }],
        label: ['12px', { lineHeight: '1.4', letterSpacing: '0.06em', fontWeight: '700' }],
        code: ['13px', { lineHeight: '1.5' }],
        micro: ['11px', { lineHeight: '1.4' }],
      },

      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        pill: '999px',
      },

      boxShadow: {
        // Sombras em preto neutro: com o fundo cinza, a sombra azulada do DS deixava um
        // halo colorido em volta de cada cartão.
        xs: '0 1px 3px rgba(0,0,0,.30)',
        sm: '0 2px 8px rgba(0,0,0,.35)',
        md: '0 4px 16px rgba(0,0,0,.40)',
        lg: '0 8px 32px rgba(0,0,0,.45)',
        /** Destaque do DS: reservado para o que está ativo ou em foco. */
        glow: '0 16px 48px rgba(29,102,255,.20)',
        'glow-sm': '0 4px 16px rgba(29,102,255,.25)',
      },

      /** Escala 8pt do DS. */
      spacing: {
        '0.5': '2px',
        '1': '4px',
        '1.5': '6px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
      },

      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
      },

      transitionDuration: {
        instant: '120ms',
        fast: '200ms',
        base: '320ms',
        slow: '520ms',
      },
    },
  },
  plugins: [],
} satisfies Config;
