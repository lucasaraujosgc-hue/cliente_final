# CLAUDE.md

Map of the system. Read this first, then the deeper docs in `docs/` when you
need detail:

- `docs/PROJECT_CONTEXT.md` — what it is, who uses it, flows, current state
- `docs/ARCHITECTURE.md` — real frontend/backend/DB structure
- `docs/SECURITY.md` — auth, tokens, encryption, uploads, known pendências
- `docs/MOBILE_APP.md` — navigation, Capacitor, PWA (what's real vs planned)
- `docs/CHANGELOG.md` — recent significant changes
- `MIGRATIONS.md` — how the DB schema evolves

> Current work is on branch **`improvements`** (segurança + migrations Drizzle +
> esta doc; à frente de `main`, ainda não mergeada/deployada). CI roda em `main`.

## Objetivo

**Vírgula Contábil – Portal do Cliente**: portal de um escritório de contabilidade
brasileiro. Dois públicos no mesmo app:

- **Cliente**: vê suas guias/impostos, vencimentos, cofre digital de documentos,
  envia extratos bancários, preenche faturamento mensal, fala com o contador.
- **Contador** (uma única conta admin): gerencia clientes, publica documentos,
  processa a inbox de uploads dos clientes, envia notificações, configura a
  integração SERPRO.

Meta: dar ao cliente uma visão calma e **mobile-first** de "o que devo, quando,
minha empresa está regular?" e ao contador um lugar só para atender todos.

## Stack

| Camada | Escolha |
|--------|---------|
| Frontend | React 19 SPA, Vite 6, react-router-dom 7, Tailwind v4 (`@theme` em `src/index.css`), lucide-react, Recharts, `motion` |
| Backend | Express 4, processo único, `server.ts` na raiz |
| DB | Postgres via Drizzle ORM (`drizzle-orm/node-postgres`) |
| Auth | Access token JWT 15min + refresh token opaco 90d (rotação + detecção de reuso, tabela `auth_sessions`); header `Authorization: Bearer` apenas; 2FA por e-mail no login do contador; token de integração (digest) para chamadas máquina-a-máquina |
| Entrega | PWA (`public/sw.js`, `public/manifest.json`); wrapper Capacitor Android/iOS **fora deste repo** (o SPA é "Capacitor-aware") |
| Push | `web-push` (navegador) + Firebase Admin FCM (mobile) |
| Email | Nodemailer (SMTP) + Resend |
| Externo | SERPRO **Integra Contador** (gera guias DAS/DCTFWEB) |
| Deploy | Docker → Cloud Run / EasyPanel |

## Arquitetura geral

```
Browser/App  →  Express (server.ts)  →  routes/*  →  services/*  →  Drizzle  →  Postgres
                     │
                     ├─ dev: middleware do Vite serve o SPA
                     └─ prod: express.static(dist/) + SPA fallback
```

- Frontend: SPA. Cada página busca seus dados com `apiFetch()` (`src/lib/apiClient.ts`).
  Sem Redux/Zustand — estado local por página + `localStorage`/`sessionStorage`
  para o token/usuário + alguns `window` custom events.
- Backend: `server.ts` monta helmet/CORS/rate-limit, e `setupRoutes()` registra
  7 módulos de rota. Handlers: `verify*Auth` → `validateBody(zod)` → lógica →
  `services/*` → `db`. Nunca devolvem row crua de `clients`/`serpro_config`
  (usam DTO / objeto sanitizado).
- DB: schema em `src/server/schema.ts` é a ÚNICA fonte de verdade. Evolução só
  por migrations Drizzle (`npm run db:migrate`). O servidor **não** altera o
  schema no boot.

## Diretórios principais

```
server.ts                     bootstrap
src/
  App.tsx                     rotas (todas lazy + Suspense)
  main.tsx                    registra SW + monkey-patch de fetch p/ evento "unauthorized"
  index.css                   tokens Tailwind @theme + safe-area no <body>
  lib/
    apiClient.ts              apiFetch(), openDocument(), documentAuthHeaders() — SEMPRE usar
    cnpj.ts                   normalizeCnpj / formatCnpj / cnpjMatches (compartilhado)
    utils.ts                  cn()
  components/
    Layouts.tsx               ClientLayout + AccountantLayout (guarda de rota + chrome)
    Logo.tsx, Skeleton.tsx, ThemeToggle.tsx
    PixScannerButton.tsx      lê PIX de PDF com pdf.js (recebe documentAuthHeaders())
    GuiaAtualizarButton.tsx   dispara recálculo de guia SERPRO
  pages/
    Auth.tsx                  /login (cliente) + /admin/login (contador) + fluxo recuperar senha
    client/                   Dashboard, Overdue, Vault, MyUploads, SetupProfile
      dashboard/*             sub-componentes do Dashboard do cliente
    accountant/               Dashboard(Inbox), ClientsList, ClientDetail, Notifications,
                              FileGallery, Devices, Settings, Audit
  server/
    db.ts                    pg Pool + drizzle; initDb() só testa conexão
    schema.ts                schema Drizzle (10 tabelas)
    env.ts                   validateEnv() (fail-fast em prod), corsOrigins(), trustProxy(), PORT
    types.ts                 augment de Express.Request + getAuth/getClientId/getIntegrationClient
    middleware/              auth.ts, rateLimit.ts, validate.ts
    routes/                  index.ts + auth/client/accountant/integration/webhook/notifications/files
    schemas/validation.ts    schemas zod — TODO endpoint de escrita tem um
    dto/client.ts            clientSelfDTO / clientAdminDTO / clientIntegrationDTO
    services/                billing, audit, password, resetCode, integrationToken, secretbox,
                             upload, fileType, files, mailer, push, serpro, notificationSweeper
    qrExtractor.ts           extrai PIX copia-e-cola do PDF de uma guia
drizzle/                     migrations (fonte de verdade) + reconcile-legacy.sql
scripts/                     migrate.ts (db:migrate), seed.ts (db:seed), migrate-passwords.ts
```

## Comandos

```bash
npm run dev        # predev roda db:migrate; depois tsx server.ts em :3000 (precisa DATABASE_URL)
npm run lint       # tsc --noEmit — rodar antes de commitar
npm test           # vitest (src/server/**/*.test.ts + src/lib/**/*.test.ts); migrations.test.ts usa pglite
npm run build      # vite build + esbuild → dist/server.cjs e dist/migrate.cjs
npm start          # prestart roda dist/migrate.cjs; depois node dist/server.cjs
npm run db:generate / db:migrate / db:seed / db:studio
```

Dev sem DB real: aponte `DATABASE_URL` para um Postgres descartável (Neon/Supabase
free). `npm run db:migrate` cria o schema; `npm run db:seed` insere 2 clientes
demo (CNPJ `12345678000199`, senha = o mesmo CNPJ).

## Regras de desenvolvimento

1. **Primeiro entenda o código atual.** Antes de mexer numa API, `grep` por
   todas as referências (frontend + backend + testes).
2. **Não reescreva funcionalidade que já funciona** sem necessidade. Mudanças
   incrementais.
3. **Preserve compatibilidade** — especialmente webhooks e integrações. Se
   precisar de transição, implemente o fallback e documente.
4. **Rode `npm run lint` e `npm test` após qualquer alteração.**
5. **Não invente funcionalidade.** Não documente/assuma como pronto o que não
   está no código.
6. **Não desative validações/testes** para fazer algo passar.
7. Frontend chama API só via `apiFetch()`; documentos abrem só via
   `openDocument()`.
8. Schema muda só via `schema.ts` + `npm run db:generate` + revisar o `.sql`.
   O servidor não toca o schema.
9. `initDb()` **não cria tabelas** — só verifica conexão.

## Regras de segurança (resumo — detalhe em `docs/SECURITY.md`)

- Auth é **só header** `Authorization: Bearer`. Nada de `?token=`.
- Sessão = access JWT 15min + refresh opaco (hasheado em `auth_sessions`,
  rotacionado a cada `/api/auth/refresh`, reuso revoga a sessão). `apiFetch`
  renova sozinho em 401. Login do contador tem 2FA por e-mail (`/verify`).
- **Nunca** devolver row crua de `clients`/`serpro_config` ao browser — usar DTO.
  Segredos (passwordHash, integration digest, resetCodeHash, secrets SERPRO)
  nunca saem do servidor.
- Todo POST/PUT tem `validateBody(zodSchema)`.
- Uploads: `upload.single()` → `validateUploadedFileContent` (magic bytes) →
  `validateBody()`. Whitelist de extensão + cap 10 MB + nome aleatório.
- `/uploads` **não** é público. Download só por `GET /api/documents/:id/file`
  (auth + autorização por documento; path resolvido do banco, nunca do request).
- Segredos SERPRO cifrados em repouso via `SECRETS_KEY` (chave dedicada, nunca
  `JWT_SECRET`).
- `trust proxy` = `TRUST_PROXY` (default 1). Nunca `true`.
- `logAudit()` nas ações sensíveis do contador.
- Prod não sobe sem `JWT_SECRET`/`ADMIN`/`PASSWORD`/`DATABASE_URL`/`CORS_ORIGINS`.

## Prioridade mobile / comportamento esperado

O produto principal é o **cliente no celular** (via app Capacitor, mantido fora
deste repo, ou PWA instalada). Ver `docs/MOBILE_APP.md`.

- **Área do cliente** (`ClientLayout`): corte no breakpoint `lg` (1024px).
  **< lg** (celular + tablet) = header compacto (nome + sair) + conteúdo +
  **bottom nav** (Visão Geral / Atrasados / Cofre / Envios). **≥ lg** =
  **sidebar** (rótulos completos + rodapé com Alterar senha / Notificações /
  Sair). Engrenagem e sino ficam na tela "Visão Geral" no mobile.
- **Área do contador** (`AccountantLayout`): desktop = sidebar fixa à esquerda;
  mobile = botão hambúrguer → drawer deslizante. Header com toggle + tema.
- Safe areas: `<body>` usa `env(safe-area-inset-*)`; `index.html` tem
  `viewport-fit=cover`, `user-scalable=no`.
- Botão voltar do Android: comportamento padrão do WebView/Capacitor — **sem
  handler custom** `[PLANEJADO]`.
- Gestos custom: nenhum `[PLANEJADO]`.

## Não quebrar o que já funciona

- Login do cliente aceita CNPJ com ou sem pontuação (há retry sem dígitos).
- Webhooks (`/api/webhook/*`) e integração (`/api/integration/*`) autenticam por
  token de integração; o `integration_hash` plaintext legado **ainda é aceito**
  (fallback de transição) — não remova.
- `documents.fileUrl` pode ser `/uploads/<nome>`, `data:...`, ou
  `/api/pendencies/guia/<id>/pdf` — o endpoint de download trata os três.
- `billing_data` tem o modelo "services" novo + colunas legadas
  `revenue/expenses/payroll` mantidas em sincronia — escrever só via
  `upsertBilling()`.

## Vocabulário do domínio

- **guia** – guia de pagamento de tributo (DAS p/ Simples, DCTFWEB p/ INSS).
  Gerada via SERPRO; o PDF carrega um PIX copia-e-cola.
- **competência** – mês de referência da obrigação (`MM/YYYY`).
- **regularidade** – status de conformidade do cliente: `green` / `warning` / `red`.
- **SITFIS** – relatório de situação fiscal da Receita, chega por webhook.
- **pendência / solicitação** – cliente pedindo ao contador para (re)calcular.
