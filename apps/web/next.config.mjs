import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// O .env vive na raiz do monorepo: um arquivo para os três processos. O Next lê o .env do
// próprio app, então carregamos o da raiz aqui, antes de qualquer avaliação de config.
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Packages do workspace são TypeScript compilado para CJS; o Next precisa transpilá-los.
  transpilePackages: ['@waymage/scene-spec'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333',
  },
};
