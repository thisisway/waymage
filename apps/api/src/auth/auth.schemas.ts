import { z } from 'zod';

/** Schemas de borda dos endpoints de autenticação (D-010). */

/**
 * Senha: mínimo 12 caracteres, sem exigência de "um símbolo e um número".
 *
 * Regras de composição empurram o usuário para `Senha@123` — pior do que uma frase longa.
 * NIST 800-63B recomenda comprimento e nada de regra de composição.
 */
const password = z
  .string()
  .min(12, 'A senha precisa de ao menos 12 caracteres.')
  .max(200, 'A senha é longa demais.');

const email = z.string().trim().toLowerCase().email('E-mail inválido.').max(320);

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Informe seu nome.').max(120),
  email,
  password,
  /** Nome do workspace criado junto com a conta. */
  workspaceName: z.string().trim().min(1).max(120).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const inviteMemberSchema = z.object({
  email,
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
