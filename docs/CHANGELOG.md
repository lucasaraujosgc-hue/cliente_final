# CHANGELOG.md

Registro das alterações relevantes. Não lista cada arquivo — ver `git log` para
detalhe. Datas relativas convertidas: trabalho feito em agosto/2026.

---

## Branch `improvements` (não mergeada / não deployada)

Estado alvo desta branch: endurecimento de segurança + migração para Drizzle
como fonte de verdade do schema + doc técnica. (Ver `git log main..HEAD` para a
lista exata de commits.)

### Revisão pós-implementação (ajustes)
- Webhooks (`/api/webhook/receitas` e `/documentos`) não devolvem mais
  `e.message` ao chamador — resposta genérica, detalhe só no log do servidor.
- `CORS_ORIGINS` agora é **obrigatório em produção** (`validateEnv()` recusa o
  boot). `server.ts` também deixou de cair para `origin: true` em produção
  quando a lista está vazia (backstop → `origin: false`).
- Uploads rejeitados (extensão fora da whitelist, acima de 10 MB) retornam
  **4xx** (`415`/`413`) com mensagem clara em vez de `500` genérico —
  `uploadFileFilter` marca o erro com `status` e o error handler central trata
  `MulterError` e erros 4xx explícitos.
- `serpro.ts` `httpsPost` ganhou timeout de 30 s (`req.on("timeout")` →
  `req.destroy`) — chamada SERPRO travada não prende mais a requisição.
- `SetupProfile` e o modal "Alterar Senha" validam `minLength` 8 da nova senha
  no cliente (antes só o Zod barrava, com erro "Dados inválidos.").

### Navegação mobile-first da área do cliente
- `ClientLayout` agora tem **duas molduras** para a mesma lista de rotas, corte
  no breakpoint **`lg` (1024px)**:
  - **< lg (celular + tablet):** header compacto (`h-12`, nome da empresa +
    Sair) + conteúdo + **bottom nav** fixa (`Visão Geral / Atrasados / Cofre /
    Envios`), `pb-[env(safe-area-inset-bottom)]` própria. A bottom nav é um
    `flex` sibling do scroll (não `position:fixed`), então nunca esconde
    conteúdo.
  - **≥ lg:** **sidebar** `lg:w-60` (logo, 4 itens com rótulos completos,
    rodapé: nome + Alterar senha + Notificações + Sair). Sem header.
- **Engrenagem + sino saíram do header no mobile** → agora ficam na tela "Visão
  Geral" (`client/Dashboard.tsx`, ao lado do botão Atualizar). A engrenagem
  dispara `open-password-change-modal` (modal continua no `ClientLayout`).
- Removidos `renderSidebarContent()` / `mobileSidebarOpen` / `desktopSidebarOpen`
  (código morto). `Dashboard` trocou `pb-24` por `pb-6`.
- Verificado no browser em 375 / 900 / 1280 px: bottom nav ↔ sidebar troca no
  `lg`, active state, navegação entre rotas, gear→modal, sessão sobrevive a
  reload (sessionStorage quando "não lembrar").
- `[PLANEJADO]`: badge de contagem em "Atrasados" (a contagem precisa chegar ao
  layout — hoje só o Dashboard/Overdue a têm).

### Sessão: access token + refresh token + 2FA do contador
- **Access token** curto (JWT, 15 min) + **refresh token** opaco (`vrt_…`,
  256 bits, ~90 dias) guardado só como `sha256` na nova tabela `auth_sessions`
  (migration `0003`). Mesmo mecanismo em toda plataforma.
- **Rotação a cada uso** em `POST /api/auth/refresh` + **detecção de reuso**
  (`previous_refresh_hash`): apresentar um token já rotacionado revoga a sessão.
- `POST /api/auth/logout` revoga a sessão no servidor. Reset de senha (self +
  pelo contador) e exclusão de cliente revogam/apagam as sessões do cliente.
- `middleware/auth.ts`: `verifyAccessToken` unificado; `401 { code:
  "token_expired" }` distingue token expirado de ausente/inválido; papel errado
  → `403`.
- **2FA do contador por e-mail** (`services/accountantMfa.ts`): `login` valida
  usuário/senha e devolve `{ mfaRequired, challengeId }`; `POST
  /api/auth/accountant/verify` confirma o código de 6 dígitos e só então emite
  o par. Desafio em memória (1 conta, TTL 10 min, cap 5 tentativas). Ligado por
  padrão quando há `ACCOUNTANT_MFA_EMAIL`/`EMAIL_USER`; `ACCOUNTANT_2FA=off`
  desliga.
