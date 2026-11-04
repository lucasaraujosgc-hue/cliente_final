import { SignedXml } from "xml-crypto";
import { NfseError } from "./errors";

// XMLDSig enveloped signature for the Sistema Nacional NFS-e, following the same
// conventions the NF-e/CT-e use (and which the NFS-e nacional adopted):
//
//   CanonicalizationMethod  C14N inclusivo (REC-xml-c14n-20010315)
//   SignatureMethod         RSA-SHA1
//   Transforms              enveloped-signature + C14N inclusivo
//   DigestMethod            SHA1
//   KeyInfo                 X509Data com um único X509Certificate
//   Posição                 <Signature> como filho do elemento raiz, logo após
//                           o elemento assinado (infDPS / infPedReg)
//
// Algoritmos sobrescrevíveis por env caso o gov.br migre para SHA-256.

const SIG_ALG =
  process.env.NFSE_SIGNATURE_ALG || "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const DIGEST_ALG =
  process.env.NFSE_DIGEST_ALG || "http://www.w3.org/2000/09/xmldsig#sha1";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

export interface SignOptions {
  /** local-name of the element carrying the `Id` attribute to sign. */
  refElement: string; // "infDPS" | "infPedReg"
  /** value of that element's `Id` attribute (for the Reference URI). */
  refId: string;
  keyPem: string;
  certPem: string;
}

// Strip PEM armor / whitespace so it goes into <X509Certificate> as raw base64.
function certToBase64(certPem: string): string {
  return certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

export function signEnveloped(xml: string, opts: SignOptions): string {
  const xpath = `//*[local-name(.)='${opts.refElement}']`;
  try {
    const sig = new SignedXml({
      privateKey: opts.keyPem,
      publicCert: opts.certPem,
      signatureAlgorithm: SIG_ALG,
      canonicalizationAlgorithm: C14N,
    });

    // Emit KeyInfo with the raw cert (NF-e style, no whitespace).
    sig.getKeyInfoContent = () =>
      `<X509Data><X509Certificate>${certToBase64(opts.certPem)}</X509Certificate></X509Data>`;

    sig.addReference({
      xpath,
      digestAlgorithm: DIGEST_ALG,
      transforms: [ENVELOPED, C14N],
      uri: opts.refId,
      isEmptyUri: false,
    });

    sig.computeSignature(xml, {
      location: { reference: xpath, action: "after" },
    });

    return sig.getSignedXml();
  } catch (e: any) {
    throw new NfseError(`Falha ao assinar o XML (${opts.refElement}): ${e?.message || e}`, {
      status: 500,
      reason: "sign_failed",
    });
  }
}

export function signDps(xml: string, idDps: string, keyPem: string, certPem: string): string {
  return signEnveloped(xml, { refElement: "infDPS", refId: idDps, keyPem, certPem });
}

export function signPedRegEvento(
  xml: string,
  idPedReg: string,
  keyPem: string,
  certPem: string,
): string {
  return signEnveloped(xml, { refElement: "infPedReg", refId: idPedReg, keyPem, certPem });
}
