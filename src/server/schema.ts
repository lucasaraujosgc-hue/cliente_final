import { pgTable, text, timestamp, boolean, integer, uuid, json, jsonb, serial, real, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  cnpj: text('cnpj').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  regularityStatus: text('regularity_status').notNull(), // green, warning, red
  email: text('email'),
  firstAccessDone: boolean('first_access_done').default(false),
  // Legacy plaintext integration token — kept only for the transition window.
  // New tokens live as a sha256 digest in integrationHashDigest.
  integrationHash: text('integration_hash').unique(),
  integrationHashDigest: text('integration_hash_digest').unique(),
  accountantCategory: text('accountant_category'),
  notificationPreferences: json('notification_preferences').default({
    receives_all: true,
    recurrent: true,
    before_due: true,
    on_due: true,
    on_new_file: true
  }),
  // Password-recovery: only a hash of the one-time code is stored, never the
  // code itself. `resetCodeAttempts` caps online brute force. See
  // services/resetCode.ts + auth.routes.ts.
  resetCodeHash: text('reset_code_hash'),
  resetCodeExpires: timestamp('reset_code_expires', { mode: 'date' }),
  resetCodeAttempts: integer('reset_code_attempts').default(0).notNull(),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  category: text('category').notNull(), // taxes, payroll, company, other, bank_statement
  competence: text('competence'), // "MM/YYYY" like "05/2026"
  dueDate: text('due_date'),
  status: text('status').notNull(), // pending, paid, new, viewed
  uploadedBy: text('uploaded_by').notNull(), // accountant, client
  createdAt: timestamp('created_at').defaultNow().notNull(),
  fileUrl: text('file_url'),
  pixCode: text('pix_code'),
  extractedData: jsonb('extracted_data'),
});