- Frontend (`lib/apiClient.ts` reescrito): token em memória (leitura síncrona)
  + persistência por plataforma (localStorage/sessionStorage na web/PWA;
  `SecureStoragePlugin` no Capacitor quando disponível). `apiFetch` renova o
  access **automaticamente** em `401` (single-flight) e repete a request; só
  dispara `unauthorized` se o refresh falhar. Removido o monkey-patch de
  `window.fetch` em `main.tsx`. `PixScannerButton` renova o token antes de
  entregar ao pdf.js.
- `Auth.tsx` + novo `components/MfaCodeForm.tsx`: passo de código no login do
  contador (e no atalho admin pelo form do cliente).
- `refreshLimiter` (60/15min). `EXPECTED_TABLES` do `migrate.ts` inclui
  `auth_sessions`.
- Testes: `session.test.ts` (rotação/reuso/revogação, pglite), 
  `accountantMfa.test.ts` (ciclo do desafio + gating por env).

### Endurecimento — 2ª rodada
- **`uncaughtException`** agora derruba o processo de forma controlada
  (`server.close()` + `exit(1)`, com timer de força) em vez de só logar — deixa
  o orquestrador reiniciar limpo. `unhandledRejection` continua só logando.
- **Busca de CNPJ** (`findClientsByCnpj`) passou a usar `eq(clients.cnpj, …)` no
  índice único em vez de `regexp_replace(...)` (seq scan por login). Seguro
  porque `cnpj` é dígitos-only desde a migration 0002 + `normalizeCnpj` em todo
  insert.
- **CSP ligada por padrão** (`CSP_ENABLED=false` para desativar). Diretivas
  ajustadas: `worker-src 'self' blob:` (pdf.js), `connect-src` inclui o domínio
  absoluto da API (build Capacitor). `vite.config` desliga o polyfill de
  module-preload e o `index.html` não registra mais o SW inline — o
  `dist/index.html` fica **sem nenhum script inline**, então `script-src 'self'`
  funciona sem hash. Verificado no browser: SPA carrega sob a CSP de produção.
- **Observabilidade** (`services/logger.ts` + `middleware/requestLog.ts`): cada
  requisição recebe um `X-Request-Id` (ou honra o de um proxy) e gera uma linha
  de log com método/rota/status/ms; o error handler central loga com o mesmo id.
- **Cap de concorrência nos webhooks** (`middleware/concurrency.ts`
  `inFlightLimit(4)`): além do rate limit por IP, no máximo 4 requisições de
  webhook em processamento ao mesmo tempo — excedente recebe `503` + `Retry-After`.
- **Code splitting**: `date-fns` virou chunk próprio (deduplica entre rotas
  lazy); `chunkSizeWarningLimit` 700 (os chunks `pdf`/`xlsx` são grandes mas
  lazy). Nenhuma mudança de navegação/UI.

### Segurança — exposição de dados / DTOs
- Criado `src/server/dto/client.ts` (`clientSelfDTO`, `clientAdminDTO`,
  `clientIntegrationDTO`). **Nenhum endpoint devolve mais a row crua de
  `clients`.** `serpro_config` sanitizado à mão no GET (só flags `hasKey` etc.).
- Campos que nunca saem para o browser: `password_hash`, `integration_hash(+digest)`,
  `reset_code_hash/expires/attempts`, segredos SERPRO.

### Segurança — token de integração
- `src/server/services/integrationToken.ts`: token CSPRNG (`vic_` + 256 bits),
  armazenado só como `sha256` em `clients.integration_hash_digest`.
- `generate-token` devolve o token **uma vez**; `revoke` limpa; token colado no
  form é hasheado na escrita.
- **Transição:** `integration_hash` plaintext legado ainda é aceito no lookup
  (`findClientByIntegrationToken` faz fallback) — webhooks não quebram.
- Migration `0001_integration_hash_digest` faz backfill do digest.
- `ClientDetail` mostra o token uma vez (com botão copiar) e depois "oculto".

### Segurança — recuperação de senha
- Código de 6 dígitos via `crypto.randomInt` (era `Math.random`).
- Armazenado só como `sha256(código + pepper)`; comparação `timingSafeEqual`.
- Uso único (queimado no reset); TTL 15 min (era 1 h); cap de 5 tentativas por
  código; cooldown de reenvio 60 s.
