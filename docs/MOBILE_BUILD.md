# MOBILE_BUILD.md — gerar e publicar o app do cliente

O app nativo (Capacitor) é **só o Portal do Cliente**. O contador continua no
navegador. O código-fonte é o mesmo SPA de `src/`; o shell nativo vive em
`ios/` e `android/` **neste repositório**.

- `capacitor.config.ts` — `appId: br.com.virgulacontabil.cliente` (⚠️ PERMANENTE
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
   - Bundle ID: `br.com.virgulacontabil.cliente` (igual ao `appId`).
   - Baixe **`GoogleService-Info.plist`** → coloque em **`ios/App/App/`**
     (arraste para dentro do target **App** no Xcode: "Copy items if needed",
     marque o target). O arquivo está no `.gitignore`.
3. **Adicionar app Android**:
   - Nome do pacote: `br.com.virgulacontabil.cliente`.
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
   - **Bundle Identifier**: `br.com.virgulacontabil.cliente`.
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
6. **Exclusão de conta** — informe a URL pública
   `https://cliente.virgulacontabil.com.br/excluir-conta`. O caminho dentro do
   app é Minha conta → Excluir minha conta (ver §6).
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
- **5.1.1(v)** — exclusão de conta: resolvido (§6).

---

## 5. Android / Google Play

### 5.1 Assinatura (upload key)

- Keystore: `android/portal-virgula-upload.jks` (PKCS12, alias `portal`,
  RSA 2048, validade 25 anos). **Fora do Git** (`*.jks` no `.gitignore`).
- Senhas: `android/keystore.properties` (**fora do Git**; modelo em
  `android/keystore.properties.example`). PKCS12 ⇒ senha do keystore = senha
  da chave. O `android/app/build.gradle` lê esse arquivo e assina o release
  sozinho; sem ele o release sai sem assinatura.
- **Backup obrigatório** do `.jks` + `keystore.properties` (cofre de senhas +
  cópia offline). Com Play App Signing, perder a upload key tem conserto (pedido
  de reset no Play Console), mas leva dias.
- Certificado da upload key (público — útil p/ conferir no Play Console):
  - SHA-1 `7C:01:B7:BF:4F:59:C4:E5:F5:4F:74:2F:DA:CF:9F:35:16:A3:30:66`
  - SHA-256 `E9:A1:D8:D7:F8:F9:5C:C8:7B:B3:77:E9:D7:8B:6A:A1:30:26:6A:80:8B:9C:AB:AC:B3:07:BE:3D:26:05:90:74`

### 5.2 Gerar o .aab

```bash
npm run cap:sync
cd android && ./gradlew bundleRelease
```

Saída: `android/app/build/outputs/bundle/release/app-release.aab` (já
assinado). No Android Studio dá no mesmo: **Build → Generate Signed App Bundle
or APK → Android App Bundle**, keystore acima, alias `portal`, variante
`release`. No Windows, o `gradlew` usa o JDK do Android Studio
(`JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"`).

- `google-services.json` em `android/app/` (§1.3) — o `package_name` dele tem
  de ser `br.com.virgulacontabil.cliente`, senão o build falha.
- A cada envio ao Play: **subir `versionCode`** (1, 2, 3…) em
  `android/app/build.gradle`; `versionName` é o texto que o usuário vê.

### 5.3 Ícone, splash e imagens da loja

Gerados por `scripts/app-assets/gen-assets.cjs` a partir da arte do
`favicon.html` (ícone: vírgula laranja no quadrado verde) e do
`exportar-logo.html` (wordmark "Vírgula, CONTÁBIL"), replicadas em
`scripts/app-assets/gen.html`:

| Saída | Onde |
|---|---|
| Ícone do launcher (legado, round, adaptativo fg/bg, monocromático p/ ícones temáticos do Android 13+) | `android/app/src/main/res/mipmap-*/` |
| Ícone de push (vírgula branca) — ligado no `AndroidManifest.xml` | `res/drawable-*/ic_stat_notify.png` |
| Splash: ícone central + wordmark embaixo, fundo `#f8fafc` | `res/drawable-*/splash_icon.png`, `splash_branding.png`, `res/drawable/splash.xml`, `res/values*/styles.xml` |
| Ícone da loja 512×512, gráfico de recursos 1024×500, 6 capturas 1080×1920 | `store-assets/google-play/` |

As capturas são montadas sobre `blog-screenshots/*-mobile.png` (dados
simulados). Para regerar tudo: ver o cabeçalho do script.

### 5.4 Play Console — o que ele cobra

- **Política de privacidade**: `https://cliente.virgulacontabil.com.br/privacidade`
  (`src/pages/PrivacyPolicy.tsx`; também linkada no login e em Minha conta,
  como o Google exige). **Acesso ao app** (conta de teste
  com CNPJ + senha para o revisor), **Segurança dos dados**, **Classificação
  de conteúdo**, **Público-alvo**, **Anúncios** (não tem).
- **Exclusão de conta** (Segurança dos dados → exclusão): use
  `https://cliente.virgulacontabil.com.br/excluir-conta`.
- Conta de desenvolvedor **pessoal** criada depois de nov/2023: antes da
  produção é obrigatório um **teste fechado com ≥ 12 testadores por 14 dias
  seguidos**. Conta de **organização** (com D-U-N-S) não tem essa exigência.

---

## 6. Exclusão de conta — ✅ implementado

Apple (5.1.1(v)) e Google (Data safety) exigem que o usuário consiga pedir a
exclusão da conta/dados **pelo app** + uma **URL pública**. Está pronto:

- **No app**: Minha conta (rodapé da sidebar / engrenagem no Visão Geral) →
  **Excluir minha conta**. Confirmação em dois passos, motivo opcional, e
  depois o estado "Exclusão solicitada" com opção de cancelar.
- **URL pública** para o cadastro do app nas duas lojas:
  **`https://cliente.virgulacontabil.com.br/excluir-conta`**
  (abre sem login; explica como pedir, o que é apagado e o que fica retido).
- O pedido aparece para o contador como banner no cliente, KPI no inbox e
  mensagem na caixa de entrada. Quem executa é o contador, pelo botão de
  excluir cliente — a guarda legal de 5 anos dos documentos fiscais não
  permite apagar na hora, e a Apple aceita esse desenho desde que o app
  explique a retenção (explica).

> No formulário do App Store Connect e do Play Console, informe essa URL no
> campo de exclusão de conta.

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
| `android/app/build.gradle` | `versionCode`/`versionName` + assinatura do release via `keystore.properties` |
| `android/keystore.properties` | senhas da upload key (**fora do Git**; modelo `.example`) |
| `scripts/app-assets/` | gerador de ícones/splash/imagens da Play Store |
| `store-assets/google-play/` | ícone 512, gráfico de recursos, capturas para a ficha da loja |
