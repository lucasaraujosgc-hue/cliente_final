# CHANGELOG.md

Registro das alterações relevantes. Não lista cada arquivo — ver `git log` para
detalhe. Datas relativas convertidas: trabalho feito em agosto/2026.

---

## Branch `improvements` (não mergeada / não deployada)

Estado alvo desta branch: endurecimento de segurança + migração para Drizzle
como fonte de verdade do schema + doc técnica. (Ver `git log main..HEAD` para a
lista exata de commits.)

### NFS-e — "Dados inválidos." era validação local, não o Sefin

O `POST /api/nfse/emissoes` voltava **400 em ~15 ms, sem chamar o Sefin**: o
`validateBody(nfseEmitSchema)` rejeitava o corpo. A consulta de CNPJ (BrasilAPI/
ReceitaWS) devolve **`null`** em vários campos de endereço (`complemento`,
`numero`, `cep`…), e o wizard mandava o objeto cru — o schema só aceitava
`string`/`undefined`. Mensagem genérica "Dados inválidos." + header "A Sefin
Nacional recusou a nota" davam a impressão de rejeição remota.

- `nfseEmitSchema`: campos opcionais do tomador/endereço agora **toleram `null`**
  (viram `undefined`); e-mail malformado da consulta é **descartado** em vez de
  rejeitar a nota; documento do tomador é normalizado (tira pontuação); `valor`
  é arredondado.
- `validateBody`: loga no stdout o método + rota + campos que falharam
  (`[validateBody] 400 POST … — tomador.endereco.numero: Expected string…`).
- Frontend: o erro de validação lista os campos; o wizard mostra "Revise os
  dados da nota" em vez de "A Sefin recusou".

### NFS-e — diagnóstico de rejeição + saneamento de texto

- **Log de rejeição** (`emitir.ts` `dumpRejeicao`): a cada recusa do Sefin,
  imprime no stdout (EasyPanel/Cloud Run capturam) um bloco delimitado com
  ambiente, idDps, URL, HTTP status e a **resposta crua do Sefin**. Com
  `NFSE_DEBUG=1`, inclui também a **DPS assinada completa**. A resposta do Sefin
  também vai para `erro_msg` (visível na aba "Notas emitidas"). `nfseLog`
  não trunca mais o corpo da resposta.
- **`nfse boot`**: uma linha no log ao subir, com `dpsVersao`, `verAplic`,
  `ibsCbsEnviar`, `nfseDebug` e as bases do Sefin — pra confirmar qual versão
  está no ar.
- **`NFSE_DPS_VERSAO` default `1.00` → `1.01`**: o pacote de esquemas em produção
  (gov.br/nfse/.../documentacao-atual) é o `NFSe-ESQUEMAS_XSD-v1.01-20260209` —
  o `versao="1.00"` que a DPS carregava não é o vigente. Sobrescrevível por env.
- **Saneamento ISO-8859-1** (`dps.ts` `sanitizeText`): o tipo `TSString` do XSD só
  aceita Latin-1. Travessão (—), aspas curvas (" "), reticências (…), non-breaking
  space e qualquer caractere fora do Latin-1 no nome do prestador/tomador, na
  descrição ou no endereço faziam o Sefin rejeitar com **"Dados inválidos."**.
  Agora são transliterados/removidos. `validate.ts` também barra isso antes do
  envio, com o caractere e o code point no erro.
- **Captura de erro completa** (`client.ts` `firstErro`): junta todos os
  `erros[]` + `alertas[]` (com `complemento`) numa string; quando o corpo não tem
  a forma esperada, inclui o HTTP status + recorte do JSON cru. Some com o
  "Dados inválidos." pelado.
- **Painel do contador — aba "Notas emitidas"**: linha expansível com Id da DPS,
  chave, `verAplic` do Sefin, motivo da rejeição (código + texto), alertas, e
  **download do XML da DPS assinada / da NFS-e** (rota
  `GET /api/nfse/admin/emissoes/:id/xml?tipo=dps|nfse`, só contador, com audit).

### NFS-e — atividade pré-configurada pelo contador (todos os códigos)

O contador passa a informar **todos os códigos fiscais** na atividade
(`/admin/nfse` → AtividadeForm); o cliente na emissão só escolhe a atividade e
informa **tomador, descrição e valor**.

