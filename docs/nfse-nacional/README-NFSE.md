# NFS-e Nacional — Documentação Técnica de Referência

## Objetivo

Esta pasta contém a documentação oficial utilizada como fonte de verdade para a implementação e correção da integração com a NFS-e Padrão Nacional no sistema.

**Importante:** o código existente já possui endpoints relacionados à emissão de NFS-e. O objetivo não é criar uma segunda implementação, mas auditar o que existe, confrontar com a documentação oficial vigente e corrigir/adequar o fluxo.

---

## Fonte oficial

Portal oficial da NFS-e Nacional:

https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica

Documentação Atual — Produção:

https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual

APIs — Produção Restrita e Produção:

https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao

Documentação Técnica — Produção Restrita:

https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita

RTC / IBS-CBS:

https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc

---

## Hierarquia de fontes

Ao implementar ou corrigir qualquer funcionalidade, seguir esta prioridade:

1. Swagger/OpenAPI do ambiente que será efetivamente utilizado.
2. XSD/schema correspondente ao ambiente e à versão.
3. Notas Técnicas oficiais vigentes e aplicáveis ao ambiente.
4. Leiautes/regras de negócio oficiais.
5. Manual oficial da API.
6. Demais documentos oficiais.

Não utilizar blogs, fóruns, exemplos de terceiros ou conhecimento prévio como fonte de verdade quando houver documentação oficial disponível.

### Regra importante sobre versões

Não assumir que a versão mais nova de um documento deve ser usada automaticamente em Produção.

A documentação da NFS-e pode possuir diferenças entre:
- Produção;
- Produção Restrita/Homologação;
- versões de layout em implantação;
- versões futuras ainda não disponibilizadas no endpoint.

Sempre verificar a combinação **ambiente + Swagger + XSD + Nota Técnica** antes de implementar.

---

# Arquivos desta pasta

## 1. API

### `swagger.json`

Arquivo central para identificar:
- endpoints;
- métodos HTTP;
- parâmetros;
- headers;
- schemas;
- respostas;
- códigos de erro;
- estruturas de request/response.

Antes de criar ou modificar chamadas HTTP, conferir o Swagger.

### `manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf`

Manual oficial da API do Emissor Público Nacional.

Usar para entender:
- fluxo de emissão;
- operações disponíveis;
- consultas;
- eventos;
- respostas;
- regras de utilização da API.

---

## 2. Leiautes

### `anexo_i-sefin_adn-dps_nfse-sn...xlsx`

Arquivo principal de leiaute/regras da DPS/NFS-e.

É uma das principais fontes para:
- campos;
- tipos;
- tamanhos;
- obrigatoriedade;
- grupos;
- regras de negócio;
- estrutura da DPS/NFS-e.

### `anexo_i-sefin_adn-dps_nfse-sn...prodrestr...xlsx`

Versão específica de Produção Restrita/Homologação.

Não excluir.

Deve ser usada quando o sistema estiver sendo testado no ambiente de homologação.

### `anexo_iii-cnc...xlsx`

Leiaute relacionado ao CNC.

### `anexo_iv-adn...xlsx`

Leiaute relacionado ao ADN.

### `anexo_b-nbs2-lista_servico_nacional...xlsx`

Tabela/lista de serviços/NBS utilizada pela NFS-e Nacional.

### Anexos adicionais

Todos os anexos de leiaute/domínio presentes nesta pasta devem ser preservados até que sua aplicabilidade seja confirmada.

---

## 3. XSD / XML

### `esquemas-nfse-rtc-v1-01-20260727.zip`

Manter o arquivo original e, se possível, também extrair seu conteúdo para uma pasta `xsd/`.

Os XSDs devem ser tratados como fonte estrutural para validação do XML.

Não criar manualmente estruturas XML que contradigam os schemas.

O sistema deve, quando aplicável, validar o XML antes do envio.

---

## 4. IBS/CBS — Reforma Tributária

