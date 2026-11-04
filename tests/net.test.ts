import { describe, it, expect } from "vitest";
import { isPrivateIp, assertSafePublicUrl } from "@/lib/net";

describe("isPrivateIp", () => {
  it("flags private / loopback / metadata ranges", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("172.16.5.5")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true); // cloud metadata
    expect(isPrivateIp("::1")).toBe(true);
  });
  it("allows public addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });
});

describe("assertSafePublicUrl", () => {
  it("rejects non-http protocols", async () => {
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertSafePublicUrl("ftp://example.com")).rejects.toThrow();
  });
  it("rejects localhost and private IP literals", async () => {
    await expect(assertSafePublicUrl("http://localhost/x")).rejects.toThrow();
    await expect(assertSafePublicUrl("http://127.0.0.1/x")).rejects.toThrow();
    await expect(assertSafePublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
  });
});