- Migração `0008_nfse_atividade_rtc` (aditiva) em `nfse_atividades`: `c_nbs`,
  `trib_issqn` (default `1`), `reg_ap_trib_sn`, `cod_atividade_sn`,
  `pis_cofins_cst`, `aliquota_pis`, `aliquota_cofins`, `ibs_cbs_cst`,
  `ibs_cbs_class_trib`, `ibs_cbs_cind_op`, `ibs_cbs_ind_dest` (default `0`).
- `dps.ts` passa a emitir: `serv/cServ/cNBS`; `regTrib/regApTribSN` (só
  opSimpNac=3); `tribMun/tribISSQN` configurável (antes fixo em `1`), com `pAliq`
  só quando `tribISSQN=1`; bloco `tribFed/piscofins` (CST + alíquotas → vPis/
  vCofins) quando a atividade tem CST; `cLocPrestacao` = município de incidência
  quando informado.
- **IBS/CBS**: grupo mínimo do XSD v1.01 (`finNFSe` + `cIndOp` + `indDest` +
  `valores/trib/gIBSCBS/{CST,cClassTrib}`) — só emitido com
  `NFSE_IBSCBS_ENVIAR=1` **e** os 3 códigos preenchidos. Default OFF (NT-009 sem
  cronograma). Os códigos são sempre guardados na atividade.
- Form do contador reorganizado em seções (Serviço · ISSQN · Simples Nacional ·
  Retenções federais · PIS/COFINS · IBS/CBS). DTO admin devolve todos os campos;
  DTO do cliente inalterado.
- `test:` `maxWorkers: 4` + `testTimeout` 20s no vitest.config (pglite/pdf-lib
  sob paralelismo estouravam 5s). 171 testes.

### NFS-e Nacional — auditoria + adequação ao contrato oficial

Após auditoria confrontando o código com `docs/nfse-nacional/` e com os Swaggers
oficiais do **Sefin Nacional** (agora salvos em `docs/nfse-nacional/01-api/`):

- **Contrato do Sefin confirmado e alinhado** (`client.ts`): `POST /nfse` →
  sucesso é **HTTP 201** com `NFSePostResponseSucesso`
  (`idDps`/`chaveAcesso`/`nfseXmlGZipB64`/`alertas`); rejeição = 400
  (`NFSePostResponseErro.erros[]`), certificado de transmissão = 403, falha
  interna ambígua = 500. `GET|HEAD /dps/{id}`, `GET /nfse/{chave}` implementados.
  Parâmetros municipais **migrados p/ o ADN `/parametrizacao`** (o Sefin responde
  501); `consultarConvenio`/`consultarAliquota` apontam para o host certo.
- **Julgamento do processamento** (`emitir.ts`): 2xx só vira `emitida` quando o
  corpo traz a NFS-e, a chave tem 50 posições e `cStat` é 100. Sem isso →
  `processando`; timeout / 500 / rede → `processando` + HTTP 202 (não reemitir).
  `alertas`, `versaoAplicativo`, `idDps` persistidos.
- **Reconciliação** (`reconcile.ts` + `POST /api/nfse/emissoes/:id/sincronizar`):
  promove `processando` → `emitida`/`rejeitada` via `HEAD/GET /dps` + `GET /nfse`.
  Nunca reenvia a DPS.
- **Idempotência**: índice único `(client_id, id_dps)` + dedupe no `emitir.ts`
  (reenvio idêntico enquanto há `processando` reconcilia em vez de gerar 2ª nota).
- **CNPJ como string** (`inscricao.ts`): `TSCNPJ = [0-9A-Z]{14}` (CNPJ
  alfanumérico, NT-009). `normalizeInscricao` substitui `normalizeCnpj` em todo o
  caminho da NFS-e; `chave.ts` e `buildDpsId` preservam letras. `lib/cnpj.ts`
  (login) intacto.
- **Validação estrutural** (`validate.ts`): checa ordem dos elementos, tipos
  simples, prefixo de namespace (E1228), encoding (E1229), versão (E1260) e os
  Ids (`TSIdDPS`/`TSIdPedRegEvt`) antes de assinar e antes de enviar.
- **DANFSe local** (`danfseRender.ts`): a API de geração do ADN foi sobrestada em
  03/08/2026 (NT-008) — o DANFSe é gerado do XML da NFS-e (A4, blocos
  obrigatórios da NT-008 §2.1, QR Code p/ a consulta pública, marcas d'água
  CANCELADA / "SEM VALIDADE JURÍDICA"). **PENDENTE**: layout milimétrico do
  Anexo I. Deps novas: `pdf-lib`, `qrcode`.
