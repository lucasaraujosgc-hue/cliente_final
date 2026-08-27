import { z } from "zod";

// --- Auth ---------------------------------------------------------------

export const clientForgotPasswordSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido."),
});

export const clientResetPasswordSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido."),
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

// --- Accountant panel ---------------------------------------------------

const uuid = z.string().uuid("ID inválido.");
const regularity = z.enum(["green", "warning", "red"]);

export const accountantCreateClientSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido."),
  name: z.string().min(1, "Nome é obrigatório."),
  regularityStatus: regularity.optional(),
  integrationHash: z.string().nullish(),
  accountantCategory: z.string().nullish(),
});

export const accountantUpdateClientSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório."),
  regularityStatus: regularity.optional(),
  integrationHash: z.string().nullish(),
  accountantCategory: z.string().nullish(),
});

export const accountantMessageSchema = z.object({
  clientId: uuid,
  content: z.string().min(1, "Mensagem vazia.").max(5000),
});

export const accountantBulkMessageSchema = z.object({
  clientIds: z.array(uuid).min(1, "Nenhum cliente selecionado."),
  content: z.string().min(1, "Mensagem vazia.").max(5000),
});

export const accountantEditMessageSchema = z.object({
  content: z.string().min(1, "Mensagem vazia.").max(5000),
});

const billingEntrySchema = z.object({
  month: z.string().min(1, "Competência é obrigatória."),
  servicesRevenue: z.number().nonnegative().optional(),
  salesRevenue: z.number().nonnegative().optional(),
  totalIncomes: z.number().nonnegative().optional(),
  servicesTaken: z.number().nonnegative().optional(),
});
export const billingUpdateSchema = billingEntrySchema;
export const billingBulkSchema = z.object({
  data: z.array(billingEntrySchema).min(1),
});

export const scheduledNotificationSchema = z.object({
  clientId: uuid.nullish(),
  type: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  scheduleDay: z.union([z.number(), z.string()]).nullish(),
  scheduleTime: z.string().nullish(),
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