### `anexo-c-indop-ibscbs...xlsx`

Domínios relacionados ao IBS/CBS.

### `anexovii...indop_ibscbs...xlsx`

Tabela de códigos/regras relacionadas ao IBS/CBS.

### `anexovii-leiautesrn_rtc_ibscbs...xlsx`

Leiautes relacionados aos grupos IBS/CBS.

### `nt-009...pdf`

Nota Técnica 009.

**Atenção:** a existência deste arquivo não significa que todos os seus campos/regras devam ser enviados para o endpoint atualmente utilizado.

A NT009 deve ser confrontada com:
- Swagger atual;
- XSD atual;
- ambiente;
- cronograma oficial de implantação.

Não implementar campos da NT009 apenas porque eles aparecem no documento se o ambiente atual ainda não os aceitar.

---

## 5. DANFSe

### `nt-008-se-cgnfse-danfse...pdf`

Nota Técnica relacionada ao DANFSe.

Usar para entender as alterações do documento auxiliar e seu relacionamento com a NFS-e.

---

# Ambientes

A documentação oficial disponibiliza ambientes distintos.

## Produção Restrita

Ambiente de homologação/testes.

A documentação oficial de APIs deve ser consultada em:

https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao

## Produção

Ambiente real.

Não usar endpoints de Produção Restrita em produção.

---

# Regra de ouro para a implementação

A implementação deve responder claramente às seguintes perguntas antes de alterar código:

1. Qual endpoint é responsável pela emissão?
2. Qual endpoint consulta o processamento?
3. Qual é o formato exato da DPS?
4. Onde e como a DPS deve ser assinada?
5. Qual certificado é exigido?
6. Qual parte da assinatura ocorre no sistema e qual parte é exigida pela plataforma?
7. Quais headers são obrigatórios?
8. Qual é o formato do request?
9. Qual é o formato da resposta?
10. Como identificar uma emissão processada?
11. Como consultar a NFS-e posteriormente?
12. Como consultar eventos?
13. Como cancelar/substituir, quando aplicável?
14. Como obter o XML?
15. Como obter o DANFSe?
16. Quais erros podem ser retornados?
17. Quais validações devem ocorrer antes do envio?
18. Quais dados dependem da parametrização do município?
19. O que é específico de Produção Restrita?
20. O que é específico de Produção?

---

# Certificado Digital

O sistema deve considerar o fluxo de certificado digital definido oficialmente.

Não assumir que simplesmente possuir um arquivo `.pfx` é suficiente.

A implementação deve verificar na documentação:
- tipo de certificado aceito;
- formato;
- senha;
- armazenamento;
- carregamento;
- uso da chave privada;
- assinatura digital;
- cadeia de certificados;
- validade;
- tratamento de erro;
- segurança.

O certificado nunca deve ser:
- enviado para o frontend;
- gravado em logs;
- exposto em mensagens de erro;
- incluído em respostas da API;
- armazenado em texto puro se a arquitetura exigir proteção.

---

# Segurança

A integração deve respeitar a arquitetura de segurança existente do sistema.

Não:
- expor certificado ou senha;
- registrar XML assinado contendo dados sensíveis em logs desnecessários;
- registrar tokens;
- colocar credenciais no frontend;
- colocar segredos no Git;
- criar fallback de credenciais;
- ignorar validações de certificado.

---

# Estratégia de implementação

O código existente deve ser tratado como legado funcional a ser auditado, não como código a ser descartado automaticamente.

Fluxo recomendado:

```text
Código existente
      ↓
Mapeamento das rotas NFS-e
      ↓
Identificação dos serviços internos
      ↓
Confronto com Swagger
      ↓
Confronto com Manual
      ↓
Confronto com XSD
      ↓
Confronto com Leiautes/Regras
      ↓
Confronto com ambiente
      ↓
Correções pontuais
      ↓
Testes de homologação
      ↓
Validação de XML
      ↓
Produção