- **Segurança**: envio de certificado A1 recusado (400) quando `SECRETS_KEY` não
  está setado (senão o `.pfx` + senha ficariam em texto puro).
- **Versão do leiaute configurável** (`NFSE_DPS_VERSAO`, default `1.00`) —
  confirmar contra produção restrita. `xDescServ` truncado em 1000 (Anexo I).
- **Log técnico** (`log.ts`, JSON single-line sem dados sensíveis) + `logAudit`
  em `nfse.emissao` / `nfse.cancelamento`.
- Migração `0007_nfse_reconciliacao` (aditiva): `alertas`, `versao_aplicativo`,
  `sefin_processado_em`, `sync_tentativas` + índice único. Rodar `npm run
  db:generate` para revalidar o snapshot antes de mergear.
- Testes novos: `inscricao`, `validate`, `nfseXml` + `danfseRender`, `emitir`
  (mocks: emitida / rejeitada / processando / anomalia 201 / dedupe / CNPJ
  alfanumérico). Total: 165 testes.
- **Ainda PENDENTE**: homologar em produção restrita com A1 real (algoritmo de
  assinatura RSA-SHA1 vs SHA-256 não confirmado na doc); validação XSD completa
  no CI; layout Anexo I do DANFSe; IBS/CBS (NT-009, sem cronograma).

### Emissor de NFS-e Nacional (integração direta gov.br)

Emissão de NFS-e pelo cliente, integrando **direto com o Sistema Nacional NFS-e
(Sefin Nacional)** — sem provedor terceirizado, sem custo por nota, certificado e
dados fiscais no próprio servidor. Layout **DPS v1.01**.

- **Migration `0006_nfse`**: `nfse_config` (1/cliente: certificado A1 + dados
  fiscais + série/contador de DPS), `nfse_atividades` (atividades pré-configuradas
  pelo contador — item LC 116, cód. tributação nacional, alíquota ISS, retenções),
  e expansão de `nfse_emissoes` (chave de acesso, XMLs, DANFSE, rejeição,
  cancelamento). `EXPECTED_TABLES` do `migrate.ts` atualizado.
- **`src/server/services/nfse/`** (pasta, ex-`nfse.ts`):
  `status` (gating), `cert` (PKCS#12 via `node-forge` → agente mTLS + PEM p/
  assinar, valida CNPJ raiz + validade), `config` (CRUD config/atividades),
  `dps` (monta o XML da DPS na ordem do XSD, via `xmlbuilder2`), `sign` (XMLDSig
  enveloped sobre `infDPS`/`infPedReg` via `xml-crypto` — RSA-SHA1, C14N,
  enveloped+C14N transforms, `KeyInfo`/X509), `client` (HTTP mTLS nativo:
  `POST /nfse` com `dpsXmlGZipB64`, consulta, eventos, DANFSE, parâmetros
  municipais), `params` (cache dos parâmetros municipais), `emitir` (orquestra e
  persiste — grava linha `emitida` ou `rejeitada`), `events` (cancelamento —
  evento e101101), `danfse` (busca+cacheia o PDF), `chave` (parse dos 50
  dígitos), `cnpjLookup` (BrasilAPI → ReceitaWS).
- **Rotas** (`nfse.routes.ts`): cliente — `GET /api/nfse` (status/gating),
  `/api/nfse/atividades`, `/api/nfse/emissoes[/:id]`, `POST /lookup-cnpj`,
  `POST /emissoes`, `POST /emissoes/:id/cancelar`, `GET /emissoes/:id/danfse`;
  contador — `GET|PUT /api/nfse/admin/clients[/:id]/config` (multipart cert),
  `.../atividades` CRUD, `POST .../test` (abre o cert + checa convênio do
  município via mTLS), `GET /api/nfse/admin/emissoes`. Limiters
  `nfseEmitLimiter`/`nfseLookupLimiter`. DTOs em `dto/nfse.ts` (nunca devolvem
  `cert_path`/`cert_senha`).
- **Certificado por cliente**: `.pfx`/`.p12` enviado pelo contador, cifrado em
  repouso (`encryptBytes`, magic `ENCv1\0`, exige `SECRETS_KEY`) em
  `NFSE_CERTS_DIR`. Decifrado só em memória para o `https.Agent`/assinatura.
