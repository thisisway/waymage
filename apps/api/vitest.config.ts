import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // O Vitest transforma com esbuild, que não implementa `emitDecoratorMetadata`. Sem SWC,
  // a injeção de dependência do NestJS recebe `undefined` e o app não sobe no teste — a
  // mesma armadilha registrada em docs/DECISIONS.md D-015.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Os testes de integração compartilham o mesmo banco: rodar arquivos em paralelo
    // criaria corrida entre os dados de cada um.
    fileParallelism: false,
    // scrypt é lento de propósito, e cada registro de usuário no teste o executa.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
