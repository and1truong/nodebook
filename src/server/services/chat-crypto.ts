import { AppError, ValidationError } from "../../domain/errors";

const encoder = new TextEncoder();

export interface EncryptedCredential { ciphertext: string; iv: string }

function decodeBase64(value: string): ArrayBuffer {
  try {
    const raw = atob(value);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
  } catch {
    throw new AppError("CHAT_CREDENTIAL_KEY must be base64-encoded", 500, "chat_key_invalid");
  }
}

function encodeBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importCredentialKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret?.trim()) throw new AppError("CHAT_CREDENTIAL_KEY is not configured", 500, "chat_key_missing");
  const bytes = decodeBase64(secret.trim());
  if (bytes.byteLength !== 32) throw new AppError("CHAT_CREDENTIAL_KEY must decode to exactly 32 bytes", 500, "chat_key_invalid");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(secret: string | undefined, connectionId: string, plaintext: string): Promise<EncryptedCredential> {
  if (!plaintext) throw new ValidationError("API key is required");
  const key = await importCredentialKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer, additionalData: encoder.encode(connectionId).buffer as ArrayBuffer },
    key,
    encoder.encode(plaintext).buffer as ArrayBuffer,
  );
  return { ciphertext: encodeBase64(ciphertext), iv: encodeBase64(iv) };
}

export async function decryptCredential(secret: string | undefined, connectionId: string, encrypted: EncryptedCredential): Promise<string> {
  const key = await importCredentialKey(secret);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(encrypted.iv), additionalData: encoder.encode(connectionId).buffer as ArrayBuffer },
      key,
      decodeBase64(encrypted.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new AppError("Stored provider credential could not be decrypted", 500, "chat_credential_unreadable");
  }
}