- `forgot-password` responde **idêntico** para CNPJ existente / inexistente / sem
  e-mail (anti-enumeração); o trabalho variável roda depois da resposta.
- `reset-password` dá um único erro genérico para qualquer falha.
- Colunas: `reset_token`→`reset_code_hash`, `reset_token_expires`→
  `reset_code_expires` (timestamp), novo `reset_code_attempts`.
- Rate limiters dedicados: `passwordResetRequestLimiter` (5/1h),
  `passwordResetSubmitLimiter` (15/15min).

### Segurança — JWT fora da query string
- `verifyClientAuth`/`verifyAccountantAuth`/`verifyAnyAuth` leem **só** o header
  `Authorization: Bearer`. Removido o fallback `req.query.token`.
- `apiClient.ts`: novo `openDocument()` (fetch autenticado → blob),
  `documentAuthHeaders()` para pdf.js. `documentFileUrl()` agora é sem token.
- Todos os links/downloads de documento migrados para `openDocument()`.
- `PixScannerButton` passa `documentAuthHeaders()` ao `pdfjs.getDocument`.
- Removida a `handleFileAction()` antiga (baseada em URL).

### Segurança — documentos privados
- `/uploads` **deixou de ser servido estaticamente** (retorna 404).
- Novo `GET /api/documents/:id/file` (`src/server/routes/files.routes.ts`):
  `verifyAnyAuth` + autorização por documento (cliente só vê o seu, contador vê
  todos); 404 se não existe, 403 se existe mas não é dele.
- Path resolvido **só** de `documents.fileUrl` (nunca do request); trata
  `data:` URI, ponteiro de guia (`/api/pendencies/guia/:id/pdf`) e
  `/uploads/<nome>` (via `resolveUploadPath`, basename-only, traversal-safe,
  streaming — `fs.createReadStream`).
- Endpoint de PDF de guia endurecido: resolve só dentro de `GUIAS_PDF_DIR`, sem
  redirect para URL arbitrária.

### Segurança — uploads
- Whitelist de extensão (`ALLOWED_UPLOAD_EXTENSIONS`), cap 10 MB, `files: 1`,
  nome de arquivo aleatório (`Date.now()-uuid-<sanitizado>` — sem overwrite,
  sem path traversal).
- Novo `src/server/services/fileType.ts` (magic bytes) + middleware
  `validateUploadedFileContent` (lê 4 KB, 415 + apaga se o conteúdo não bate com
  a extensão). Ligado em todas as rotas de upload de documento.
- Webhooks base64: checam tamanho decodificado (413) + extensão + magic bytes.
- Corrigido bug latente: `/api/webhook/documentos` multipart lia
  `req.file.buffer` (undefined com diskStorage).

### Segurança — segredos SERPRO em repouso
- Novo `src/server/services/secretbox.ts`: AES-256-GCM com `SECRETS_KEY`
  **dedicada** (nunca `JWT_SECRET`).
- `consumer_secret` e `cert_senha` cifrados (`enc:v1:...`); o `.pfx` reescrito
  cifrado no disco (magic `ENCv1\0`), decifrado só em memória para o `https.Agent`.
- `GET /api/pendencies/sitfis/config` não devolve mais nenhuma credencial —
  só flags (`hasKey`/`hasSecret`/`hasCert`/`hasCertSenha`/`certMissing`) + os
  campos não-secretos (`ambiente`, `whatsappSupport`, `multipleFilesText`, `updatedAt`).