- **Frontend**: nova página do contador `/admin/nfse` (`pages/accountant/nfse/`)
  — lista de clientes + painel de certificado/dados fiscais/atividades (busca na
  lista LC 116). Página do cliente `client/Nfse.tsx` reescrita: quem não tem
  setup completo continua vendo "a partir de novembro/2026"; quem tem vê as notas
  emitidas (tomador/valor/data/status) com **Ver PDF / Compartilhar (arquivo via
  `navigator.share`) / Duplicar / Cancelar** e o **wizard de 3 passos**
  (CNPJ do tomador → atividade+descrição → valor → concluir) com tela de sucesso
  (visualizar/compartilhar/nova) e de rejeição (código + motivo). `NfseCallout`
  do dashboard vira CTA quando habilitado.
- **Lista LC 116/2003** completa em `src/lib/listaServicosLC116.ts` (módulo
  compartilhado, servido em `GET /api/nfse/lista-servicos`).
- **Deps novas** (server-side): `node-forge`, `xml-crypto`, `@xmldom/xmldom`,
  `xmlbuilder2`. Env novas: `NFSE_AMBIENTE_DEFAULT`, `NFSE_SEFIN_BASE_*`,
  `NFSE_ADN_BASE_*`, `NFSE_CERTS_DIR`, `NFSE_PDF_DIR`, `BRASILAPI_BASE`,
  `RECEITAWS_BASE`.
- **Testes**: `dps.test.ts` (estrutura/ordem/Id da DPS), `sign.test.ts`
  (assinatura verifica + detecta adulteração, com cert self-signed),
  `chave.test.ts`, `cnpjLookup.test.ts` (fallback), `gating.test.ts` (pglite).
- **`[PLANEJADO]` / limites do v1**: assinatura só validada contra cert
  self-signed — falta homologar em **produção restrita**
  (`sefin.producaorestrita.nfse.gov.br`) com A1 real; só municípios conveniados
  ao padrão nacional; regime comum (SN/MEI/Normal, ISS operação tributável,
  retenção federal só INSS/IRRF/CSLL); sem PIS/COFINS com CST, sem deduções, sem
  cancelamento por substituição, sem retry de `processando`.

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

### Consulta de pagamentos — API real do PAGTOWEB + pagamento manual em lote
- `consultarPagamentoNoSerpro` (`services/paymentQuery.ts`) reescrita para a API
  documentada do **PAGTOWEB "Consultar Pagamentos"** (`idServico PAGAMENTOS71`):
  consulta por `numeroDocumentoLista` quando o número do documento é conhecido,
  senão fallback por `intervaloDataArrecadacao` + `intervaloValorTotalDocumento`
  (com `primeiroDaPagina`/`tamanhoDaPagina` obrigatórios). O serviço só devolve
  documentos arrecadados; item com `dataArrecadacao` = pago. No modo fallback o
  valor precisa casar (± R$0,50) para não dar falso-positivo.
- **Número do documento** ("Número do Documento" da DARF/DAS, até 17 díg.) agora
  é capturado: da resposta do SERPRO ao gerar DAS (`detalhamentoDas.numeroDocumento`,
  antes descartada) e, para DCTFWeb / guias antigas, extraído do texto do PDF
  (`extractDocNumberFromPdf` em `qrExtractor.ts`) com cache em
  `documents.extracted_data.numeroDocumento` (backfill preguiçoso na 1ª consulta).
  Também gravado em `guias_geradas.numero_documento` (coluna já existente). Sem
  migration.
- Novo `loadDocumentPdfBuffer` (`services/files.ts`) resolve o PDF de um
  `documents` (data: URI / ponteiro de guia / `/uploads/<nome>`) para leitura
  server-side.
- **Pagamento manual em lote**: `markPaymentsManual` + `POST /api/accountant/
  payments/mark-paid` — marca as guias selecionadas como pagas (`status = paid`,
  `payment_checks` → `PAGO`, `paidSource = accountant`, trilha de auditoria
  `payment.manual_mark`) **sem chamar o SERPRO e sem notificar o cliente**.
  `markGuiaPaid` ganhou o parâmetro `notify`.
- **Frontend `/admin/payments`**: filtro por **categoria do documento** (dropdown
  com as categorias distintas da lista) + botão **"Informar pagamento manual"**
  (confirmação em 2 cliques) ao lado de "Consultar selecionadas".

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
