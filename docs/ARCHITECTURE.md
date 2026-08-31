# ARCHITECTURE.md

Arquitetura **real** do código atual (branch `improvements`). Não descreve
planos — o que estiver planejado está marcado `[PLANEJADO]`.

---

## Visão geral

```
┌─────────────┐   Authorization: Bearer <jwt>   ┌──────────────────────────────┐
│  SPA React  │ ─────────────────────────────► │  Express (server.ts)         │
│  (browser / │ ◄───────────────────────────── │   helmet · CORS · rate-limit │
│   PWA /     │            JSON                 │   setupRoutes()              │
│   Capacitor)│                                 │     routes/* ─► services/*   │
└─────────────┘                                 │       services/* ─► Drizzle  │
       ▲                                         │         Drizzle ─► Postgres  │
       │ dev: Vite middleware serve o SPA        └──────────────────────────────┘
       │ prod: express.static(dist/) + SPA fallback
```

Processo único. Sem workers, sem fila, sem cache externo (só um cache em memória
do token SERPRO). O `notificationSweeper` roda com `setInterval` dentro do mesmo
processo.

---

## FRONTEND

### Páginas (`src/pages/`)

Todas carregadas via `React.lazy` em `src/App.tsx`, dentro de um único
`<Suspense fallback={<ClientDashboardSkeleton />}>`.

| Arquivo | Rota | Guard |
|---------|------|-------|
| `Auth.tsx` → `Login` | `/login` | — |
| `Auth.tsx` → `AccountantLogin` | `/admin/login` | — |
| `client/SetupProfile.tsx` | `/setup-profile` | — (usa token do login) |
| `client/Dashboard.tsx` | `/dashboard` | `ClientLayout` |
| `client/Overdue.tsx` | `/overdue` | `ClientLayout` |
| `client/Vault.tsx` | `/vault` | `ClientLayout` |
| `client/MyUploads.tsx` | `/uploads` | `ClientLayout` |
| `client/Nfse.tsx` (+ `client/nfse/EmitWizard.tsx`) | `/nfse` | `ClientLayout` |
| `accountant/Dashboard.tsx` | `/admin` (index) | `AccountantLayout` |
| `accountant/nfse/` (`index`, `ClientNfsePanel`, `AtividadeForm`) | `/admin/nfse` | `AccountantLayout` |
| `accountant/ClientsList.tsx` | `/admin/clients` | `AccountantLayout` |
| `accountant/ClientDetail.tsx` | `/admin/client/:id` | `AccountantLayout` |
| `accountant/Notifications.tsx` | `/admin/notifications` | `AccountantLayout` |
| `accountant/Devices.tsx` | `/admin/devices` | `AccountantLayout` |
| `accountant/Audit.tsx` | `/admin/audit` | `AccountantLayout` |
| `accountant/FileGallery.tsx` | `/admin/gallery` | `AccountantLayout` |
| `accountant/Settings.tsx` | `/admin/settings` | `AccountantLayout` |

Sub-componentes do Dashboard do cliente (`src/pages/client/dashboard/`):
`KpiCards`, `DueDatesCard`, `BillingHistoryCharts`, `SupportCards`,
`PwaBanner`, `NotificationPreferencesModal`.

### Componentes compartilhados (`src/components/`)

| Componente | Função |
|-----------|--------|
| `Layouts.tsx` | `ClientLayout` e `AccountantLayout` — guarda de rota (redireciona se sem token), chrome (header/nav), modal de senha (cliente), fetch de stats (contador) |
| `Logo.tsx` | wordmark "Vírgula," (Fraunces + accent) — usar em vez de markup ad-hoc |
| `Skeleton.tsx` | `Skeleton` + `ClientDashboardSkeleton` (fallback do Suspense) |
| `ThemeToggle.tsx` | toggle claro/escuro via `next-themes` (só no header do contador) |
| `PixScannerButton.tsx` | pré-scaneia o PDF com `pdfjs-dist` procurando o PIX; usa `documentAuthHeadersFresh()` (renova o access antes) |
| `GuiaAtualizarButton.tsx` | dispara `POST /api/pendencies/guia/:clienteId` e mostra o resultado (novo vencimento, valor, PIX, link do PDF via `openDocument`) |
| `MfaCodeForm.tsx` | passo 2 do login do contador — campo do código de 6 dígitos, `POST /api/auth/accountant/verify`, `saveSession` |

### Navegação

