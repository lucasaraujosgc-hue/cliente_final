# PROJECT_CONTEXT.md

Contexto de negócio e visão geral técnica. Reflete o código atual da branch
`improvements`.

---

## 1. O que é o sistema

**Vírgula Contábil – Portal do Cliente.** Uma aplicação web (SPA + API Express)
de um escritório de contabilidade brasileiro que atende dois públicos no mesmo
código:

- os **clientes** (empresas atendidas pelo escritório);
- o **contador** (o próprio escritório — uma única conta administrativa).

Objetivo do produto: o cliente abre o app (de preferência no celular) e vê de
forma direta **o que precisa pagar, quando vence, e se a empresa está regular**;
o contador tem um painel único para servir todos os clientes.

## 2. Quem utiliza

| Perfil | Como entra | O que faz |
|--------|-----------|-----------|
| **Cliente** | `/login` com CNPJ + senha (senha inicial = o próprio CNPJ) | vê guias/vencimentos, baixa documentos do cofre, envia extrato bancário, preenche faturamento mensal, solicita recálculo, conversa por mural |
| **Contador** | `/admin/login` com usuário/senha de env (`ADMIN`/`PASSWORD`) | CRUD de clientes, publica documentos, processa inbox de uploads, edita/gera guias via SERPRO, envia notificações/mural, configura integração |
| **Sistemas externos** | `Authorization: Bearer <token de integração>` | `POST /api/integration/*` (sincronizar cliente/faturamento, subir doc) e `POST /api/webhook/*` (push de documentos / SITFIS) |

Não há auto-cadastro: o contador cria o cliente; o cliente faz o primeiro acesso
com o CNPJ e é levado a `/setup-profile` para definir e-mail e nova senha.

## 3. Área do cliente vs área do contador

### Área do cliente (`ClientLayout`, rotas sem prefixo)

| Rota | Página | Conteúdo |
|------|--------|----------|
| `/dashboard` | `pages/client/Dashboard.tsx` | resumo da competência selecionada: KPIs, próximos vencimentos (`DueDatesCard`), gráfico histórico de faturamento (`BillingHistoryCharts`), envio de extrato bancário, formulário de faturamento, cards de suporte, banner PWA, modal de preferências de notificação |
| `/overdue` | `Overdue.tsx` | guias atrasadas de todas as competências + botão "recalcular guia em atraso" (`GuiaAtualizarButton`) |
| `/vault` | `Vault.tsx` | cofre digital — todos os documentos recebidos + os enviados pelo cliente |
| `/uploads` | `MyUploads.tsx` | histórico de arquivos que o cliente enviou e status ("Aguardando análise" / "Contabilidade recebeu") |
| `/nfse` | `client/Nfse.tsx` (+ `client/nfse/`) | emissor de NFS-e. Sem setup completo → card "a partir de novembro/2026". Com setup → notas emitidas (ver PDF / compartilhar / duplicar / cancelar) + wizard de 3 passos (tomador → atividade/descrição → valor). |
| `/setup-profile` | `SetupProfile.tsx` (fora do layout) | primeiro acesso: e-mail + nova senha + aceite de termos |

Layout: **bottom nav** até `lg` (1024px), **sidebar** acima — ver
`docs/MOBILE_APP.md`. No mobile, engrenagem (senha) e sino (notificações) ficam
na tela "Visão Geral".

### Área do contador (`AccountantLayout`, prefixo `/admin`)

| Rota | Página | Conteúdo |
|------|--------|----------|
| `/admin` | `accountant/Dashboard.tsx` | **Inbox** — KPIs (`/api/accountant/overview`), últimos documentos recebidos dos clientes, "Atividade recente" (audit log) |
| `/admin/clients` | `ClientsList.tsx` | lista/busca de clientes, criar/editar, resetar senha, importar via Excel, envio de mural em massa |
| `/admin/nfse` | `accountant/nfse/` | **NFS-e** — por cliente: upload do certificado A1 + dados fiscais + atividades pré-configuradas (item LC 116, alíquota ISS, retenções); "Testar certificado" (abre o `.pfx` + checa convênio do município); aba "Notas emitidas" |
| `/admin/client/:id` | `ClientDetail.tsx` | detalhe do cliente: documentos, mensagens, faturamento, upload de doc, editar doc, marcar status, gerar/revogar token de integração (mostrado uma vez) |
| `/admin/notifications` | `Notifications.tsx` | envio de push imediato + regras de notificação agendada |
| `/admin/devices` | `Devices.tsx` | dispositivos/subscriptions de push por cliente |
| `/admin/audit` | `Audit.tsx` | histórico de ações sensíveis (`audit_log`) |
| `/admin/gallery` | `FileGallery.tsx` | galeria de todos os arquivos, download em massa (ZIP), exclusão em massa |
| `/admin/settings` | `Settings.tsx` | configuração SERPRO Integra Contador (consumer key/secret, cert .pfx, ambiente), WhatsApp de suporte |

