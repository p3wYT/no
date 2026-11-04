// SSRF-safe URL validation for any remote media URL we are asked to fetch.
// Rejects private / loopback / link-local / metadata ranges and non-HTTP(S).

import { lookup } from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) {
      return true;
    }
    // IPv4-mapped
    const m = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return false;
}

export async function assertSafePublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Host not allowed");
  }
  // If the host is already an IP literal, check directly.
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error("Private address not allowed");
    return url;
  }
  // Resolve and verify every A/AAAA record is public.
  const records = await lookup(url.hostname, { all: true });
  if (!records.length) throw new Error("Host did not resolve");
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new Error("Resolves to a private address");
  }
  return url;
}

export { isPrivateIp };