- `react-router-dom` v7, `<BrowserRouter>`.
- **Área do cliente** (`ClientLayout`): uma lista `nav` (4 rotas), duas
  molduras, corte no `lg` (1024px). **< lg**: header compacto (`h-12`, nome +
  Sair) + `<Outlet/>` + **bottom nav** (`Visão Geral / Atrasados / Cofre /
  Envios`, `flex` sibling, safe-area própria). **≥ lg**: `<aside lg:w-60>` (logo
  + 4 itens + rodapé Alterar senha / Notificações / Sair). Engrenagem e sino
  ficam em `client/Dashboard.tsx` no mobile (a engrenagem dispara
  `open-password-change-modal`). Ver `docs/MOBILE_APP.md`.
- **Área do contador** (`AccountantLayout`): `<aside class="hidden md:flex md:w-64">`
  (sidebar escura fixa no desktop) + drawer deslizante no mobile
  (`mobileSidebarOpen`, hambúrguer). Header com toggle de sidebar + `ThemeToggle`.

### Gerenciamento de estado

Não há store global (nem Redux, nem Zustand, nem Context além do `ThemeProvider`
do `next-themes`).

**Gotcha:** `GET /api/client/dashboard` é um endpoint "gordo" que devolve o
bundle inteiro do cliente (`client` DTO + `documents` + `billing` + `messages` +
`whatsappSupport`). As páginas `client/Dashboard`, `client/Overdue` e
`client/Vault` **todas** chamam esse mesmo endpoint e filtram no cliente.

| O quê | Onde vive |
|-------|-----------|
| Sessão (access + refresh) | memória (`apiClient`) + `localStorage`/`sessionStorage` (web/PWA) ou `SecureStoragePlugin` (Capacitor, se disponível). Chaves `clientToken`/`clientRefreshToken`, `accountantToken`/`accountantRefreshToken` |
| Usuário do cliente | `localStorage.clientUser` / `sessionStorage.clientUser` (JSON `{id,name,cnpj,firstAccessDone,email?}`) |
| Tema | `next-themes` (classe no `<html>`) |
| Dados de tela | `useState` local, buscados em `useEffect` com `apiFetch` |
| Preferência de banner PWA | `localStorage.dismissPwaBanner_v2` |

Comunicação por eventos de `window`:
- `unauthorized` — disparado **só** por `apiClient` quando o refresh token
  falha (não há mais monkey-patch de `window.fetch`). Ouvido pelos Layouts →
  `handleLogout`.
- `open-password-change-modal` — abre o modal de senha (client).
- `open-notifications` — abre o modal de preferências de notificação (client Dashboard).

### apiClient (`src/lib/apiClient.ts`)

| Export | O que faz |
|--------|-----------|
| `getApiUrl(endpoint)` | prefixa `https://cliente.virgulacontabil.com.br` **se** `window.Capacitor` existir; senão string vazia (mesma origem) |
| `apiFetch(endpoint, opts, "client"\|"accountant")` | injeta `Authorization: Bearer` (access token da memória); em `401` fora de `/api/auth/` faz **um** `POST /api/auth/refresh` (single-flight) e repete a request; se o refresh falha → `clearSession` + evento `unauthorized` |
| `saveSession({kind,token,refreshToken,remember?})` / `clearSession(kind)` / `logout(kind)` | grava / limpa / revoga (server + local) a sessão |
| `hasSession(kind)` / `getAccessToken(kind)` / `hydrateSession()` | leitura síncrona + hidratação assíncrona do secure store |
| `ensureFreshAccess(kind)` | renova proativamente se o access está a < 60 s de expirar |
| `documentFileUrl(docId, {download?})` | URL **sem token** de `/api/documents/:id/file` |
| `documentAuthHeaders(as?)` / `documentAuthHeadersFresh(as?)` | `{ Authorization: "Bearer …" }` para pdf.js; a versão `Fresh` renova antes |
| `openDocument(docId, "view"\|"download", {as?, filename?})` | `apiFetch` → `blob` → `window.open` (view) ou `<a download>` (download); revoga o objectURL após 60 s |

`src/lib/cnpj.ts`: `normalizeCnpj` (só dígitos), `formatCnpj` (14 dígitos →
`XX.XXX.XXX/XXXX-XX`), `cnpjMatches(stored, query)` (busca tolerante).

### Autenticação (frontend)

