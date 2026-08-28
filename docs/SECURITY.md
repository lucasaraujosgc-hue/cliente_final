# SECURITY.md

Estado de segurança **atual** (branch `improvements`, pós correções). Verificável
no código. Pendências listadas no fim **não** estão resolvidas.

---

## 1. Autenticação

| Ator | Endpoint | Como valida |
|------|----------|-------------|
| Cliente | `POST /api/auth/client/login` | 1) match de admin por `ADMIN`/`PASSWORD` (env) — atalho, com 2FA; 2) `findClientsByCnpj` (`eq` no índice único) + `verifyPassword` (bcrypt; se falhar e a senha tiver pontuação, tenta de novo com só dígitos, para o caso senha=CNPJ). Legado plaintext vira bcrypt no próximo login. Emite **access + refresh** (§2). |
| Contador | `POST /api/auth/accountant/login` → `POST /api/auth/accountant/verify` | só `ADMIN`/`PASSWORD` do env (**não há linha no banco**); depois **2FA por código de e-mail** (§2b). O token só sai no `/verify`. |
| Renovação | `POST /api/auth/refresh` | rotação do refresh token (§2). |
| Integração / webhook | `Authorization: Bearer <token>` ou `hash_empresa`/`companyHash` no corpo | `findClientByIntegrationToken` — `sha256(token)` vs `integration_hash_digest`, com **fallback para `integration_hash` plaintext legado**. |

`src/server/middleware/auth.ts`: `verifyClientAuth`, `verifyAccountantAuth`,
`verifyAnyAuth` (todos via `verifyAccessToken`), `verifyIntegrationToken`.
Acessores tipados em `types.ts`: `getAuth`, `getClientId`, `getIntegrationClient`
(lançam se o middleware não rodou).

## 2. Sessão: access token + refresh token

`src/server/services/session.ts` + tabela `auth_sessions` (migration `0003`).
Mesmo mecanismo em toda plataforma (browser, PWA, Capacitor) — só o
armazenamento no cliente muda.

- **Access token**: JWT HS256 (`JWT_SECRET`), `expiresIn: 15 min`, payload
  `{ role, name?, clientId?, sid, typ:"access" }`. Stateless — o middleware só
  verifica a assinatura. Uma sessão revogada continua valendo até o access
  expirar (janela de ≤15 min; o trade-off para não bater no banco a cada
  request). Fallback do secret só em dev; `validateEnv()` recusa boot em
  produção sem `JWT_SECRET`.
- **Refresh token**: string opaca de 256 bits (`vrt_…`), ~90 dias, guardada
  **só como `sha256`** em `auth_sessions.refresh_hash`. **Rotacionado a cada
  uso**: `/api/auth/refresh` emite um par novo e guarda o hash do anterior em
  `previous_refresh_hash`.
- **Detecção de reuso**: apresentar um refresh token já rotacionado (bate com
  `previous_refresh_hash` de alguma sessão) revoga a sessão inteira — sinal de
  roubo. `/refresh` responde um único 401 genérico (`code: "refresh_invalid"`)
  para qualquer falha (desconhecido / revogado / expirado / reusado).
- **Revogação**: `revokeAllSessionsForSubject` é chamado no reset de senha do
  cliente (self-service **e** pelo contador); `deleteSessionsForSubject` na
  exclusão do cliente.
- Middleware devolve `401 { code: "token_expired" }` quando o access expira
  (≠ token ausente/ inválido) — o cliente sabe que deve renovar.
- `PASSWORD_RESET_PEPPER` (opcional) tempera o hash do código de recuperação;
  cai para `JWT_SECRET` se não setado.

### 2b. 2FA do contador (código por e-mail)

`src/server/services/accountantMfa.ts`. Ativo por padrão sempre que há para onde
mandar o código (`ACCOUNTANT_MFA_EMAIL`, ou `EMAIL_USER` como fallback);
`ACCOUNTANT_2FA=off` desativa. `env.ts` avisa no boot se ficou off sem querer.

- Passo 1 (`/accountant/login`): valida `ADMIN`/`PASSWORD` → gera código de
  6 dígitos → `sha256(código + pepper)` guardado **só em memória** (1 conta,
  TTL 10 min, processo único — sem tabela) → e-mail → devolve `{ mfaRequired,
  challengeId }`, **sem token**.
- Passo 2 (`/accountant/verify`): compara em tempo constante, cap de 5
  tentativas por desafio, uso único. Só aqui sai o par access/refresh.
- Reenvio: POST em `/verify` com o mesmo `challengeId` e sem `code` (respeitando
  cooldown de 60 s).

### 2c. Armazenamento no cliente (`src/lib/apiClient.ts`)

- Verdade em memória (leitura síncrona p/ pdf.js); persistido para sobreviver a
  reload/restart.