Layout: sidebar fixa no desktop; drawer via hambúrguer no mobile.

## 4. Principais funcionalidades

- **Guias/impostos:** o contador (ou uma integração/webhook) publica documentos
  do tipo "guia" com vencimento; o cliente vê, copia o PIX, marca como pago.
- **Geração/recálculo de guia via SERPRO Integra Contador:** `DAS_SIMPLES` e
  `DCTFWEB_INSS`. Chama `/Emitir`, salva o PDF, extrai o PIX copia-e-cola.
- **Emissor de NFS-e Nacional:** integração direta com a Sefin Nacional. O
  contador cadastra por cliente o certificado A1 + atividades; o cliente emite
  pelo wizard (`services/nfse/` monta e assina a DPS v1.01, envia
  `POST /nfse`, persiste). Só habilita com certificado + atividade ativa +
  switch ligado — ver `docs/CHANGELOG.md`.
- **Cofre digital:** documentos de qualquer categoria, baixados apenas por
  endpoint autenticado.
- **Upload de extrato bancário** pelo cliente (PDF/OFX), com validação de
  conteúdo por magic bytes.
- **Faturamento mensal:** cliente ou contador preenche
  `servicesRevenue/salesRevenue/totalIncomes/servicesTaken` por competência;
  também importável de Excel.
- **Mural / mensagens:** contador → cliente (individual ou em massa) e
  cliente → contador.
- **Recuperação de senha do cliente:** código de 6 dígitos por e-mail (Resend),
  armazenado só como hash, uso único, expira em 15 min.
- **Notificações push:** web-push (navegador/PWA) e FCM (app). Regras agendadas
  varridas a cada 30 min.
- **Audit log** das ações sensíveis do contador.

## 5. Principais fluxos

### 5.1 Primeiro acesso do cliente
`contador cria cliente` → cliente entra em `/login` com CNPJ + CNPJ → JWT +
`firstAccessDone=false` → redireciona `/setup-profile` → define e-mail/senha
(`POST /api/client/setup-profile`, `firstAccessDone=true`) → `/dashboard`.

### 5.2 Recuperar senha
`/login` → "Esqueci minha senha" → CNPJ (`POST /api/auth/client/forgot-password`,
resposta **idêntica** sempre) → e-mail com código de 6 dígitos →
`POST /api/auth/client/reset-password` (cnpj + code + newPassword≥8) → código
queimado, `firstAccessDone=true`.

### 5.3 Publicar documento (contador)
`ClientDetail` → upload → `POST /api/accountant/upload-doc`
(`upload.single` → `validateUploadedFileContent` → `validateBody`) → grava
`documents` com `fileUrl=/uploads/<nome>` → `triggerDebouncedDocumentNotification`
(debounce 30 s) → push ao cliente.

### 5.4 Baixar/ver documento (cliente ou contador)
Frontend chama `openDocument(docId, "view"|"download", {as})` →
`GET /api/documents/:id/file` com `Authorization: Bearer` →
`verifyAnyAuth` + checagem de dono → resolve o arquivo a partir de
`documents.fileUrl` (disco `/uploads`, `data:` URI, ou ponteiro de guia) →
stream. Nunca via `?token=`, nunca `/uploads` direto.

### 5.5 Recalcular guia em atraso (cliente)
`Overdue`/`Dashboard` → `GuiaAtualizarButton` → `POST /api/pendencies/guia/:clienteId`
(`{tipoGuia, competencia, documentId}`) → decripta credenciais SERPRO em memória
→ `getSerproToken` → `serproPost(.../Emitir)` → salva PDF em `GUIAS_PDF_DIR` →
`qrExtractor` extrai PIX + valor + **número do documento** (`detalhamentoDas` da
DAS, ou texto do PDF) → atualiza `documents` (`fileUrl` = ponteiro da guia,
`pixCode`, `dataVencimento`, `extracted_data.numeroDocumento`, status
`GUIA_ATUALIZADA`).

