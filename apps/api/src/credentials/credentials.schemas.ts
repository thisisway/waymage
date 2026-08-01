import { z } from 'zod';

export const saveCredentialSchema = z.object({
  /**
   * Sem `.trim()` no valor por acidente: copiar chave de painel costuma trazer espaço, e
   * espaço no meio de um header de autorização quebra a requisição no fornecedor com um erro
   * que não diz nada. Aparar as bordas é correção; mexer no meio seria adivinhação.
   */
  secret: z.string().trim().min(8, 'Chave curta demais.').max(500),
});

export type SaveCredentialInput = z.infer<typeof saveCredentialSchema>;
