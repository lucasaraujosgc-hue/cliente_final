import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import https from "https";
import tls from "tls";
import type { AddressInfo } from "net";

vi.mock("../../../db", () => ({ db: {}, pool: {} }));

import { parsePfx, mtlsCredentials, type MtlsCredentials } from "../cert";
import { NfseError } from "../errors";
import {
  LEGACY_PFX_B64,
  MODERN_PFX_B64,
  PFX_PASSWORD,
  LEAF_CN,
  LEAF_CNPJ,
  ROOT_CA_PEM,
  SERVER_CERT_PEM,
  SERVER_KEY_PEM,
} from "./fixtures/pfx";

const legacy = Buffer.from(LEGACY_PFX_B64, "base64");
const modern = Buffer.from(MODERN_PFX_B64, "base64");

// Does THIS Node hand the legacy .pfx to OpenSSL without complaint? Not on a
// default Node 17+ (OpenSSL 3) — but true under --openssl-legacy-provider.
function nativeOpens(pfx: Buffer): boolean {
  try {
    tls.createSecureContext({ pfx, passphrase: PFX_PASSWORD });
    return true;
  } catch {
    return false;
  }
}

describe("parsePfx", () => {
  it("opens a legacy (RC2-40) .pfx and reads the e-CNPJ", () => {
    const p = parsePfx(legacy, PFX_PASSWORD);
    expect(p.subjectCN).toBe(LEAF_CN);
    expect(p.cnpj).toBe(LEAF_CNPJ);
  });

  it("builds the chain: leaf first, then the intermediate, no root", () => {
    const p = parsePfx(legacy, PFX_PASSWORD);
    expect(p.chainPem.match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
    expect(p.chainPem.startsWith(p.certPem)).toBe(true);
  });

  it("rejects a wrong password as a user error", () => {
    expect(() => parsePfx(legacy, "errada")).toThrow(NfseError);
  });
});

describe("mtlsCredentials", () => {
  it("keeps a modern .pfx on the native path", () => {
    expect(mtlsCredentials(modern, PFX_PASSWORD).modo).toBe("pfx");
  });

  // The production failure: `Unsupported PKCS12 PFX data` at connect time.
  it("falls back to key + chain when OpenSSL refuses the .pfx", () => {
    const creds = mtlsCredentials(legacy, PFX_PASSWORD);
    expect(creds.modo).toBe(nativeOpens(legacy) ? "pfx" : "pem");
    // Whatever the path, the result must be loadable by tls.
    expect(() => tls.createSecureContext(creds.options)).not.toThrow();
  });

  it("surfaces a wrong password as a certificate error, not a connection error", () => {
    expect(() => mtlsCredentials(legacy, "errada")).toThrow(NfseError);
  });
});

// A server that demands a client certificate and trusts ONLY the root: the
// handshake succeeds only if the client presents leaf + intermediate — i.e. the
// PEM fallback must carry the chain the .pfx carried.
describe("mTLS handshake", () => {
  let server: https.Server;
  let port = 0;

  beforeAll(async () => {
    server = https.createServer(
      {
        key: SERVER_KEY_PEM,
        cert: SERVER_CERT_PEM,
        ca: [ROOT_CA_PEM],
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        const peer = (req.socket as tls.TLSSocket).getPeerCertificate();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ cn: peer?.subject?.CN ?? null }));
      },
    );
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((ok) => server.close(() => ok()));
  });

  function call(creds: MtlsCredentials): Promise<{ status: number; cn: string | null }> {
    return new Promise((resolve, reject) => {
      const agent = new https.Agent({ ...creds.options, ca: ROOT_CA_PEM });
      const req = https.request(
        { host: "127.0.0.1", port, servername: "localhost", path: "/", method: "GET", agent },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            agent.destroy();
            resolve({ status: res.statusCode || 0, cn: JSON.parse(body).cn });
          });
        },
      );
      req.on("error", (e) => {
        agent.destroy();
        reject(e);
      });
      req.end();
    });
  }

  it("connects with the legacy .pfx", async () => {
    expect(await call(mtlsCredentials(legacy, PFX_PASSWORD))).toEqual({ status: 200, cn: LEAF_CN });
  });

  it("connects with the modern .pfx", async () => {
    expect(await call(mtlsCredentials(modern, PFX_PASSWORD))).toEqual({ status: 200, cn: LEAF_CN });
  });

  it("is refused without the intermediate — the chain is what makes it work", async () => {
    const p = parsePfx(legacy, PFX_PASSWORD);
    const leafOnly: MtlsCredentials = { modo: "pem", options: { key: p.keyPem, cert: p.certPem } };
    await expect(call(leafOnly)).rejects.toThrow();
  });
});