### 5.6 Webhook de documento externo
Sistema externo → `POST /api/webhook/receitas` ou `/documentos` com
`hash_empresa`/`companyHash` (token de integração) → `findClientByIntegrationToken`
(digest **ou** plaintext legado) → valida tamanho/extensão/magic bytes → grava
arquivo + `documents` → notifica.

### 5.7 Consulta de pagamento de guia (PAGTOWEB)
`services/paymentQuery.ts`. Guia federal (`isFederalGuia`) recebe uma linha
`payment_checks` na 1ª interação do cliente (abrir/copiar PIX) ou quando o
contador dispara a consulta. O job horário (`runPaymentQuerySweeper`) e o botão
"Consultar" do contador chamam `consultarPagamentoNoSerpro` → PAGTOWEB
"Consultar Pagamentos" (`idServico PAGAMENTOS71`, endpoint `/Consultar`):
por `numeroDocumentoLista` se `extracted_data.numeroDocumento` existe (extraído
do PDF e cacheado na 1ª tentativa se faltar), senão por
`intervaloDataArrecadacao` + `intervaloValorTotalDocumento`. O serviço só
retorna documentos arrecadados → item com `dataArrecadacao` marca a guia paga
(`documents.status = paid`, `payment_checks.status = PAGO`, push ao cliente).
O contador também pode **informar pagamento manual em lote** em `/admin/payments`
(`POST /api/accountant/payments/mark-paid` → `markPaymentsManual`) — mesmo efeito,
sem SERPRO e sem notificar o cliente.

## 6. Estrutura geral frontend / backend

### Frontend
- SPA React 19, todas as rotas `React.lazy` + `<Suspense>` (`src/App.tsx`).
- Sem store global. Cada página: `useState` + `useEffect` + `apiFetch()`.
- Auth: token/usuário em `localStorage` (`clientToken`/`clientUser`/`accountantToken`)
  ou `sessionStorage` (cliente, quando "não lembrar de mim").
- `apiFetch` injeta o Bearer certo e, em 401, limpa o token e redireciona ao login.
- `main.tsx` também instala um patch global de `window.fetch` que dispara o
  evento `unauthorized` em 401/403 (ouvido pelos Layouts para deslogar).
- Eventos custom: `unauthorized`, `open-password-change-modal`, `open-notifications`.

### Backend
- `server.ts`: `validateEnv()` → helmet (CSP opt-in) → CORS (`CORS_ORIGINS`) →
  parsers JSON (16 MB só nos 2 webhooks base64, 2 MB global) → bloqueio de
  `/uploads` → `apiLimiter` em `/api` → `initDb()` (só testa conexão) →
  `setupRoutes()` → Vite (dev) / static+fallback (prod) → error handler central.
- 7 módulos de rota (`src/server/routes/`), montados por `setupRoutes()`.
- `services/` concentra a lógica reutilizável; handlers ficam finos.

## 7. Banco de dados

Postgres via Drizzle. Schema em `src/server/schema.ts` (**única fonte de verdade**).
14 tabelas:

