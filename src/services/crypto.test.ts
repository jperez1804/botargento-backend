import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto.js";

describe("crypto service", () => {
  it("encrypts and decrypts a token roundtrip", () => {
    const original = "EAABwzLixnjYBO_test_token_12345";
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const original = "same_input";
    const a = encrypt(original);
    const b = encrypt(original);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(original);
    expect(decrypt(b)).toBe(original);
  });

  it("handles empty string", () => {
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles unicode and special characters", () => {
    const original = "Contraseña secreta 🔐 with áccénts";
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("handles long tokens", () => {
    const original = "A".repeat(10000);
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encrypt("test");
    const tampered = encrypted.slice(0, -2) + "AA";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects truncated ciphertext", () => {
    const encrypted = encrypt("test");
    const truncated = encrypted.slice(0, 10);
    expect(() => decrypt(truncated)).toThrow();
  });

  it("returns base64-encoded string", () => {
    const encrypted = encrypt("test");
    expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
    const decoded = Buffer.from(encrypted, "base64");
    // iv (12) + authTag (16) + ciphertext (>=0)
    expect(decoded.length).toBeGreaterThanOrEqual(28);
  });
});