1. Login → `saveSession(...)` (access + refresh) + `clientUser`. Contador:
   `MfaCodeForm` (código por e-mail) antes de `saveSession`.
2. `ClientLayout`/`AccountantLayout` redirecionam para o login se `hasSession()`
   for falso (todos os hooks rodam antes do early-return — rules of hooks).
3. `apiFetch` anexa o access token; em 401 renova via refresh e repete; só
   desloga se o refresh falhar.
4. `openDocument`/`PixScannerButton` levam o Bearer via header (nunca `?token=`);
   o scanner usa `documentAuthHeadersFresh`.
5. Logout → `logout(kind)` (revoga no servidor) + limpa `clientUser` + navega.

---

## BACKEND

### `server.ts` (bootstrap, nesta ordem)

1. `dotenv.config()` + `validateEnv()` (lança em prod se faltar secret real).
2. `app.set("trust proxy", trustProxy())` (env `TRUST_PROXY`, default 1).
3. `helmet(...)` — CSP só se `CSP_ENABLED=true` (opt-in).
4. `cors({ origin: CORS_ORIGINS || true })`.
5. `express.json({ limit: "16mb" })` registrado **só** em `/api/webhook/receitas`
   e `/documentos` (antes do parser global); depois `express.json({ limit: "2mb" })`
   global.
6. `app.use("/uploads", …404…)` — bloqueio explícito.
7. `app.use("/api", apiLimiter)` (300 req/min).
8. `GET /api/health`.
9. `await initDb()` — só `SELECT 1` + aviso se a tabela `clients` não existe.
10. `setupRoutes(app)`.
11. dev: `vite.middlewares`; prod: `express.static(dist)` + `GET *` → `index.html`.
12. Error handler central (mensagem genérica em prod).
13. `app.listen(PORT)`.

Fora do `startServer`: `pool.on("error")` + `unhandledRejection` só logam;
`uncaughtException` faz shutdown controlado + `exit(1)`.

### Routes (`src/server/routes/`, montadas por `setupRoutes()`)

| Módulo | Prefixo(s) | Auth | Principais endpoints |
|--------|-----------|------|----------------------|
| `auth.routes.ts` | `/api/auth/*` | pública (rate-limited) | client login; accountant `login`→`verify` (2FA e-mail); `refresh` (rotação); `logout`; forgot/reset-password |
| `client.routes.ts` | `/api/client/*`, `/api/pendencies/guia/*` | `verifyClientAuth` / `verifyAnyAuth` | dashboard, setup-profile, billing, upload, mark-doc, message, preferences, gerar guia SERPRO, histórico e PDF de guia |
| `files.routes.ts` | `/api/documents/:id/file` | `verifyAnyAuth` + autorização por doc | download/visualização autenticada |
| `accountant.routes.ts` | `/api/accountant/*`, `/api/pendencies/sitfis/config` | `verifyAccountantAuth` | CRUD de cliente, inbox/solicitações, upload/edição de doc, mensagens, billing, gerar/revogar token, overview, audit, config SERPRO |
| `integration.routes.ts` | `/api/integration/*` | `verifyIntegrationToken` | upload-doc, sync-client, update-billing |
| `webhook.routes.ts` | `/api/webhook/*` | token de integração no corpo (`hash_empresa`/`companyHash`) | receitas (SITFIS/base64), documentos (multipart/JSON) |
| `notifications.routes.ts` | `/api/notifications/*`, `/api/admin/notifications/*`, `/api/accountant/subscriptions*`, `/api/vapidPublicKey` | client / accountant | subscribe, send, regras agendadas, listar/apagar dispositivos |
| `nfse.routes.ts` | `/api/nfse/*`, `/api/nfse/admin/*` | client / accountant | status+gating, atividades, emissões (listar/emitir/cancelar/DANFSE), lookup-cnpj, lista LC 116; admin: config+certificado (multipart), atividades CRUD, testar, emissões |

Lista completa de paths: `grep -rhoE '"/api/[^"]+"' src/server/routes/`.

### Middleware (`src/server/middleware/`)

