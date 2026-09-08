# MOBILE_BUILD.md — gerar e publicar o app do cliente

O app nativo (Capacitor) é **só o Portal do Cliente**. O contador continua no
navegador. O código-fonte é o mesmo SPA de `src/`; o shell nativo vive em
`ios/` e `android/` **neste repositório**.

- `capacitor.config.ts` — `appId: br.com.virgulacontabil.portal` (⚠️ PERMANENTE
  após a 1ª publicação — troque agora se quiser outro).
- Bundle web do app: `npm run build:mobile` → `./www` (não versionado).
- Push: **FCM** nos dois SO (`@capacitor-firebase/messaging`), casando com o
  backend `firebase-admin`. Push web (PWA) continua em VAPID, sem mudança.

---

## 0. Pré-requisitos

| Para | Precisa |
|---|---|
| iOS | **Mac** com **Xcode 16+**, conta **Apple Developer** (US$ 99/ano, com **D-U-N-S** p/ publicar como "Vírgula Contábil") |
| Android | **Android Studio** (qualquer SO), conta **Google Play Console** (US$ 25 única) |
| Ambos | Node 20+, este repo com `npm install` feito |

Sem Mac para iOS: alternativas são Mac na nuvem (MacStadium / MacinCloud) ou CI
(Codemagic, Ionic Appflow, runner macOS do GitHub Actions).

---

## 1. Firebase (uma vez)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Criar
   projeto** (ex.: `virgula-portal-cliente`). Pode desativar o Google Analytics.
2. **Adicionar app iOS**:
   - Bundle ID: `br.com.virgulacontabil.portal` (igual ao `appId`).
   - Baixe **`GoogleService-Info.plist`** → coloque em **`ios/App/App/`**
     (arraste para dentro do target **App** no Xcode: "Copy items if needed",
     marque o target). O arquivo está no `.gitignore`.
3. **Adicionar app Android**:
   - Nome do pacote: `br.com.virgulacontabil.portal`.
   - Baixe **`google-services.json`** → coloque em **`android/app/`**
     (também no `.gitignore`). O Gradle já aplica o plugin automaticamente
     quando o arquivo existe.
