# MOBILE_APP.md

Estratégia mobile e o que **de fato** existe no código hoje (branch
`improvements`). Tudo que ainda não está implementado está marcado `[PLANEJADO]`.

---

## Produto principal

O usuário-alvo é o **cliente no celular**. Duas formas de entrega:

1. **App Android/iOS via Capacitor** — é o produto principal pretendido, mas o
   **projeto wrapper Capacitor não está neste repositório** (ver §Capacitor).
2. **PWA** instalável (funciona hoje; ver §PWA).

O SPA (`src/`) é servido igual nos dois casos; alguns pontos do código detectam
`window.Capacitor` e mudam de comportamento.

---

## Navegação

### Área do cliente (`ClientLayout` em `src/components/Layouts.tsx`)

Uma lista de rotas (`nav`), duas molduras. O corte é no breakpoint **`lg`
(1024 px)** — celular **e tablet** usam a bottom nav; só desktop / PWA em janela
larga usa a sidebar.

```
Celular + tablet (< lg):            Desktop / PWA (≥ lg):
┌────────────────────────┐          ┌────────┬──────────────────┐
│ <nome empresa>  [Sair] │  h-12    │ Vírgula,│                  │
├────────────────────────┤          │ Visão   │                  │
│                        │          │ Atrasad.│    <Outlet />     │
│      <Outlet />        │          │ Cofre D.│                  │
│                        │          │ Envios  │                  │
├────────────────────────┤          ├────────┤                  │
│ Visão · Atras · Cofre  │ bottom   │ <nome>  │                  │
│  · Envios              │ nav      │ ⚙ 🔔 Sair│                  │
└────────────────────────┘          └────────┴──────────────────┘
```

- **Bottom nav** (`lg:hidden`, `flex` sibling do scroll — não é `position:
  fixed`, então o conteúdo nunca fica escondido atrás dela). 4 itens: `Visão
  Geral / Atrasados / Cofre / Envios`. Item ativo em `virgula-green`.
  `padding-bottom: env(safe-area-inset-bottom)` próprio.
- **Sidebar** (`hidden lg:flex lg:w-60`): logo, 4 itens (`Visão Geral /
  Atrasados / Cofre Digital / Meus Envios`), rodapé com nome da empresa +
  Alterar senha + Notificações + Sair.
- **Engrenagem e sino** saíram do header no mobile — vivem na tela **Visão
  Geral** (`client/Dashboard.tsx`, ao lado do botão Atualizar). A engrenagem
  dispara `open-password-change-modal` (o modal continua no `ClientLayout`); o
  sino abre o modal de preferências de push. No desktop, ambos ficam no rodapé
  da sidebar.
- **Header mobile** (`h-12`, `lg:hidden`): só nome da empresa + Sair.
- `renderSidebarContent()` / `mobileSidebarOpen` (código morto) foram removidos.
- `[PLANEJADO]` badge com a contagem de guias atrasadas no item "Atrasados"
  (precisa a contagem chegar ao layout — hoje só o Dashboard/Overdue a têm).

#### Área do contador (`AccountantLayout`)

```
Desktop (md+):                        Mobile (<md):
┌────────┬─────────────────────┐      ┌─────────────────────────┐
│ Logo   │ [☰] Contador  [🌓]   │      │ [☰] Contador     [🌓]    │  header
│ Inbox  ├─────────────────────┤      ├─────────────────────────┤
│ Client.│                     │      │                         │
│ Notif. │     <Outlet />      │      │      <Outlet />          │
│ Galer. │                     │      │                         │
│ Disp.  │                     │      │  [☰] abre drawer         │
│ Hist.  │                     │      │  deslizante (w-64) com   │
│ Config │                     │      │  o mesmo menu            │
└────────┴─────────────────────┘      └─────────────────────────┘
```

- Desktop: `<aside class="hidden md:flex md:w-64">` — sidebar escura fixa,
  colapsável pelo `[☰]` do header (`desktopSidebarOpen`).
- Mobile: `[☰]` (`Menu`) → drawer `md:hidden` (`mobileSidebarOpen`) com backdrop.
- Header tem `<ThemeToggle />` (claro/escuro). O layout do cliente **não** tem
  toggle de tema visível.

---

## Capacitor

**Não está no repositório.** Verificável:

```
$ ls capacitor.config.* android/ ios/     → não existem
$ grep '@capacitor' package.json          → nada
```

O que existe no código web (detecção defensiva de `window.Capacitor`):

| Arquivo | Comportamento quando Capacitor está presente |
|---------|----------------------------------------------|
| `src/lib/apiClient.ts` `getApiUrl()` | usa base absoluta `https://cliente.virgulacontabil.com.br` em vez de mesma origem |
| `src/pages/client/Dashboard.tsx` `subscribeToPush()` / `checkPushState()` | usa `window.Capacitor.Plugins.PushNotifications` (FCM): `checkPermissions` → `requestPermissions` → `register` → escuta `registration` → envia `fcmToken` para `POST /api/notifications/subscribe` |

Ou seja: o SPA está preparado para rodar dentro de um WebView Capacitor com o
plugin `@capacitor/push-notifications`, mas o build nativo em si é mantido fora
(ou ainda `[PLANEJADO]`).

