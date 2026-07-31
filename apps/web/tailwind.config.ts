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
        /** Rampa de elevação derivada da Way Dark, preservando o matiz azulado. */
        surface: {
          base: '#0B1023',
          raised: '#10162E',
          overlay: '#161D3B',
          hover: '#1D2649',
          border: '#232C52',
        },
        ink: {
          primary: '#F2F5FF',
          secondary: '#A8B2CF',
          muted: '#6B769B',
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
        xs: '0 1px 3px rgba(11,16,35,.08)',
        sm: '0 2px 8px rgba(11,16,35,.10)',
        md: '0 4px 16px rgba(11,16,35,.12)',
        lg: '0 8px 32px rgba(11,16,35,.15)',
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