export const billingData = pgTable('billing_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  month: text('month').notNull(), // "MM/YYYY"
  servicesRevenue: integer('services_revenue').default(0).notNull(),
  salesRevenue: integer('sales_revenue').default(0).notNull(),
  totalIncomes: integer('total_incomes').default(0).notNull(),
  servicesTaken: integer('services_taken').default(0).notNull(),
  // Keeping old fields just in case or we can just replace them entirely.
  // Actually replacing them entirely is better but we might have seed data.
  revenue: integer('revenue').default(0).notNull(),
  expenses: integer('expenses').default(0).notNull(),
  payroll: integer('payroll').default(0).notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  direction: text('direction').default('accountant_to_client').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  read: boolean('read').default(false).notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  subscriptionObject: jsonb('subscription_object'),
  fcmToken: text('fcm_token'),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const clientsRelations = relations(clients, ({ many }) => ({
	documents: many(documents),
	billingData: many(billingData),
	messages: many(messages),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
	client: one(clients, {
		fields: [documents.clientId],
		references: [clients.id],
	}),
}));

export const serproConfig = pgTable('serpro_config', {
  id: serial('id').primaryKey(),
  usuarioId: integer('usuario_id').notNull().default(1),
  consumerKey: text('consumer_key'),
  consumerSecret: text('consumer_secret'),
  certPath: text('cert_path'),
  certSenha: text('cert_senha'),
  cnpjContratante: text('cnpj_contratante'),
  ambiente: text('ambiente').default('trial'),
  whatsappSupport: text('whatsapp_support'),
  multipleFilesText: text('multiple_files_text'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const guiasGeradas = pgTable('guias_geradas', {
  id: serial('id').primaryKey(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  usuarioId: integer('usuario_id').notNull().default(1),
  tipoGuia: text('tipo_guia').notNull(),
  competencia: text('competencia').notNull(),
  status: text('status').default('PENDENTE'),
  pdfPath: text('pdf_path'),
  dataVencimento: text('data_vencimento'),
  valorTotal: real('valor_total'),
  numeroDocumento: text('numero_documento'),
  erroMsg: text('erro_msg'),
  createdAt: timestamp('created_at').defaultNow(),
  concluidoAt: timestamp('concluido_at')
});

// One row per guia whose payment status is being tracked. Created lazily the
// first time the client interacts with the guia (opens it / copies the PIX).
// The backend job (services/paymentQuery.ts) reads `next_check_at` to decide
// which guias to query at SERPRO — never on portal open. `document_id` is unique
// so there is exactly one scheduled check per guia (idempotency at the DB level).
export const paymentChecks = pgTable('payment_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().unique().references(() => documents.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  // PENDENTE | PAGO | ERRO | NAO_APLICAVEL
  status: text('status').notNull().default('PENDENTE'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  // null = no check scheduled. The job selects rows with next_check_at <= now().
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
  checkAttempts: integer('check_attempts').notNull().default(0),
  lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
  lastInteractionType: text('last_interaction_type'), // view | copy_pix | copy_barcode | manual
  lastError: text('last_error'),
  paidDetectedAt: timestamp('paid_detected_at', { withTimezone: true }),
  paidSource: text('paid_source'), // serpro | accountant | client
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  dueIdx: index('payment_checks_due_idx').on(t.status, t.nextCheckAt),
}));

// NFS-e (Nota Fiscal de Serviço eletrônica). The emitter is NOT implemented yet
// — this table is the scaffold so the future municipal/nacional integration
// (services/nfse.ts) has a place to persist emissions. Empty until then.
export const nfseEmissoes = pgTable('nfse_emissoes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  // rascunho | processando | emitida | rejeitada | cancelada
  status: text('status').notNull().default('rascunho'),
  competencia: text('competencia'), // MM/YYYY
  valorServicos: integer('valor_servicos'), // centavos
  descricao: text('descricao'),
  tomadorDoc: text('tomador_doc'), // CPF/CNPJ do tomador
  tomadorNome: text('tomador_nome'),
  numeroNota: text('numero_nota'),
  codigoVerificacao: text('codigo_verificacao'),
  providerRef: text('provider_ref'), // id no provedor externo
  xml: text('xml'),
  pdfUrl: text('pdf_url'),
  erroMsg: text('erro_msg'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const billingDataRelations = relations(billingData, ({ one }) => ({
	client: one(clients, {
		fields: [billingData.clientId],
		references: [clients.id],
	}),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
	client: one(clients, {
		fields: [messages.clientId],
		references: [clients.id],
	}),
}));

export const scheduledNotifications = pgTable('scheduled_notifications', {
  id: serial('id').primaryKey(),
  // Nullable: a rule with no client_id is a broadcast to every client.
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'immediate', 'recurrent', '3_days_before', 'on_due_date'
  title: text('title').notNull(),
  body: text('body').notNull(),
  scheduleDay: integer('schedule_day'),
  scheduleTime: text('schedule_time'),
  lastSent: timestamp('last_sent'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  actor: text('actor').notNull(), // 'accountant' | 'client:<id>' | 'integration:<id>'
  action: text('action').notNull(), // e.g. 'client.create', 'client.delete', 'token.revoke'
  targetType: text('target_type'), // 'client', 'document', ...
  targetId: text('target_id'),
  summary: text('summary'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// One row per long-lived login session. The short-lived access JWT is
// stateless; the refresh token lives here as a sha256 digest and is rotated on
// every use. `previousRefreshHash` lets /api/auth/refresh detect reuse of an
// already-rotated token (a theft signal) and kill the whole session.
// No FK: the accountant has no clients row, and the trail should outlive a
// client deletion (the delete handler clears client sessions explicitly).
export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(), // 'client' | 'accountant'
  subjectId: text('subject_id').notNull(),     // clients.id, or 'accountant'
  refreshHash: text('refresh_hash').notNull().unique(),
  previousRefreshHash: text('previous_refresh_hash'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const scheduledNotificationsRelations = relations(scheduledNotifications, ({ one }) => ({
	client: one(clients, {
		fields: [scheduledNotifications.clientId],
		references: [clients.id],
	}),
}));