| Tabela | Papel | Notas |
|--------|-------|-------|
| `clients` | empresas atendidas | `cnpj` **só dígitos** (14), `unique`. `password_hash` (bcrypt). `integration_hash` (legado, `unique`) + `integration_hash_digest` (sha256, `unique`). `reset_code_hash/expires/attempts`. `notification_preferences` (json). |
| `documents` | documentos/guias | `file_url` = `/uploads/<nome>` \| `data:...` \| ponteiro de guia. `extracted_data` jsonb (`extractedValue`, `numeroDocumento`). FK cascade. |
| `billing_data` | faturamento mensal | modelo "services" + colunas legadas mantidas via `upsertBilling()`. FK cascade. |
| `messages` | mural cliente↔contador | `direction`. FK cascade. |
| `subscriptions` | push endpoints | web-push (`subscription_object` jsonb) e/ou `fcm_token`. FK cascade. |
| `serpro_config` | config SERPRO (1 linha, `usuario_id=1`) | `consumer_secret`/`cert_senha` **cifrados** (`enc:v1:...`) quando `SECRETS_KEY` setado. `cert_path` aponta p/ `.pfx` (cifrado no disco). |
| `guias_geradas` | guias emitidas via SERPRO | `pdf_path` (arquivo em `GUIAS_PDF_DIR` ou `data:`), `numero_documento` (p/ consulta PAGTOWEB). FK cascade. |
| `scheduled_notifications` | regras de push agendado | `client_id` nulo = broadcast. FK cascade. |
| `audit_log` | trilha de ações do contador | **sem FK** (sobrevive à exclusão do cliente). |
| `auth_sessions` | 1 linha por login | refresh token hasheado + rotação + `previous_refresh_hash` (reuso) + `expires_at` + `revoked_at`. **Sem FK** (contador não tem linha; o delete de cliente limpa explicitamente). |
| `payment_checks` | rastreio de pagamento de guia | 1 linha/guia (`document_id` unique). `paid_source` = `serpro`\|`accountant`. FK cascade. Ver §5.7. |
| `nfse_config` | config de NFS-e (1/cliente) | certificado A1 (`cert_path` cifrado, `cert_senha` `enc:v1:`), `codigo_municipio` (IBGE), `regime_tributario`, `serie_dps`, `prox_numero_dps`, `ativo`. FK cascade. **DTO obrigatório** (`dto/nfse.ts`). |
| `nfse_atividades` | atividades pré-configuradas | item LC 116, `cod_tributacao_nac`, `aliquota_iss`, `iss_retido`, retenções federais. FK cascade. |
| `nfse_emissoes` | notas emitidas / rascunhos / rejeições | `chave_acesso` (50), `xml_dps`/`xml_nfse`, `danfse_pdf_path`, `rejeicao_codigo/motivo`, `cancelada_em`. FK cascade. |

Migrations: `drizzle/0000_baseline.sql` … `0006_nfse.sql` + `drizzle/reconcile-legacy.sql`
(bridge para bancos antigos). Runner: `scripts/migrate.ts` (`npm run db:migrate`),
auto nos hooks `predev`/`prestart`. Ver `MIGRATIONS.md`.

## 8. Autenticação

- **Sessão** = **access token** (JWT HS256 `JWT_SECRET`, `{ role, name?,
  clientId?, sid, typ }`, `expiresIn: 15 min`) + **refresh token** opaco 256 bits
  (~90 dias), guardado só como `sha256` em `auth_sessions`, **rotacionado a cada
  `POST /api/auth/refresh`** com detecção de reuso. Enviado só em
  `Authorization: Bearer` (não há `?token=`). Detalhe em `docs/SECURITY.md` §2.
- **Cliente:** `POST /api/auth/client/login` — primeiro tenta match de admin
  (env, → 2FA), senão busca por CNPJ (`eq` no índice) e `verifyPassword` (bcrypt
  + retry sem pontuação para senha=CNPJ). Legado plaintext migra p/ bcrypt no
  próximo login. Emite o par access/refresh.
- **Contador:** `POST /api/auth/accountant/login` (usuário/senha do env) →
  `{ mfaRequired, challengeId }` → `POST /api/auth/accountant/verify` (código de
  6 dígitos por e-mail, TTL 10 min, cap 5) → par access/refresh. `ACCOUNTANT_2FA=off`
  pula a 2ª etapa. Não existe linha no banco.
- **Renovação/logout:** `POST /api/auth/refresh` (rotaciona), `POST
  /api/auth/logout` (revoga). `apiFetch` renova sozinho em 401.
- **Integração:** `verifyIntegrationToken` — `findClientByIntegrationToken`
  compara `sha256(token)` com `integration_hash_digest`, com fallback para o
  `integration_hash` plaintext legado.
- Middlewares: `verifyClientAuth`, `verifyAccountantAuth`, `verifyAnyAuth` (via
  `verifyAccessToken`). Acessores tipados: `getAuth(req)`, `getClientId(req)`,
  `getIntegrationClient(req)`.

## 9. Integrações

- **SERPRO Integra Contador** (`services/serpro.ts`): OAuth2 client-credentials
  (`consumerKey:consumerSecret` em Basic) + `jwt_token`; mTLS via `.pfx` quando
  `ambiente=producao`. Endpoints usados: `/authenticate` e `/Emitir` (trial e
  produção). Token cacheado em memória por `consumerKey:ambiente`.
- **Resend** (`services/mailer.ts`) — e-mail de recuperação de senha.
- **Nodemailer/SMTP** — e-mail de boas-vindas no primeiro acesso.
- **Firebase Admin (FCM)** (`services/push.ts`) — push no app; inicializa só se
  `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` presentes.
