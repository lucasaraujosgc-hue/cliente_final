import fs from "fs";
import https from "https";
import forge from "node-forge";
import { db } from "../../db";
import { nfseConfig } from "../../schema";
import { eq } from "drizzle-orm";
import { decryptBytes, decryptSecret } from "../secretbox";
import { normalizeCnpj } from "../../../lib/cnpj";
import { NfseError, certMissing, notConfigured } from "./errors";
import type { NfseConfigRow } from "../../types";

// Certificate handling for the NFS-e emitter.
//
// Each client emits with THEIR OWN ICP-Brasil A1 certificate (.pfx/.p12). The
// accountant uploads it on the client's behalf; it is stored AES-256-GCM
// encrypted on disk (services/secretbox.ts, magic ENCv1\0) and decrypted only
// in memory here — to build the mTLS agent and, for signing, to hand the PEM
// key/cert to services/nfse/sign.ts. It is NEVER returned by any API.

export interface ParsedCert {
  cnpj: string | null; // 14 digits from the subject, when we can read it
  subjectCN: string;
  notBefore: Date;
  notAfter: Date;
  keyPem: string;
  certPem: string;
}

// OID 2.16.76.1.3.3 (ICP-Brasil: CNPJ da pessoa jurídica) → DER marker.
const OID_ICPBR_CNPJ = Buffer.from([0x06, 0x05, 0x60, 0x4c, 0x01, 0x03, 0x03]);

function cnpjFromCn(cn: string): string | null {
  // e-CNPJ subject CN is usually "RAZAO SOCIAL:12345678000199".
  const m = cn.match(/(\d{14})\s*$/);
  return m ? m[1] : null;
}

function cnpjFromDer(der: Buffer): string | null {
  const at = der.indexOf(OID_ICPBR_CNPJ);
  if (at < 0) return null;
  // The CNPJ (14 ASCII digits) sits within the next ~24 bytes, wrapped in a
  // context tag + string. Grab the first 14-digit run.
  const window = der.subarray(at + OID_ICPBR_CNPJ.length, at + OID_ICPBR_CNPJ.length + 40).toString("latin1");
  const m = window.match(/\d{14}/);
  return m ? m[0] : null;
}

// Parse a .pfx/.p12 buffer. Throws NfseError (status 400) on a wrong password or
// an unreadable file — those are user errors, not server errors.
export function parsePfx(pfxBuffer: Buffer, senha: string): ParsedCert {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e: any) {
    throw new NfseError(
      "Não foi possível abrir o certificado. Verifique se o arquivo é um .pfx/.p12 válido e se a senha está correta.",
      { status: 400, reason: "cert_invalid" },
    );
  }

  // Private key
  let keyObj: forge.pki.PrivateKey | undefined;
  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ];
  const plainKey = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
  keyObj = shrouded?.[0]?.key ?? plainKey?.[0]?.key ?? undefined;
  if (!keyObj) {
    throw new NfseError("Certificado sem chave privada legível.", { status: 400, reason: "cert_invalid" });
  }

  // Certificate(s) — pick the leaf (the one with a CN that looks like an e-CNPJ,
  // else the first).
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certs = certBags.map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  if (certs.length === 0) {
    throw new NfseError("Certificado sem cadeia de certificados legível.", { status: 400, reason: "cert_invalid" });
  }
  const leaf =
    certs.find((c) => /:\d{14}$/.test(String(c.subject.getField("CN")?.value || ""))) ?? certs[0];

  const subjectCN = String(leaf.subject.getField("CN")?.value || "");
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes(), "binary");
  const cnpj = normalizeCnpj(cnpjFromCn(subjectCN) || cnpjFromDer(der) || "") || null;

  return {
    cnpj: cnpj && cnpj.length === 14 ? cnpj : null,
    subjectCN,
    notBefore: leaf.validity.notBefore,
    notAfter: leaf.validity.notAfter,
    keyPem: forge.pki.privateKeyToPem(keyObj as forge.pki.rsa.PrivateKey),
    certPem: forge.pki.certificateToPem(leaf),
  };
}

// --- mTLS agent (cached per client + cert mtime) ------------------------------

interface AgentCache {
  agent: https.Agent;
  parsed: ParsedCert;
  mtimeMs: number;
}
const agentCache = new Map<string, AgentCache>();

export interface ClientCertContext {
  config: NfseConfigRow;
  senha: string;
  pfxBuffer: Buffer;
  agent: https.Agent;
  parsed: ParsedCert; // keyPem / certPem for signing, cnpj + validity
}

// Loads a client's NFS-e config, decrypts the certificate in memory, and returns
// an mTLS https.Agent + the parsed key/cert ready for the Sefin Nacional calls.
// Throws NfseError with reason 'not_configured' / 'cert_missing' / 'cert_expired'
// the callers can map to an outcome.
export async function loadClientCertContext(clientId: string): Promise<ClientCertContext> {
  const [config] = await db.select().from(nfseConfig).where(eq(nfseConfig.clientId, clientId));
  if (!config) throw notConfigured();
  if (!config.certPath) throw certMissing();

  let pfxBuffer: Buffer;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(config.certPath);
    pfxBuffer = decryptBytes(await fs.promises.readFile(config.certPath));
  } catch {
    throw certMissing();
  }

  const senha = decryptSecret(config.certSenha) || "";

  const cacheKey = `${clientId}:${config.certPath}`;
  const cached = agentCache.get(cacheKey);
  let agent: https.Agent;
  let parsed: ParsedCert;
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    agent = cached.agent;
    parsed = cached.parsed;
  } else {
    parsed = parsePfx(pfxBuffer, senha);
    agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: senha,
      keepAlive: true,
      rejectUnauthorized: true,
    });
    agentCache.set(cacheKey, { agent, parsed, mtimeMs: stat.mtimeMs });
  }

  if (parsed.notAfter.getTime() <= Date.now()) {
    throw new NfseError(
      `Certificado digital vencido em ${parsed.notAfter.toLocaleDateString("pt-BR")}. Reenvie um certificado válido.`,
      { status: 400, reason: "cert_expired" },
    );
  }

  return { config, senha, pfxBuffer, agent, parsed };
}

export function clearAgentCache(clientId?: string) {
  if (!clientId) return agentCache.clear();
  for (const k of agentCache.keys()) if (k.startsWith(`${clientId}:`)) agentCache.delete(k);
}

// True when the cert's CNPJ shares the 8-digit root (CNPJ raiz) with the client.
export function cnpjRaizMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = normalizeCnpj(a);
  const db_ = normalizeCnpj(b);
  return da.length >= 8 && db_.length >= 8 && da.slice(0, 8) === db_.slice(0, 8);
}
