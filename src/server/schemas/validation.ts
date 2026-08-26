import { z } from "zod";

// --- Auth ---------------------------------------------------------------

export const clientForgotPasswordSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido."),
});

export const clientResetPasswordSchema = z.object({
  token: z.string().min(1, "Token é obrigatório."),
  newPassword: z.string().min(6, "A senha precisa ter ao menos 6 caracteres."),
});

export const clientLoginSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido."),
  password: z.string().min(1, "Senha é obrigatória."),
});

export const accountantLoginSchema = z.object({
  username: z.string().min(1, "Usuário é obrigatório."),
  password: z.string().min(1, "Senha é obrigatória."),
});

// --- Webhooks -------------------------------------------------------------

export const webhookReceitasSchema = z.object({
  hash_empresa: z.string().min(1, "hash_empresa é obrigatório."),
  vencimento: z.string().optional().nullable(),
  competencia: z.string().optional().nullable(),
  categoria: z.string().optional().nullable(),
  nome_arquivo: z.string().optional().nullable(),
  arquivo_base64: z.string().optional().nullable(),
  dados_extraidos: z.any().optional().nullable(),
});