- **web-push (VAPID)** — push no navegador/PWA. Gera chaves efêmeras se
  `VAPID_*` não setado (quebra a cada restart — setar em prod).
- **API de integração própria** (`/api/integration/*`, `/api/webhook/*`) —
  consumida pelo "sistema principal" do escritório.

## 10. Armazenamento de arquivos

- Uploads de documento: disco, em `UPLOADS_DIR = process.cwd()/uploads`.
  Nome gerado: `Date.now()-<uuid>-<nome sanitizado>`. Multer `diskStorage`,
  `fileFilter` por extensão (`ALLOWED_UPLOAD_EXTENSIONS`), `limits` 10 MB / 1
  arquivo. Middleware `validateUploadedFileContent` checa magic bytes.
- PDFs de guia SERPRO: `GUIAS_PDF_DIR` (`DATA_PATH/guias_pdfs` ou
  `process.cwd()/data/guias_pdfs`).
- Certificado `.pfx/.p12`: `DATA_PATH/certs` ou `process.cwd()/data/certs`,
  cifrado no disco (magic `ENCv1\0`) quando `SECRETS_KEY` setado.
- **`/uploads` NÃO é servido estaticamente** — devolve 404. Download só via
  `GET /api/documents/:id/file` (path resolvido do banco, traversal-safe,
  streaming).

## 11. Notificações

- Cliente ativa via `subscribeToPush()` no `Dashboard` do cliente:
  - navegador/PWA → `pushManager.subscribe` com a chave VAPID → `POST /api/notifications/subscribe`
  - Capacitor → `Capacitor.Plugins.PushNotifications` (FCM) → mesmo endpoint com `fcmToken`
- Contador dispara: `POST /api/admin/notifications/send` (imediato) ou cria
  regra em `POST /api/admin/notifications/schedule`.
- `services/notificationSweeper.ts`: `setInterval` 30 min (+ uma varredura 10 s
  após boot) processa `scheduled_notifications` (`recurrent`, `3_days_before`,
  `on_due_date`); `triggerDebouncedDocumentNotification` agrupa novos documentos
  por cliente com debounce de 30 s.
- Service Worker (`public/sw.js`) trata `push` e `notificationclick`
  (`clients.openWindow('/')`).

## 12. Capacitor

**O wrapper nativo Android/iOS NÃO está neste repositório** — não há
`capacitor.config.*`, dependências `@capacitor/*`, nem pastas `android/`/`ios/`.

O que existe no código web: detecção defensiva de `window.Capacitor` para
- trocar a base URL da API para `https://cliente.virgulacontabil.com.br`
  (`lib/apiClient.ts`), e
- usar `Capacitor.Plugins.PushNotifications` (FCM) em vez de web-push
  (`pages/client/Dashboard.tsx`).

Ver `docs/MOBILE_APP.md`.

## 13. PWA

- `public/manifest.json`: `display: standalone`, `orientation: portrait-primary`,
  `theme_color #10b981`, `background_color #0f172a`. Ícones apontam para
  `virgulacontabil.com.br` (host externo).
- `public/sw.js` (`virgula-pwa-v1`): cache de `/` e `/index.html`; para GET não-API,
  network-first com fallback ao cache; ignora `/api/`. Handlers `push` /
  `notificationclick`.
- Registrado em `index.html` **e** `src/main.tsx` (duplicado — inofensivo).
- `PwaBanner` no Dashboard do cliente sugere instalar.

---

## Estado atual

### Implementado
- Portal do cliente (dashboard, atrasados, cofre, envios, primeiro acesso).
- Painel do contador (inbox, clientes, detalhe, notificações, dispositivos,
  auditoria, galeria, configurações).
- Auth header-only: **access token 15min + refresh token 90d** (rotação +
  detecção de reuso, `auth_sessions`), renovação automática no `apiFetch`,
  revogação no logout / reset de senha / exclusão. Login com CNPJ tolerante a
  formatação. **2FA por e-mail** no login do contador.
- Recuperação de senha por código (hash, uso único, TTL 15 min, cap de
  tentativas, resposta anti-enumeração) — também revoga as sessões.
- CSP ligada por padrão; observabilidade (request-id + access log); cap de
  concorrência nos webhooks; timeout no SERPRO.
- Navegação mobile-first da área do cliente: bottom nav (< 1024px) / sidebar
  (≥ 1024px), mesma lista de rotas.
- Token de integração armazenado como digest (com fallback plaintext legado).
- Segredos SERPRO cifrados em repouso (quando `SECRETS_KEY` setado).
- Download de documento só por endpoint autenticado + autorizado; `/uploads`
  não público.