- **Web / PWA**: `localStorage` (ou `sessionStorage` quando "lembrar" está
  desligado).
- **Capacitor**: usa `Capacitor.Plugins.SecureStoragePlugin` quando o wrapper
  nativo o fornece; senão o `localStorage` **próprio da WebView** (sandbox do
  app, não o navegador). `[PENDÊNCIA]` o wrapper deve incluir um plugin de
  secure storage.
- `apiFetch`: em `401` (fora de `/api/auth/*`) faz **um** `refresh` (single-
  flight) e repete a request; só se o refresh falhar dispara `unauthorized`
  (→ redireciona para o login). Sem mais monkey-patch de `window.fetch`.

## 3. Authorization Bearer (sem `?token=`)

- Os middlewares leem **apenas** `req.headers.authorization` — o fallback
  `req.query.token` foi removido.
- Frontend:
  - chamadas de API: `apiFetch()` injeta o header;
  - download/visualização de documento: `openDocument()` (fetch autenticado →
    blob), nunca `<a href="...?token=">`;
  - pdf.js (`PixScannerButton`): `getDocument({ httpHeaders: await documentAuthHeadersFresh() })`
    (renova o access antes, já que o pdf.js não sabe repetir um 401).
- `documentFileUrl()` devolve URL **sem** token.
- Respostas de arquivo levam `Cache-Control: private, no-store` e
  `Referrer-Policy: no-referrer`.

## 4. Rate limiting

`src/server/middleware/rateLimit.ts` (`express-rate-limit` v8, chave = IP):

| Limiter | Janela / limite | Onde |
|---------|-----------------|------|
| `authLimiter` | 10 / 15 min | `POST /api/auth/client/login`, `/accountant/login`, `/accountant/verify` |
| `refreshLimiter` | 60 / 15 min | `POST /api/auth/refresh` |
| `passwordResetRequestLimiter` | 5 / 1 h | `POST /api/auth/client/forgot-password` |
| `passwordResetSubmitLimiter` | 15 / 15 min | `POST /api/auth/client/reset-password` |
| `webhookLimiter` | 60 / 1 min | `POST /api/webhook/*` |
| `apiLimiter` | 300 / 1 min | tudo em `/api` |

Cap de concorrência: `inFlightLimit(4)` (`middleware/concurrency.ts`) nos 2
webhooks — no máximo 4 em processamento ao mesmo tempo, excedente = `503`.

Defesa real contra brute force do código de recuperação: o cap por conta
(`RESET_CODE_MAX_ATTEMPTS = 5`, depois o código é queimado), não o limiter de IP.

## 5. Trust proxy

- `server.ts`: `app.set("trust proxy", trustProxy())`.
- `env.ts` `trustProxy()`: lê `TRUST_PROXY` (default **1**). Rejeita valores não
  numéricos e volta a 1. **Nunca `true`** — isso deixaria o cliente forjar
  `X-Forwarded-For` e furar os limiters.
- EasyPanel/Traefik e Cloud Run = 1 salto. Só aumente se houver mais (ex.:
  Cloudflare → Traefik → app = 2).

## 6. DTOs — nada de segredo para o browser

`src/server/dto/client.ts`:
- `clientSelfDTO` — portal do próprio cliente (`id,cnpj,name,email,regularityStatus,firstAccessDone,accountantCategory,notificationPreferences`).
- `clientAdminDTO` — painel do contador; expõe `hasIntegrationToken: boolean`,
  **nunca** o valor.
- `clientIntegrationDTO` — resposta de `sync-client` (`id,cnpj,name,regularityStatus`).

Nenhum handler faz `res.json({ client: <row do banco> })`. Campos que **nunca**
saem: `password_hash`, `integration_hash`, `integration_hash_digest`,
`reset_code_hash`, `reset_code_expires`, `reset_code_attempts`.
`serpro_config` é sanitizado à mão em `GET /api/pendencies/sitfis/config`
(`hasKey`/`hasSecret`/`hasCert`/`hasCertSenha`/`certMissing`).

## 7. Integration token

`src/server/services/integrationToken.ts`:
- `generateIntegrationToken()` → `"vic_" + crypto.randomBytes(32).base64url` (256 bits).
- Armazenado **só como `sha256` hex** em `clients.integration_hash_digest` (`unique`).
- `POST /api/accountant/client/:id/generate-token` devolve o token em texto
  **uma única vez**; `ClientDetail` mostra com botão copiar e depois "configurado
  (oculto)".
- `revoke-token` → `clearIntegrationToken()` limpa as duas colunas.
- Token colado no form de criar/editar cliente → hasheado na escrita
  (`setIntegrationToken`), nunca guardado em texto.
- **Transição:** a coluna `integration_hash` (plaintext legado) **ainda existe** e
  `findClientByIntegrationToken` faz fallback para ela — nenhuma integração
  antiga quebra. Migration `0001` faz backfill do digest.