`[PLANEJADO]` para uma futura versão nativa:
- `capacitor.config.ts` versionado (ou link ao repo que o mantém);
- plugins: `@capacitor/push-notifications`, `@capacitor/app` (botão voltar),
  `@capacitor/status-bar`, `@capacitor/splash-screen`, possivelmente
  `@capacitor/filesystem`/`@capacitor/camera` para upload;
- `server`/`allowNavigation` apontando para `cliente.virgulacontabil.com.br`.

---

## Push notifications

| Contexto | Fluxo (código real) |
|----------|---------------------|
| **Navegador / PWA** | `navigator.serviceWorker.ready` → `GET /api/vapidPublicKey` → `pushManager.subscribe({ userVisibleOnly, applicationServerKey })` → `POST /api/notifications/subscribe` com `subscriptionObject` |
| **Capacitor (FCM)** | `PushNotifications.requestPermissions/register` → token via listener `registration` → `POST /api/notifications/subscribe` com `fcmToken` |
| **Servidor → cliente** | `services/push.ts` `sendClientNotification` envia via web-push **e** FCM para todas as subscriptions do cliente |
| **Service Worker** | `public/sw.js` trata `push` (mostra notificação) e `notificationclick` (`clients.openWindow('/')`) |

- O opt-in é feito no `Dashboard` do cliente (botão "Ativar Notificações" no
  header quando `!pushGranted`). No mount, só **re-sincroniza** se a permissão já
  foi concedida (não pede sozinho).
- `subscriptions` guarda `subscription_object` (jsonb) e/ou `fcm_token` +
  `device_name` (= `navigator.userAgent`).
- Firebase Admin só inicializa se `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`
  estiverem no env.

---

## Upload no mobile

- Inputs padrão `<input type="file" accept=".pdf,.ofx">` (Dashboard — extrato
  bancário) e `<input type="file" name="file" required>` (MyUploads).
- **Sem atributo `capture`** e **sem plugin de câmera** — abre o seletor de
  arquivos nativo do sistema (que no Android costuma oferecer câmera/galeria/
  arquivos).
- Envio via `FormData` + `apiFetch("/api/client/upload", { method:"POST", body: formData })`.
- Backend: `upload.single("file")` (10 MB) → `validateUploadedFileContent`
  (magic bytes) → `validateBody`.
- `[PLANEJADO]`: captura direta por câmera (`@capacitor/camera`) e/ou
  compressão/recorte antes do upload.

---

## Botão voltar (Android)

- **Não há handler custom.** Não existe `App.addListener('backButton', ...)` em
  lugar nenhum do código.
- Comportamento atual = padrão do WebView/Capacitor: navega no histórico do
  router e, no topo da pilha, fecha o app.
- `[PLANEJADO]`: interceptar `backButton` para (a) fechar modais/drawers abertos
  primeiro, (b) confirmar saída na tela raiz, (c) respeitar as abas.

---

## Safe areas

- `src/index.css`: o `<body>` recebe
  `padding-top/bottom/left/right: env(safe-area-inset-*)`.
- `index.html`: `<meta name="viewport" ... viewport-fit=cover, user-scalable=no,
  maximum-scale=1.0>`.
- `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=default`.
- A bottom nav do cliente aplica `pb-[env(safe-area-inset-bottom)]` própria (o
  gesto/notch inferior). O resto herda do `<body>`.

---

## Gestos

- Nenhum gesto custom (swipe entre abas, pull-to-refresh nativo, etc.).
  `[PLANEJADO]`
- Há um botão de "Atualizar" manual no Dashboard do cliente (`loadData`).

---

## Responsividade

- Tailwind v4, breakpoint principal `md` (768px).
- Containers de conteúdo: `max-w-7xl mx-auto p-4 md:p-8`.
- Grids do Dashboard do cliente: `grid-cols-1 lg:grid-cols-3` etc.
- Tabelas largas (FileGallery, Devices) usam `overflow-x-auto`.
- Área do cliente: bottom nav até `lg` (1024px), sidebar acima. Área do
  contador: sidebar↔drawer no `md`.
- Tema: `next-themes` `attribute="class" defaultTheme="system" enableSystem` —
  segue o sistema por padrão, com toggle manual no painel do contador.

---

## Resumo: implementado vs planejado

| Item | Status |
|------|--------|
| PWA (manifest + service worker + push web) | ✅ implementado |
| Push FCM via Capacitor (hooks no SPA) | ✅ no código web (depende do wrapper nativo) |
| Safe-area no `<body>` + viewport-fit=cover | ✅ implementado |
| Sidebar (contador, desktop) + drawer (contador, mobile) | ✅ implementado |
| Bottom navigation (cliente, < lg) | ✅ implementado |
| Sidebar (cliente, ≥ lg) | ✅ implementado |
| Wrapper Capacitor Android/iOS no repo | ❌ `[PLANEJADO]` |
| Badge de "atrasados" na bottom nav | ❌ `[PLANEJADO]` |
| Handler do botão voltar do Android | ❌ `[PLANEJADO]` |
| Gestos (swipe, pull-to-refresh) | ❌ `[PLANEJADO]` |
| Captura por câmera no upload | ❌ `[PLANEJADO]` |
| Padding de safe-area em barra fixa | ❌ `[PLANEJADO]` (quando a bottom nav existir) |
