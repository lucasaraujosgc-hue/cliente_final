import { describe, it, expect, beforeAll } from "vitest";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";
import { signDps } from "../sign";
import { buildDpsXml, type BuildDpsInput } from "../dps";

const dpsInput: BuildDpsInput = {
  ambiente: "homologacao",
  serie: "00001",
  numero: 1,
  competencia: "08/2026",
  dhEmi: new Date("2026-08-31T12:00:00Z"),
  cLocEmi: "3550308",
  prestador: { cnpj: "12345678000199", nome: "Teste LTDA", regimeTributario: "simples_nacional" },
  tomador: { doc: "98765432000110", nome: "Tomador SA" },
  servico: { cTribNac: "040160", descricao: "Serviço de teste" },
  valores: { valorServicosCentavos: 10000, aliquotaIss: 2, issRetido: false, exigibilidadeIss: "1" },
};

let keyPem = "";
let certPem = "";
let idDps = "";
let signed = "";

beforeAll(() => {
  // Self-signed cert — only a working RSA keypair + X509 wrapper is needed.
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 864e5);
  const attrs = [{ name: "commonName", value: "TESTE LTDA:12345678000199" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  certPem = forge.pki.certificateToPem(cert);

  const built = buildDpsXml(dpsInput);
  idDps = built.idDps;
  signed = signDps(built.xml, idDps, keyPem, certPem);
});

describe("signDps (XMLDSig enveloped)", () => {
  it("adds a Signature as a child of DPS, after infDPS", () => {
    expect(signed).toContain("<Signature");
    expect(signed.indexOf("</infDPS>")).toBeLessThan(signed.indexOf("<Signature"));
    const doc = new DOMParser().parseFromString(signed, "text/xml");
    const sig = doc.getElementsByTagName("Signature")[0];
    expect(sig.parentNode?.nodeName).toBe("DPS");
  });

  it("references #<idDps> with enveloped + c14n transforms and SHA1 digest", () => {
    expect(signed).toContain(`URI="#${idDps}"`);
    expect(signed).toContain("http://www.w3.org/2000/09/xmldsig#enveloped-signature");
    expect(signed).toContain("http://www.w3.org/TR/2001/REC-xml-c14n-20010315");
    expect(signed).toContain("http://www.w3.org/2000/09/xmldsig#sha1");
  });

  it("embeds the signing certificate in KeyInfo/X509Certificate", () => {
    const b64 = certPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    expect(signed).toContain(`<X509Certificate>${b64}</X509Certificate>`);
  });

  it("produces a cryptographically valid signature", () => {
    const verifier = new SignedXml({ publicCert: certPem });
    const doc = new DOMParser().parseFromString(signed, "text/xml");
    verifier.loadSignature(doc.getElementsByTagName("Signature")[0] as any);
    expect(verifier.checkSignature(signed)).toBe(true);
  });

  it("fails verification if the signed content is tampered with", () => {
    const tampered = signed.replace("<vServ>100.00</vServ>", "<vServ>999.00</vServ>");
    const verifier = new SignedXml({ publicCert: certPem });
    const doc = new DOMParser().parseFromString(tampered, "text/xml");
    verifier.loadSignature(doc.getElementsByTagName("Signature")[0] as any);
    let ok = false;
    try {
      ok = verifier.checkSignature(tampered);
    } catch {
      ok = false;
    }
    expect(ok).toBe(false);
  });
});