## 8. Secretbox (criptografia em repouso)

`src/server/services/secretbox.ts` — AES-256-GCM:
- Chave = `sha256(process.env.SECRETS_KEY)` (aceita qualquer tamanho).
  **Chave dedicada — nunca `JWT_SECRET`.**
- Strings: formato `enc:v1:<iv b64>:<tag b64>:<ct b64>`.
- Bytes (arquivo `.pfx`): prefixo mágico `ENCv1\0` + iv + tag + ct.
- `decryptSecret`/`decryptBytes` leem valor legado sem prefixo como plaintext
  (transição sem migration).
- **Sem `SECRETS_KEY`:** `encryptSecret` é no-op (grava o valor cru) e loga
  warning; `decryptSecret` de um valor legado plaintext funciona.
- Cobertura: `serpro_config.consumer_secret`, `serpro_config.cert_senha`, e os
  bytes do certificado `.pfx` no disco. `consumer_key` **não** é cifrado (é
  identificador), mas **também não é devolvido ao frontend**.
- Leitura: `client.routes.ts` decripta em memória só na geração da guia;
  `serpro.ts` recebe o config já decriptado.

## 9. SECRETS_KEY

- Recomendado em produção (`env.ts` avisa se ausente). `openssl rand -base64 32`.
- Sem ela, os segredos SERPRO ficam em texto puro no banco/disco.
- **Não há rotação nem versionamento de chave.** Trocar `SECRETS_KEY` torna os
  valores já cifrados ilegíveis — seria preciso re-salvar a config SERPRO.

## 10. Uploads

`src/server/services/upload.ts`:
- multer `diskStorage` → `UPLOADS_DIR = process.cwd()/uploads`.
- Nome gravado: `Date.now()-crypto.randomUUID()-<sanitizeFilename(originalname)>`
  → **sem overwrite**, sem controle do nome pelo cliente.
- `sanitizeFilename`: `path.basename`, troca não-`[A-Za-z0-9._-]` por `_`, tira
  `.` inicial, corta em 120 chars → **anti path traversal**.
- `fileFilter` = whitelist `ALLOWED_UPLOAD_EXTENSIONS` (pdf, ofx, xml, p7s,
  imagens, xls/xlsx/ods, doc/docx/odt, zip, txt, csv). Bloqueia `.exe/.sh/.js/
  .html/.svg/.php` etc.
- `limits: { fileSize: 10 MB, files: 1 }`.
- Webhooks base64: checam `buffer.length > MAX_UPLOAD_BYTES` (413) +
  `isAllowedUploadName` + magic bytes.
- Body JSON global = 2 MB; só `/api/webhook/receitas` e `/documentos` ganham
  16 MB (registrado antes do parser global).

## 11. Magic bytes

`src/server/services/fileType.ts`:
- `sniffFamily(buf)` reconhece: pdf, png, jpeg, gif, bmp, tiff, webp, heic,
  zip (xlsx/docx/ods/odt/zip), ole2 (xls/doc).
- `contentMatchesExtension(buf, filename)`: se a extensão é verificável e os
  bytes não batem → `false`. Extensões sem assinatura confiável (xml, ofx, csv,
  txt, p7s) passam (a whitelist já cobre).
- Middleware `validateUploadedFileContent` (após `upload.single`): lê os
  primeiros 4 KB do arquivo gravado; se não bate → `415` + `unlink`.
- Ligado em: `/api/client/upload`, `/api/accountant/solicitacoes/:id`,
  `/upload-doc`, `/document/:id`, `/api/webhook/documentos` (multipart).

## 12. CNPJ

- Armazenado **só em dígitos** (14) em `clients.cnpj` (`unique`) — migration
  `0002_normalize_cnpj` (aborta sem meio-aplicar se a normalização colidir 2
  linhas).
- `normalizeCnpj` antes de todo insert/lookup; `formatCnpj` só para exibir;
  `cnpjMatches` para busca tolerante (`src/lib/cnpj.ts`).
- `findClientsByCnpj` (login/recuperação) normaliza em SQL (`regexp_replace`) —
  nunca carrega a tabela toda.
- Login aceita a senha-CNPJ com ou sem pontuação (retry sem dígitos).

## 13. Validação Zod

- `validateBody(zodSchema)` em `src/server/middleware/validate.ts` — 400 com
  `{ error, details: [{field, message}] }`, e substitui `req.body` pelo parseado
  (campos desconhecidos são descartados).
- `schemas/validation.ts` tem schema para **todo** endpoint de escrita
  (auth, clientes, documentos, mensagens, billing, webhooks, config SERPRO,
  notificações, integração).
- Rotas sem corpo (`generate-token`, `revoke-token`, `reset-password` do
  contador) não têm schema — só param.

## 14. Audit log

