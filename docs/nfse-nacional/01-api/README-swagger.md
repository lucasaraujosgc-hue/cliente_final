# Swaggers das APIs da NFS-e Nacional

## Arquivos

| Arquivo | API | Host / basePath |
|---|---|---|
| `swagger.json` | **ADN Contribuinte** (distribuição de DF-e) | `adn.*.nfse.gov.br/contribuintes` — `GET /DFe/{NSU}`, `GET /NFSe/{ChaveAcesso}/Eventos` |
| `swagger-sefin-nacional-producao.json` | **Sefin Nacional** — emissão | `sefin.nfse.gov.br` `/SefinNacional/` |
| `swagger-sefin-nacional-producao-restrita.json` | **Sefin Nacional** — emissão (homologação) | `sefin.producaorestrita.nfse.gov.br` `/SefinNacional` |
| `swagger-adn-parametros-municipais.json` | **ADN Parametrização** (convênio, alíquotas, regimes, retenções, benefícios) | `adn.*.nfse.gov.br/parametrizacao` |
| `swagger-adn-danfse.json` | **ADN DANFSe** — `GET /danfse/{chaveAcesso}` | **sobrestado em 03/08/2026 (NT-008)** — o emissor gera o DANFSe localmente |

## Procedência e verificação

Os endpoints oficiais do Sefin Nacional exigem **TLS mútuo com certificado
ICP-Brasil** — até o Swagger UI (`/SefinNacional/docs/index`) responde `403` sem
o certificado de cliente. Portanto, os arquivos `swagger-sefin-*` e
`swagger-adn-*` desta pasta foram obtidos de um **espelho público** dos Swaggers
oficiais (repositório comunitário no GitHub), não diretamente do gov.br.

Cada arquivo é auto-identificável (`"title": "API NFS-e - Sefin Nacional"`,
`swagger 2.0`) e o conteúdo foi **conferido contra o Manual oficial v1.2**
(`manual-contribuintes-...pdf`) e contra os XSD de `../03-xsd/`:

- `POST /nfse` recebe `{ "dpsXmlGZipB64": "<gzip+base64>" }` e devolve **HTTP
  201** com `NFSePostResponseSucesso` (`idDps`, `chaveAcesso`, `nfseXmlGZipB64`,
  `alertas[]`, `versaoAplicativo`, `dataHoraProcessamento`). Rejeição = **400**
  com `NFSePostResponseErro` (`erros[]` de `MensagemProcessamento`
  `{codigo, descricao, complemento}`). Certificado de transmissão = **403**.
  Falha interna = **500** (ambígua — pode ter gerado a nota).
- `GET /nfse/{chaveAcesso}` → `NFSeGetResponseSucesso` (`nfseXmlGZipB64`);
  404 / 401 / 403 → `ResponseErro` (campo `erro` **singular**).
- `GET|HEAD /dps/{id}` → chave de acesso / existência da NFS-e.
- `POST /nfse/{chaveAcesso}/eventos` recebe
  `{ "pedidoRegistroEventoXmlGZipB64": "..." }` → **201** `EventosPostResponseSucesso`
  (`eventoXmlGZipB64`).
- `/DANFSe` e `/ParametrosMunicipais` no Sefin retornam **501** — movidos para o
  ADN (`/danfse`, `/parametrizacao`).

## ⚠️ Antes de ir para produção

Rebaixar estes espelhos e **rebaixar o Swagger oficial** com um certificado
ICP-Brasil de cliente (produção restrita:
`https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index`;
produção: `https://sefin.nfse.gov.br/SefinNacional/docs/index`), e confirmar
campo a campo — em especial o **algoritmo de assinatura XMLDSig** exigido, que
nenhum documento desta pasta especifica.

Página oficial das APIs:
<https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao>
