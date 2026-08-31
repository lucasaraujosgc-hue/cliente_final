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

// --- NFS-e -----------------------------------------------------------------

// FormData sends every field as a string. Keep "" meaning "not provided" and
// coerce "true"/"1" to boolean, preserving undefined.
const optBoolStr = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === "") return undefined;
    if (typeof v === "boolean") return v;
    return v === "true" || v === "1" || v === "on";
  });

// Accountant: per-client certificate + fiscal data (multipart, cert file apart).
export const nfseConfigSchema = z.object({
  codigoMunicipio: optStr(10),
  regimeTributario: z.enum(["simples_nacional", "mei", "normal"]).optional().or(z.literal("")),
  regimeEspecialTrib: optStr(10),
  optanteSimplesNacional: optBoolStr,
  incentivoFiscal: optBoolStr,
  ambiente: z.enum(["homologacao", "producao"]).optional().or(z.literal("")),
  serieDps: optStr(5),
  ativo: optBoolStr,
  certSenha: optStr(200),
});

// Accountant: one pre-configured activity (JSON).
export const nfseAtividadeSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório.").max(120),
  itemListaServico: z.string().min(1, "Item da lista de serviço é obrigatório.").max(10),
  codTributacaoNac: z.string().max(12).nullish(),
  codTributacaoMun: z.string().max(20).nullish(),
  cnae: z.string().max(15).nullish(),
  descricaoPadrao: z.string().max(2000).optional(),
  aliquotaIss: z.number().min(0).max(100).optional(),
  issRetido: z.boolean().optional(),
  exigibilidadeIss: z.enum(["1", "2", "3", "4", "5", "6", "7"]).optional(),
  municipioIncidencia: z.string().max(10).nullish(),
  retIrrf: z.number().min(0).max(100).optional(),
  retPis: z.number().min(0).max(100).optional(),
  retCofins: z.number().min(0).max(100).optional(),
  retCsll: z.number().min(0).max(100).optional(),
  retInss: z.number().min(0).max(100).optional(),
  ativo: z.boolean().optional(),
  ordem: z.number().int().min(0).max(9999).optional(),
});

// Client: CNPJ lookup for the tomador.
export const nfseCnpjLookupSchema = z.object({
  cnpj: z.string().min(11, "CNPJ inválido.").max(18),
});

const nfseEnderecoSchema = z
  .object({
    logradouro: optStr(150),
    numero: optStr(20),
    complemento: optStr(80),
    bairro: optStr(80),
    codigoMunicipio: optStr(10),
    municipio: optStr(120),
    uf: optStr(2),
    cep: optStr(12),
  })
  .partial()
  .optional();

// Client: emit a new NFS-e (JSON). `valor` is in centavos.
export const nfseEmitSchema = z.object({
  atividadeId: z.string().uuid("Selecione uma atividade."),
  tomador: z.object({
    doc: z.string().min(11, "Documento do tomador inválido.").max(18),
    nome: z.string().min(1, "Razão social do tomador é obrigatória.").max(200),
    email: z.string().email("E-mail inválido.").max(200).optional().or(z.literal("")),
    telefone: optStr(20),
    inscricaoMunicipal: optStr(20),
    endereco: nfseEnderecoSchema,
  }),
  descricao: z.string().min(1, "Descrição do serviço é obrigatória.").max(2000),
  valor: z.number().int("Valor inválido.").positive("Valor deve ser maior que zero.").max(99_999_999_99),
  competencia: z
    .string()
    .regex(/^\d{2}\/\d{4}$/, "Competência no formato MM/AAAA.")
    .optional()
    .or(z.literal("")),
});

export const nfseCancelSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(15, "Descreva o motivo do cancelamento (mínimo 15 caracteres).")
    .max(255),
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
