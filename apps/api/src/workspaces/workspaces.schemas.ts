import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(320),
  // OWNER fora da lista: transferir propriedade é outra operação, com outras regras.
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
