import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { StorageService } from '@waymage/storage';
import { env } from '../config/env';

/** Adapta o StorageService compartilhado ao ciclo de vida do Nest. */
@Injectable()
export class AppStorageService extends StorageService implements OnModuleDestroy {
  constructor() {
    super({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  onModuleDestroy(): void {
    this.destroy();
  }
}