4. **APNs Auth Key (iOS)** — sem isso o push NÃO chega no iPhone:
   - [developer.apple.com](https://developer.apple.com) → Certificates,
     Identifiers & Profiles → **Keys** → **+** → marque **Apple Push
     Notifications service (APNs)** → baixe o **`.p8`** (só dá p/ baixar 1 vez).
     Anote o **Key ID** e o **Team ID**.
   - Firebase Console → ⚙️ **Configurações do projeto** → **Cloud Messaging** →
     seção **Apple app configuration** → **Upload** da APNs Auth Key (.p8) +
     Key ID + Team ID.
5. **Backend** (EasyPanel) — variáveis que o `firebase-admin` já lê
   (`src/server/services/push.ts`):
   ```
   FIREBASE_PROJECT_ID=<id do projeto>
   FIREBASE_CLIENT_EMAIL=<service account>
   FIREBASE_PRIVATE_KEY=<chave privada, com \n>
   ```
   Gere em Firebase Console → Configurações → **Contas de serviço** → **Gerar
   nova chave privada**. Sem essas vars o servidor simplesmente não envia FCM
   (o web push segue funcionando).

---

## 2. Rotina de build

Sempre que o código web muda:

```bash
npm run cap:sync         # build:mobile + copia p/ ios/ e android/ + atualiza plugins
```

Depois:

```bash
npm run cap:ios          # abre o Xcode  (equivale a: cap sync ios && cap open ios)
npm run cap:android      # abre o Android Studio
```

> `www/`, `ios/App/App/public/` e `android/.../assets/public/` são gerados —
> não edite à mão, não versione.

---

## 3. iOS — primeira configuração no Xcode

Abra `npm run cap:ios`. No target **App**:

1. **Signing & Capabilities**:
   - **Team**: sua conta Apple Developer. Xcode cria o provisioning profile.
   - **Bundle Identifier**: `br.com.virgulacontabil.portal`.
   - **+ Capability** → **Push Notifications** (o Xcode detecta o
     `ios/App/App/App.entitlements` já existente e o vincula ao target — se
     pedir p/ criar um novo, aponte para esse).
   - **+ Capability** → **Background Modes** → marque **Remote notifications**.
2. **General → Deployment Info**: **iPhone** apenas (desmarque iPad) — o app é
   retrato/iPhone. Evita screenshots e revisão de iPad.
3. **Swift Package Manager**: na 1ª abertura o Xcode resolve os pacotes
   (Capacitor + `firebase-ios-sdk`). Pode levar alguns minutos. Se falhar:
   File → Packages → **Reset Package Caches**.
4. **`GoogleService-Info.plist`** dentro do target App (passo 1.2).
5. **Ícone**: `App/Assets.xcassets/AppIcon.appiconset` — solte um PNG 1024×1024
   (sem transparência, sem cantos arredondados). O Capacitor tem
   [@capacitor/assets](https://github.com/ionic-team/capacitor-assets) p/ gerar
   todos os tamanhos a partir de um `assets/icon.png` + `assets/splash.png`.
6. **Versão**: `General` → Version (`1.0.0`, o que aparece na loja) e Build
   (`1`, incremental a cada upload).
7. `Info.plist` já traz: `ITSAppUsesNonExemptEncryption=false`, strings de
   câmera/galeria, orientação retrato, região pt-BR.

### Testar no aparelho

- Push **não funciona no Simulador** para tokens reais — use um iPhone físico.
- Rode pelo Xcode (▶). Faça login, ative notificações no Dashboard, confira nos
  logs do EasyPanel o `POST /api/notifications/subscribe` com `fcmToken`.
- Mande uma notificação de teste pelo painel do contador.

### Archive + upload

1. Topo do Xcode: selecione **Any iOS Device (arm64)**.
2. **Product → Archive**.
3. No Organizer: **Distribute App** → **App Store Connect** → **Upload**.
4. Aguarde o processamento (e-mail da Apple, ~15–60 min).

---

## 4. App Store Connect

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps** →
   **+** → **Novo app**:
   - Plataforma iOS, nome "Portal do Cliente — Vírgula Contábil" (ou similar),
     idioma primário Português (Brasil), Bundle ID da lista, SKU livre.
2. **Build**: selecione o que subiu no passo 3.
3. **Informações de privacidade do app** (Nutrition Label) — declare o que o app
   coleta: CNPJ, nome, e-mail, telefone, **documentos fiscais/financeiros**,
   ID de dispositivo (token push), dados de uso. Marque **"não usado para
   rastrear"** (sem ATT).
4. **URL da política de privacidade** — obrigatória, precisa estar no ar.
5. **Informações de revisão** → **Login de demonstração**:
   - Crie um cliente de teste com dados realistas (guias, documentos,
     vencimentos — não pode estar vazio).
   - Informe **CNPJ + senha** desse cliente + uma nota explicando o fluxo
     (login → dashboard → cofre → notas).
   - ⚠️ Sem isso a Apple rejeita em **Guideline 2.1** (não consegue testar).
6. **Exclusão de conta** — a Apple pede um caminho de exclusão de conta/dados
   **dentro do app** e uma **URL pública** de exclusão. **Ainda não existe** —
   ver §6.
7. **Screenshots**: iPhone 6.9"/6.7" e 6.5" (retrato). Sem iPad (o app é
   iPhone-only via `UISupportedInterfaceOrientations`).
8. **Idade / classificação**: preencher o questionário (sem conteúdo sensível →
   4+).
9. **Enviar para revisão**. Primeira revisão: 1–3 dias, quase sempre com 1
   rodada de rejeição. Orce ~1–2 semanas.

### Riscos de rejeição mais prováveis aqui

- **4.2 (wrapper de site)** — mitigado: assets locais (sem `server.url`), push
  nativo, câmera/galeria, share nativo de PDF. Se cair nisso, reforçar recursos
  nativos (Face ID no login é o próximo candidato).
- **2.1** — conta demo vazia/expirada.
- **5.1.1(v)** — exclusão de conta (§6).

---

## 5. Android / Play (resumo)

Você já conhece o fluxo. Específico deste projeto:

```bash
npm run cap:android
```

- `google-services.json` em `android/app/` (§1.3).
- `android/app/build.gradle`: `versionCode` (incremental) e `versionName`.
- Ícone de push branco/transparente recomendado (senão o Android mostra um
  quadrado). Opcional: `<meta-data
  android:name="com.google.firebase.messaging.default_notification_icon" .../>`
  no `AndroidManifest.xml`.
- **Build → Generate Signed Bundle (.aab)** → upload no Play Console.
- Play Console também exige **política de privacidade**, **conta de teste** (em
  "Acesso ao app") e **exclusão de conta** (Data safety → deletion).

---

## 6. PENDENTE antes de publicar: exclusão de conta

Apple (5.1.1) e Google (Data safety) exigem que o usuário consiga pedir a
exclusão da conta/dados **pelo app** + uma **URL pública**. Hoje não existe.
Opção mínima: uma tela "Excluir minha conta" na área do cliente que dispara
`POST /api/client/account-deletion-request` → e-mail pro contador + registro em
`audit_log`, e uma rota pública `GET /excluir-conta` explicando o processo.

Peça pro Claude implementar quando for publicar.

---

## 7. Publicar atualizações

1. Mexeu no código web → `npm run cap:sync`.
2. iOS: bump do **Build** no Xcode → Archive → Upload → nova versão no App Store
   Connect → enviar p/ revisão.
3. Android: bump do `versionCode` → novo `.aab` → Play Console.
4. Mudança só de conteúdo web que já está no ar? Não — o app usa assets
   **embutidos**, então toda atualização de UI exige nova build/submissão.
   (Se um dia quiser OTA, dá pra ligar `server.url` apontando pro site, mas isso
   aumenta o risco no 4.2 e alguns updates ainda exigem re-submissão.)

---

## Arquivos-chave

| Caminho | O quê |
|---|---|
| `capacitor.config.ts` | appId, plugins, workaround SPM do Firebase |
| `src/lib/native.ts` | ponte nativa: splash, status bar, botão voltar, push FCM, share de PDF |
| `src/main.tsx` | não registra o service worker dentro do app |
| `src/App.tsx` | bloqueia `/admin/*` no app nativo |
| `server.ts` | CORS libera `capacitor://localhost` e `https://localhost` |
| `ios/App/App/Info.plist` | flags de App Store (encryption, permissões, orientação) |
| `ios/App/App/AppDelegate.swift` | `FirebaseApp.configure()` + repasse de APNs |
| `ios/App/App/App.entitlements` | `aps-environment` (push) |
