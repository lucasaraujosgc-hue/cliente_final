import { z } from "zod";

// --- Auth ---------------------------------------------------------------

export const clientForgotPasswordSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido.").max(20),
});

export const clientResetPasswordSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido.").max(20),
  code: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().regex(/^\d{6}$/, "Código inválido.")),
  newPassword: z.string().min(8, "A senha precisa ter ao menos 8 caracteres.").max(200),
});

export const clientLoginSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido."),
  password: z.string().min(1, "Senha é obrigatória."),
});

export const accountantLoginSchema = z.object({
  username: z.string().min(1, "Usuário é obrigatório."),
  password: z.string().min(1, "Senha é obrigatória."),
});

export const accountantMfaVerifySchema = z.object({
  challengeId: z.string().min(1).max(80),
  code: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().regex(/^\d{6}$/, "Código inválido.")),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken é obrigatório.").max(200),
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

// Multipart text fields arrive as strings; "" means "not provided".
const optStr = (max = 300) => z.string().max(max).optional();

export const accountantUploadDocSchema = z.object({
  clientId: uuid,
  title: z.string().min(1, "Título é obrigatório.").max(300),
  category: z.string().min(1, "Categoria é obrigatória.").max(80),
  dueDate: optStr(30),
  competence: optStr(10),
});

export const accountantUpdateDocSchema = z.object({
  title: optStr(300),
  category: optStr(80),
  dueDate: optStr(30),
  competence: optStr(10),
  status: optStr(40),
  valor: optStr(30),
});

export const accountantResolveSolicitacaoSchema = z.object({
  dueDate: optStr(30),
  valor: optStr(30),
});

export const docStatusSchema = z.object({
  status: z.string().min(1, "Status é obrigatório.").max(40),
});

export const serproConfigSchema = z.object({
  consumerKey: optStr(200),
  consumerSecret: optStr(400),
  certSenha: optStr(200),
  cnpjContratante: optStr(20),
  ambiente: z.enum(["trial", "producao"]).optional().or(z.literal("")),
  whatsappSupport: optStr(30),
  multipleFilesText: optStr(500),
});

export const accountantPaymentCheckSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1, "Selecione ao menos uma guia.").max(150),
});

export const accountantPaymentCheckClientSchema = z.object({
  clientId: z.string().uuid(),
});

// --- Client portal ----------------------------------------------------

export const clientSetupProfileSchema = z.object({
  email: z.string().email("E-mail inválido.").max(200),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres.").max(200).optional().or(z.literal("")),
});

export const clientMessageSchema = z.object({
  content: z.string().min(1, "Mensagem vazia.").max(5000),
});

export const clientUploadSchema = z.object({
  title: optStr(300),
  category: z.string().min(1, "Categoria é obrigatória.").max(80),
  competence: optStr(10),
});

export const clientPreferencesSchema = z.object({
  notificationPreferences: z.record(z.string().max(40), z.boolean()),
});

export const clientGuiaSchema = z.object({
  tipoGuia: z.string().min(1).max(40),
  competencia: z.string().min(1).max(10),
  documentId: z.string().uuid().optional().or(z.literal("")),
});

export const clientGuiaInteractionSchema = z.object({
  type: z.enum(["view", "copy_pix", "copy_barcode"]),
});

// --- Integration API --------------------------------------------------

export const integrationUploadDocSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.string().min(1).max(80),
  dueDate: z.string().max(30).nullish(),
});

export const integrationSyncClientSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido.").max(20),
  name: z.string().min(1, "Nome é obrigatório.").max(300),
  regularityStatus: regularity.optional(),
});

export const integrationUpdateBillingSchema = z.object({
  clientId: uuid,
  month: z.string().min(1).max(10),
  servicesRevenue: z.number().nonnegative().optional(),
  salesRevenue: z.number().nonnegative().optional(),
  totalIncomes: z.number().nonnegative().optional(),
  servicesTaken: z.number().nonnegative().optional(),
  revenue: z.number().nonnegative().optional(),
  expenses: z.number().nonnegative().optional(),
  payroll: z.number().nonnegative().optional(),
});

// --- Notifications ---------------------------------------------------

export const notificationSubscribeSchema = z.object({
  subscriptionObject: z.any().optional().nullable(),
  fcmToken: z.string().max(4096).optional().nullable(),
  deviceName: z.string().max(300).optional().nullable(),
});

export const adminNotificationSendSchema = z.object({
  userIds: z.array(uuid).optional(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
});

// --- Webhooks -------------------------------------------------------------

export const webhookDocumentosSchema = z.object({
  companyHash: z.string().min(1, "companyHash é obrigatório.").max(200),
  categoria: optStr(80),
  nomeArquivo: optStr(300),
  dataVencimento: optStr(30),
  arquivo: z.string().optional().nullable(),
});

export const webhookReceitasSchema = z.object({
  hash_empresa: z.string().min(1, "hash_empresa é obrigatório."),
  vencimento: z.string().optional().nullable(),
  competencia: z.string().optional().nullable(),
  categoria: z.string().optional().nullable(),
  nome_arquivo: z.string().optional().nullable(),
  arquivo_base64: z.string().optional().nullable(),
  dados_extraidos: z.any().optional().nullable(),
});
