import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // D-001: `any` proibido fora de wrapper isolado de SDK externo.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/vitest.config.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // NestJS resolve dependências por `emitDecoratorMetadata`, que precisa do import como
    // VALOR em runtime. Trocar por `import type` apaga o design:paramtypes e a injeção passa
    // a receber undefined — falha silenciosa no boot. A regra é de estilo; o DI não é.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
);