- Validação de conteúdo de upload por magic bytes + whitelist de extensão.
- Zod em todos os endpoints de escrita.
- CNPJ armazenado só em dígitos (migration 0002); formatação na exibição.
- Migrations Drizzle como única fonte de verdade + bridge para bancos legados.
- Audit log das ações sensíveis do contador.
- Notificações push (web-push + FCM) + regras agendadas + sweeper.
- Geração/recálculo de guia SERPRO (DAS/DCTFWEB) com extração de PIX.
- Emissor de NFS-e Nacional (Sefin Nacional, DPS v1.01): cadastro do certificado
  A1 + atividades por cliente pelo contador, wizard de emissão, DANFSE,
  cancelamento. **Não homologado em produção restrita** (ver Pendências).
- PWA (manifest + service worker).
- Code splitting por rota + `manualChunks` para libs pesadas.
- CI (lint + test + build) e Dockerfile com migração no `prestart`.

### Em andamento
- Nada em desenvolvimento ativo. A branch `improvements` aguarda
  revisão/merge/deploy (`git log main..HEAD`).

### Planejado
- Badge de contagem em "Atrasados" na bottom nav.
- Wrapper Capacitor Android/iOS versionado (deve incluir um plugin de secure
  storage p/ os tokens).
- Handler do botão voltar do Android.
- Remoção da coluna `integration_hash` plaintext (após confirmar que toda
  integração migrou para token novo).
- NFS-e: PIS/COFINS retido (bloco `piscofins` com CST), deduções/reduções,
  cancelamento por substituição, retry automático de emissões `processando`,
  regimes/exigibilidades além do caso comum.

### Pendências
- **NFS-e — homologar em produção restrita** (`sefin.producaorestrita.nfse.gov.br`)
  com um certificado A1 real: validar a assinatura XMLDSig (SHA-1 vs SHA-256), a
  ordem/campos da DPS v1.01 e o parse da resposta. Conferir também o convênio dos
  municípios dos clientes.
- `SECRETS_KEY` precisa ser definido em produção **e** a config SERPRO
  re-salva para os valores existentes serem cifrados. `SECRETS_KEY` também é
  obrigatório para guardar os certificados A1 de NFS-e.
- Rodar as migrations (`reconcile`/`0001`…`0003`) contra uma **cópia** da base
  de produção antes do primeiro deploy — conferir a conversão
  `reset_code_expires` text→timestamp.
- `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` fixos em produção (senão push web quebra
  a cada restart).
- `ACCOUNTANT_MFA_EMAIL` (ou `EMAIL_USER`) configurado em produção, senão a 2FA
  do contador fica inativa (o boot avisa).
- Fluxo access+refresh + 2FA ainda **não** validado ponta-a-ponta num ambiente
  real (sem DB nesta sessão); testes unitários cobrem a lógica de rotação/reuso.

### Riscos conhecidos
- Uma sessão revogada continua valendo até o access token expirar (janela ≤15
  min) — trade-off consciente por não checar o banco a cada request.
- Desafio de 2FA do contador vive em memória — restart do servidor entre senha
  e código força recomeçar o login (aceitável: 1 conta, TTL 10 min).
- Secure storage no Capacitor depende de o wrapper nativo prover o plugin;
  senão cai no `localStorage` (sandbox) da WebView.
- `integration_hash` plaintext ainda é aceito no lookup (transição) — vetor
  enquanto não for removido.
- Sem rotação/versionamento de `SECRETS_KEY` — trocar a chave torna os valores
  cifrados ilegíveis (exige re-salvar a config).
- `migrations.test.ts` (pglite/WASM) é lento e pode dar timeout sob carga no CI.
- Chunks `pdf`/`xlsx` do bundle passam de 500 KB (carregados sob demanda, mas
  grandes).

## Princípios de trabalho (para futuras sessões)

- **Não reescrever** funcionalidade existente sem necessidade.
- **Primeiro entender** o código atual; `grep` por todas as referências antes de
  mexer numa API.
- **Preservar compatibilidade** (webhooks, integrações, formatos de `fileUrl`).
- **Testar** (`npm run lint` + `npm test`) depois de qualquer alteração.
- **Não inventar** funcionalidade; não marcar como pronto o que não está no
  código — verificar sempre.
- **Não desativar** validações/testes para "fazer passar".
