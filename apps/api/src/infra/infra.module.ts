import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { AppStorageService } from './storage.service';

/**
 * Dependências de infraestrutura, disponíveis a todos os módulos.
 *
 * Global porque quase todo módulo de domínio precisa do Prisma, e propagar imports de
 * infraestrutura por toda a árvore só adiciona ruído.
 */
@Global()
@Module({
  providers: [PrismaService, RedisService, AppStorageService],
  exports: [PrismaService, RedisService, AppStorageService],
})
export class InfraModule {}
