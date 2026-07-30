import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Adapter de object storage.
 *
 * Uma única implementação sobre a API do S3, apontada ao MinIO em desenvolvimento — não há
 * caminho separado para dev (docs/DECISIONS.md D-007). O bucket é privado: nada aqui devolve
 * URL pública, só URL assinada de expiração curta.
 */

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** true para MinIO (path-style), false para AWS S3. */
  forcePathStyle: boolean;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /** Metadados não sensíveis. Nunca colocar dado pessoal aqui. */
  metadata?: Record<string, string>;
}

/** Expirações curtas por padrão — URL assinada vazada tem janela mínima de uso. */
export const SIGNED_URL_TTL = {
  upload: 5 * 60,
  read: 15 * 60,
} as const;

export class StorageService {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /** Verificação de dependência usada pelo /health. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async put({ key, body, contentType, metadata }: PutObjectInput): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(metadata ? { Metadata: metadata } : {}),
      }),
    );
    return key;
  }

  /**
   * Baixa o objeto inteiro para a memória.
   *
   * Usado para validar o conteúdo de um upload (assinatura de bytes, hash, tamanho real).
   * Só é seguro porque o teto de upload é pequeno — para arquivo grande, o certo é ler em
   * streaming e não segurar tudo na memória do processo.
   */
  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Objeto vazio: ${key}`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  /** URL de leitura temporária. É a única forma de servir um asset ao browser. */
  async signedReadUrl(key: string, expiresIn: number = SIGNED_URL_TTL.read): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn,
    });
  }

  /**
   * URL de upload direto. O `contentType` é assinado junto: o cliente não pode subir um
   * tipo diferente do declarado — a validação real por magic bytes ainda acontece no
   * `POST /assets/complete`.
   */
  async signedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = SIGNED_URL_TTL.upload,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  destroy(): void {
    this.client.destroy();
  }
}