- Campos de credencial no `Settings.tsx` viraram write-only ("deixe em branco
  para manter").
- Sem `SECRETS_KEY`: no-op + warning; leitura de valor legado plaintext continua
  funcionando (transição sem migration).

### Segurança — infra
- `trust proxy` agora vem de `env.trustProxy()` (`TRUST_PROXY`, default 1,
  rejeita `true`).
- `express.json` global 12 MB → 2 MB; só os 2 webhooks base64 ganham 16 MB
  (registrado antes do parser global).
- `fs.*Sync` em rotas HTTP → `fs.promises` (`fileSizeFor`, bulk-delete, writers
  de webhook).
- `validateEnv()` (`src/server/env.ts`): recusa boot em produção sem
  `JWT_SECRET`/`ADMIN`/`PASSWORD`/`DATABASE_URL` reais; `CORS_ORIGINS` requerido;
  recomenda `SECRETS_KEY`/`VAPID_*`.
- `helmet()` adicionado; CSP opt-in (`CSP_ENABLED=true`).
- `pool.on("error")` + handlers globais de rejeição (logam, não derrubam).

### Segurança — CNPJ
- Armazenado **só em dígitos** (14). Migration `0002_normalize_cnpj` (aborta sem
  meio-aplicar se colidir 2 linhas).
- `src/lib/cnpj.ts` (`normalizeCnpj`/`formatCnpj`/`cnpjMatches`) — compartilhado
  cliente+servidor; `vitest.config` passou a incluir `src/lib/**`.
- Inserts + `sync-client` normalizam; login aceita a senha-CNPJ com pontuação.
- UI do contador formata para exibir; busca casa os dois formatos.

### Segurança — validação
- `validateBody(zodSchema)` adicionado em **todo** endpoint de escrita antes sem
  validação (auth, clientes, documentos, mensagens, billing, webhooks, config
  SERPRO, notificações, integração). Rotas multipart validam `req.body` após o
  multer.

### Banco — Drizzle como fonte de verdade
- `initDb()` **não cria/altera mais o schema** — só testa a conexão.
- `drizzle/0000_baseline.sql` regenerado do `schema.ts` corrigido (FKs cascade,
  `jsonb` onde deve, uniques, colunas de reset code).
- `drizzle/reconcile-legacy.sql`: bridge idempotente e aditiva para bancos
  criados pelo `initDb` antigo (cria `audit_log`, adiciona colunas, renomeia o
  par `reset_token`, `json`→`jsonb`, normaliza FKs). **Não apaga nada.**
- `scripts/migrate.ts`: runner com detecção de banco legado → aplica o reconcile
  → marca o baseline → roda `0001+` → verifica o schema.
- `scripts/seed.ts` (`npm run db:seed`) — dados demo tirados do `initDb`.
- Hooks `predev`/`prestart` rodam `db:migrate`; `build` também gera
  `dist/migrate.cjs`; Dockerfile copia `drizzle/` e migra no `prestart`.
- `src/server/services/__tests__/migrations.test.ts`: testa `0000→0002` +
  reconcile contra Postgres real (`@electric-sql/pglite`).

### Frontend — alterações relevantes
- `App.tsx`: todas as rotas com `React.lazy` + `<Suspense>`; `vite.config`
  `manualChunks` (react, recharts, xlsx, pdfjs).
- Nova página `/admin/audit` (`accountant/Audit.tsx`) + item "Histórico" na
  sidebar; `accountant/Dashboard.tsx` ganhou KPI row + "Atividade recente".
- Novo `<Logo>` (wordmark "Vírgula," Fraunces + accent) substituindo o ícone
  `Calculator` do lucide em Auth, SetupProfile e nos dois Layouts.
- `Skeleton.tsx` (loading do Suspense e do Dashboard).
- Todos os `fetch` crus do frontend migrados para `apiFetch()`.
- Banner "senha inicial = CNPJ" some após o primeiro acesso.
- `main.tsx` mantém o monkey-patch de `window.fetch` (evento `unauthorized`).

### Backend — refactor
- `src/server/types.ts`: tipos inferidos do schema + augment de
  `Express.Request` + `getAuth`/`getClientId`/`getIntegrationClient`.
- `src/server/services/billing.ts` `upsertBilling()` — única escrita de
  `billing_data` (4 call sites deduplicados).
- `(req as any)` removido dos handlers.
- Arquivos mortos removidos (`src/server/index.ts`, `src/scripts/restore_*.ts`).

### Bugfixes
- Rules-of-hooks nos dois Layouts (early-return depois dos hooks).
- Ordem `CREATE`/`ALTER` no `initDb` antigo (agora irrelevante — DDL saiu do boot).
- `PORT` respeita `process.env.PORT`.
- `subscribeToPush()` não re-inscreve em todo mount (só se já concedido).

### Documentação
- `CLAUDE.md` reescrito (mais curto, seções objetivas).
- Criados `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
  `docs/MOBILE_APP.md`, `docs/CHANGELOG.md`.
- `MIGRATIONS.md` atualizado (0001/0002 + transição do token).
- `.env.example` atualizado (`SECRETS_KEY`, `TRUST_PROXY`, `CSP_ENABLED`,
  `PASSWORD_RESET_PEPPER`).

---

## Antes desta branch (em `main`)

O `main` traz o portal funcional (cliente + contador), integração SERPRO, push,
PWA e o `initDb()` legado que criava/alterava tabelas no boot. A partir desta
branch isso muda: o schema passa a evoluir só por migrations Drizzle.
