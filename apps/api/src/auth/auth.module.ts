import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.register({ secret: env.JWT_ACCESS_SECRET })],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Guard global: endpoint novo nasce protegido; abrir exige `@Public()` explícito.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
