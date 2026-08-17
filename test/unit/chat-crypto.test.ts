import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "../../src/server/services/chat-crypto";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("chat credential encryption", () => {
  it("round-trips with connection authenticated data", async () => {
    const encrypted = await encryptCredential(KEY, "connection-a", "secret-api-key");
    expect(encrypted.ciphertext).not.toContain("secret-api-key");
    await expect(decryptCredential(KEY, "connection-a", encrypted)).resolves.toBe("secret-api-key");
  });

  it("rejects tampering and a different connection id", async () => {
    const encrypted = await encryptCredential(KEY, "connection-a", "secret-api-key");
    await expect(decryptCredential(KEY, "connection-b", encrypted)).rejects.toMatchObject({ code: "chat_credential_unreadable" });
    const ciphertext = encrypted.ciphertext.slice(0, -2) + "AA";
    await expect(decryptCredential(KEY, "connection-a", { ...encrypted, ciphertext })).rejects.toMatchObject({ code: "chat_credential_unreadable" });
  });
});
