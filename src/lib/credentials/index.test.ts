import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCredential,
  resetCredentialCache,
  __setCredentialChain,
  CredentialNotFoundError,
  CredentialIntegrityError,
} from "./index";
import type { CredentialProvider, CredentialRecord } from "./types";
import { sha256Hex } from "./checksum";
import { EnvironmentProvider } from "./providers/environment";
import { buildEnvelope } from "./providers/blob";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeProvider(
  name: string,
  result: CredentialRecord | null | Error,
): CredentialProvider {
  return {
    name,
    load: vi.fn(async (_key: string) => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("getCredential — chain resolution", () => {
  beforeEach(() => {
    resetCredentialCache();
  });

  afterEach(() => {
    __setCredentialChain(null);
    resetCredentialCache();
    vi.restoreAllMocks();
  });

  it("returns the first provider that has the key", async () => {
    const rec: CredentialRecord = { value: "payload", sha256: sha256Hex("payload"), source: "p1" };
    const p1 = makeProvider("p1", rec);
    const p2 = makeProvider("p2", null);
    __setCredentialChain([p1, p2]);

    const result = await getCredential("my-key");
    expect(result).toEqual(rec);
    expect((p1.load as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("my-key");
    expect((p2.load as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("skips a null provider and uses the second", async () => {
    const rec: CredentialRecord = { value: "v2", sha256: sha256Hex("v2"), source: "p2" };
    const p1 = makeProvider("p1", null);
    const p2 = makeProvider("p2", rec);
    __setCredentialChain([p1, p2]);

    const result = await getCredential("k");
    expect(result.source).toBe("p2");
  });

  it("throws CredentialNotFoundError when all providers return null", async () => {
    __setCredentialChain([makeProvider("a", null), makeProvider("b", null)]);
    await expect(getCredential("missing")).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it("propagates CredentialIntegrityError without caching", async () => {
    const integrityErr = new CredentialIntegrityError("k", "aaa", "bbb", "p1");
    const p1 = makeProvider("p1", integrityErr);
    __setCredentialChain([p1]);

    await expect(getCredential("k")).rejects.toBeInstanceOf(CredentialIntegrityError);
    // Second call must re-run provider (not cached)
    await expect(getCredential("k")).rejects.toBeInstanceOf(CredentialIntegrityError);
    expect((p1.load as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("caches successful results (provider called only once)", async () => {
    const rec: CredentialRecord = { value: "cached", sha256: sha256Hex("cached"), source: "p" };
    const p = makeProvider("p", rec);
    __setCredentialChain([p]);

    await getCredential("k");
    await getCredential("k");
    expect((p.load as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("resetCredentialCache clears the cache", async () => {
    const rec: CredentialRecord = { value: "x", sha256: sha256Hex("x"), source: "p" };
    const p = makeProvider("p", rec);
    __setCredentialChain([p]);

    await getCredential("k");
    resetCredentialCache("k");
    await getCredential("k");
    expect((p.load as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// EnvironmentProvider
// ---------------------------------------------------------------------------
describe("EnvironmentProvider", () => {
  const KEY_MAP = { "google-service-account": "GOOGLE_SERVICE_ACCOUNT_JSON" };
  const provider = new EnvironmentProvider(KEY_MAP);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when env var is absent", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    expect(await provider.load("google-service-account")).toBeNull();
  });

  it("returns null for unknown key", async () => {
    expect(await provider.load("unknown-key")).toBeNull();
  });

  it("returns record with correct sha256", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", '{"type":"service_account"}');
    const rec = await provider.load("google-service-account");
    expect(rec).not.toBeNull();
    expect(rec!.sha256).toBe(sha256Hex('{"type":"service_account"}'));
    expect(rec!.source).toBe("environment");
  });

  it("throws CredentialIntegrityError when _SHA256 var is present and wrong", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "realvalue");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON_SHA256", "0000000000000000");
    await expect(provider.load("google-service-account")).rejects.toBeInstanceOf(
      CredentialIntegrityError,
    );
  });

  it("passes when _SHA256 var matches", async () => {
    const val = "myvalue";
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", val);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON_SHA256", sha256Hex(val));
    const rec = await provider.load("google-service-account");
    expect(rec).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BlobProvider (checksum integrity via buildEnvelope)
// ---------------------------------------------------------------------------
describe("buildEnvelope + checksum", () => {
  it("round-trips: sha256 of value matches envelope.sha256", () => {
    const env = buildEnvelope('{"client_email":"sa@proj.iam.gserviceaccount.com"}', "2026-06-30T00:00:00Z");
    expect(env.sha256).toBe(sha256Hex(env.value));
    expect(env.algo).toBe("SHA-256");
    expect(env.createdAt).toBe("2026-06-30T00:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------
describe("sha256Hex", () => {
  it("produces a 64-char hex string", () => {
    expect(sha256Hex("hello")).toHaveLength(64);
    expect(sha256Hex("hello")).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
  });

  it("differs for different inputs", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });

  it("known vector: empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