| Arquivo | Exports |
|---------|---------|
| `auth.ts` | `JWT_SECRET`, `verifyClientAuth`/`verifyAccountantAuth`/`verifyAnyAuth` (via `verifyAccessToken` — header-only, `401 {code:"token_expired"}` no expirado, `403` no papel errado), `verifyIntegrationToken` |
| `validate.ts` | `validateBody(zodSchema)` — 400 com `{error, details[]}`; substitui `req.body` pelo parseado |
| `rateLimit.ts` | `authLimiter` (10/15min), `refreshLimiter` (60/15min), `passwordResetRequestLimiter` (5/1h), `passwordResetSubmitLimiter` (15/15min), `webhookLimiter` (60/1min), `apiLimiter` (300/1min) |
| `requestLog.ts` | `requestLog` — `X-Request-Id` + uma linha de log por request |
| `concurrency.ts` | `inFlightLimit(max)` — cap de requisições simultâneas (webhooks) |

Também `src/server/services/upload.ts` exporta o middleware
`validateUploadedFileContent`.

### Services (`src/server/services/`)

| Arquivo | Responsabilidade |
|---------|------------------|
| `billing.ts` | `upsertBilling(clientId, input)` + `buildBillingPayload` — **único** lugar que escreve `billing_data` (mantém modelo services + colunas legadas) |
| `audit.ts` | `logAudit(req, action, {targetType,targetId,summary,metadata})` — insert best-effort em `audit_log` |
| `password.ts` | `hashPassword` (bcrypt 10), `verifyPassword` (bcrypt + fallback plaintext legado com flag `needsRehash`) |
| `resetCode.ts` | código de 6 dígitos (`crypto.randomInt`), `hashResetCode` (sha256 + pepper), `verifyResetCode` (timing-safe), TTL 15 min, `RESET_CODE_MAX_ATTEMPTS=5`, cooldown de reenvio 60 s |
| `session.ts` | `createSession`/`rotateSession` (rotação + detecção de reuso)/`revoke*`/`deleteSessionsForSubject`, `signAccessToken` (JWT 15min), `hashRefreshToken` (sha256). Tabela `auth_sessions` |
| `accountantMfa.ts` | desafio de 2FA do contador em memória — `createChallenge`/`verifyChallenge` (cap 5, TTL 10min, uso único, cooldown 60s), `accountantMfaEnabled`/`accountantMfaEmail` (gating por env) |
| `logger.ts` | `logger.info/warn/error` — formato consistente com timestamp + contexto |
| `integrationToken.ts` | `generateIntegrationToken` (`vic_` + 32 bytes), `hashIntegrationToken` (sha256), `setIntegrationToken`/`clearIntegrationToken` (patch de colunas), `findClientByIntegrationToken` (digest **ou** plaintext legado) |
| `secretbox.ts` | AES-256-GCM. `encryptSecret`/`decryptSecret` (string, formato `enc:v1:iv:tag:ct`), `encryptBytes`/`decryptBytes` (Buffer, magic `ENCv1\0`). Chave = sha256(`SECRETS_KEY`). Sem chave: no-op + lê plaintext legado |
| `upload.ts` | `UPLOADS_DIR`, `GUIAS_PDF_DIR`, `NFSE_CERTS_DIR`, `NFSE_PDF_DIR`, `ALLOWED_UPLOAD_EXTENSIONS`, `MAX_UPLOAD_BYTES` (10MB), `sanitizeFilename`, `isAllowedUploadName`, multer `upload`/`uploadCert`/`uploadNfseCert`, `validateUploadedFileContent` |
| `fileType.ts` | `sniffFamily(buf)` (magic bytes) + `contentMatchesExtension(buf, filename)` |
| `files.ts` | `resolveUploadPath` / `resolveGuiaPdfPath` (traversal-safe), `contentTypeForPath`, `contentDisposition` (anti-injection), `sendDiskFile` (stream), `sendDataUri`, `isReadableFile` |
| `serpro.ts` | `isUuid`, `getSerproToken` (cache em memória), `serproPost` (https nativo, suporta agent mTLS) |
| `nfse/` (pasta) | Emissor de NFS-e Nacional. `status` (gating), `cert` (PKCS#12 → agente mTLS + PEM, node-forge), `config` (CRUD config/atividades), `dps` (XML da DPS v1.01), `sign` (XMLDSig enveloped, xml-crypto), `client` (HTTP mTLS: emitir/consultar/eventos/DANFSE/parâmetros), `params` (cache), `emitir` (orquestra + persiste), `events` (cancelamento e101101), `danfse` (cache do PDF), `chave` (parse 50 díg.), `cnpjLookup` (BrasilAPI→ReceitaWS) |
| `mailer.ts` | `transporter` (Nodemailer SMTP), `resend` (Resend) |
| `push.ts` | init Firebase Admin (se env), VAPID, `sendClientNotification`, `sendPushToClients` |
| `notificationSweeper.ts` | `triggerDebouncedDocumentNotification` (debounce 30 s), `runNotificationSweeper` (+ `setInterval` 30 min e `setTimeout` 10 s no import) |
| `qrExtractor.ts` (fora de services/) | extrai PIX copia-e-cola e valor do PDF da guia |

### DTOs (`src/server/dto/`)

`dto/nfse.ts`: `nfseConfigDTO` (nunca `cert_path`/`cert_senha` — só `hasCert`,
`certCnpj`, `certValidadeAte`), `nfseAtividadeAdminDTO`/`nfseAtividadeClientDTO`,
`nfseEmissaoListDTO`/`nfseEmissaoDetailDTO`.

`dto/client.ts`: `clientSelfDTO` (portal do próprio cliente), `clientAdminDTO`
(`hasIntegrationToken: boolean`, sem valor), `clientIntegrationDTO`
(resposta de `sync-client`). **Nenhum endpoint faz `res.json({ client: <row> })`.**
`serpro_config` é sanitizado à mão no `GET /api/pendencies/sitfis/config`
(`hasKey`/`hasSecret`/`hasCert`/`hasCertSenha`, nunca o valor).

### Validação

`schemas/validation.ts` — schemas zod. **Todo POST/PUT tem um `validateBody`.**
Endpoints multipart: `upload.single(...)` → `validateUploadedFileContent` →
`validateBody(...)` → handler (o multer preenche `req.body` com os campos de
texto antes do `validateBody`).

### Banco

- `db.ts`: `pool` (`pg.Pool`, `DATABASE_URL`) + `db` (`drizzle(pool, { schema })`).
  `initDb()` só testa conexão.
- `schema.ts`: 10 tabelas (ver `PROJECT_CONTEXT.md` §7). Tipos inferidos em
  `types.ts` (`Client`, `Document`, `BillingRow`, `Message`).
- Migrations: `drizzle/*.sql` + `_journal.json` + `reconcile-legacy.sql`.
  `scripts/migrate.ts` roda `migrate()` do drizzle-orm; se detecta um banco
  legado (tabela `clients` existe, sem `drizzle.__drizzle_migrations`), aplica o
  `reconcile-legacy.sql`, marca o `0000` como aplicado e segue com `0001+`.
- `scripts/seed.ts` (`db:seed`) — dados demo, recusa `NODE_ENV=production` ou
  tabela `clients` não vazia.

---

## Fluxo end-to-end (exemplo: cliente baixa um documento)

```
1. UI            openDocument(doc.id, "download", { as: "client", filename })
2. apiClient     apiFetch("/api/documents/:id/file?download=1", {}, "client")
                   → fetch(getApiUrl(...), { headers: { Authorization: Bearer <access token> } })
                   ↳ se 401: POST /api/auth/refresh { refreshToken } → novo par → repete a request
3. Express       requestLog → apiLimiter → files.routes: verifyAnyAuth
                   jwt.verify (typ:"access") → req.user = { role:"client", clientId, sid }
4. Handler       isUuid(id)?  →  db.select(documents).where(id)
                   getAuth(req).role === "client" && doc.clientId !== req.user.clientId → 403
5. Resolve       doc.fileUrl:
                   "data:..."                → sendDataUri
                   "/api/pendencies/guia/N/pdf" → checa guiasGeradas + dono → sendDiskFile/sendDataUri
                   "/uploads/<name>"         → resolveUploadPath (basename, traversal-safe)
                                               → isReadableFile → sendDiskFile (stream)
6. Response      Content-Type do MIME map, Content-Disposition sanitizado,
                   Cache-Control: private,no-store, Referrer-Policy: no-referrer
7. apiClient     res.blob() → URL.createObjectURL → <a download> → revoke(60s)
```

Escrita (exemplo: contador cria cliente):

```
UI ClientsList → apiFetch POST /api/accountant/clients { cnpj (normalizado no front), name, ... }
  → verifyAccountantAuth → validateBody(accountantCreateClientSchema)
  → normalizeCnpj(cnpj) (backend também) → hashPassword(cnpjDigits)
  → integrationHash colado? setIntegrationToken(...) (digest)
  → db.insert(clients) → logAudit(req, "client.create")
  → res.json({ client: clientAdminDTO(newClient) })   ← nunca a row crua
```
