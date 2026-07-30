import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global: praticamente todo módulo de escrita audita. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