- `src/server/services/audit.ts` `logAudit(req, action, opts)` — insert
  best-effort em `audit_log` (falha de log nunca quebra a ação).
- `actor` = `"accountant"` \| `"client:<id>"` \| `"integration:<id>"`.
- Chamado em: `client.create`, `client.update`, `client.delete`,
  `client.reset_password`, `token.generate`, `token.revoke`, `files.bulk_delete`.
- Leitura: `GET /api/accountant/audit`. UI: `/admin/audit`.
- `audit_log` **não tem FK** para `clients` — a trilha sobrevive à exclusão.

## 15. Migrations de segurança

| Migration | O que faz |
|-----------|-----------|
| `0000_baseline` | schema completo alvo (FKs cascade, jsonb, uniques, colunas de reset code) |
| `0001_integration_hash_digest` | adiciona `integration_hash_digest` + backfill `sha256(integration_hash)` — sem quebrar webhook |
| `0002_normalize_cnpj` | `clients.cnpj` → só dígitos; aborta se colidir |
| `0003_auth_sessions` | cria `auth_sessions` (refresh token hasheado + rotação + reuso + revogação) |
| `reconcile-legacy.sql` | bridge idempotente para bancos criados pelo `initDb` antigo (cria `audit_log`, adiciona colunas, renomeia `reset_token`→`reset_code_hash`, `json`→`jsonb`, normaliza FKs para cascade) — **não** apaga nada; `auth_sessions` vem depois pelo `0003` |

Testado contra Postgres real (pglite) em `migrations.test.ts` (fresh + legado,
preservação de dados, cascade) e `session.test.ts` (rotação + detecção de reuso
+ revogação).

## 16. Outras proteções

- `helmet()` + **CSP ligada por padrão** (`CSP_ENABLED=false` desativa).
  `dist/index.html` não tem script inline (polyfill de module-preload off, SW
  registrado do `main.tsx`) → `script-src 'self'` sem hash. `worker-src blob:`
  p/ pdf.js, `connect-src` inclui o domínio da API (Capacitor).
- CORS: `origin` = `CORS_ORIGINS` (lista) em prod (**boot recusado sem ela**);
  `origin:false` de backstop em prod; `true` (reflete) só em dev.
- `validateEnv()` recusa boot em produção sem `JWT_SECRET`/`ADMIN`/`PASSWORD`/
  `DATABASE_URL`/`CORS_ORIGINS` reais (rejeita valores de exemplo conhecidos).
- Error handler central: `MulterError`/erros 4xx explícitos → status limpo;
  resto → 500 genérico em produção (não vaza stack). Webhooks não devolvem
  `e.message`.
- `pool.on("error")` + `unhandledRejection` logam sem derrubar;
  `uncaughtException` → shutdown controlado + `exit(1)`.
- `requestLog` (`X-Request-Id` + log por request); SERPRO `httpsPost` com
  timeout de 30 s.
- `/uploads` bloqueado (404); download só via endpoint autenticado.

---

## Pendências conhecidas (NÃO resolvidas)

1. **`integration_hash` plaintext legado** ainda é aceito no lookup (fallback de
   transição). Vetor até ser removido por migration futura.
2. **`SECRETS_KEY` em produção** — precisa ser definido **e** a config SERPRO
   re-salva para cifrar os valores que já existem. Sem isso, `consumer_secret` /
   `cert_senha` / `.pfx` ficam em texto puro.
3. **Sem rotação de `SECRETS_KEY`** — trocar a chave quebra a leitura dos valores
   cifrados (exige re-salvar a config).
4. **Desafio de 2FA em memória** — reinício do servidor entre senha e código
   força o contador a recomeçar o login. Aceitável (1 conta, TTL 10 min); não é
   persistido em tabela de propósito.
5. **Storage seguro no Capacitor** — o `apiClient` usa `SecureStoragePlugin`
   **se** o wrapper nativo fornecer; senão cai no `localStorage` da WebView. O
   wrapper (fora deste repo) precisa incluir o plugin.
6. **Cutover das migrations em produção** — `0000`/reconcile/`0001`/`0002`/`0003`
   **não** rodaram contra a base real (branch não deployada). Rodar antes contra
   uma **cópia** e confirmar `[migrate] schema verified` sem warnings. Conferir
   a conversão `reset_code_expires` text→timestamp em bases legadas.
7. **`VAPID_*` não fixados** em produção → push web quebra a cada restart.
8. **`migrations.test.ts`** (pglite/WASM) é lento e pode dar timeout sob carga
   no CI.
9. **Fluxo access+refresh + 2FA** ainda **não** foi testado ponta-a-ponta num
   ambiente real (sem DB nesta sessão) — ver checklist em `docs/CHANGELOG.md` /
   a revisão. Os testes unitários cobrem rotação, reuso, revogação e o ciclo do
   desafio de 2FA.
