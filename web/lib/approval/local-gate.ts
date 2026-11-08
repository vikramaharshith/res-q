import { createHmac, timingSafeEqual } from "node:crypto";

export const LOCAL_DEMO_COOKIE = "resq_local_demo";
export const LOCAL_DEMO_HEADER = "x-resq-local-demo";
const TOKEN_LABEL = "resq-local-demo-v1";

export function localDemoToken(secret: string): string {
  return createHmac("sha256", secret).update(TOKEN_LABEL).digest("hex");
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function isLoopbackHost(hostHeader: string): boolean {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end <= 1) return false;
    return isLoopbackHostname(host.slice(1, end));
  }
  return isLoopbackHostname(host.replace(/:\d+$/, ""));
}

/**
 * True for the peer address Next.js records on a direct loopback socket.
 * A forwarded chain, a public address, or a proxy-only header stays false.
 */
export function isLoopbackAddress(value: string): boolean {
  let address = value.trim().toLowerCase().replace(/^"|"$/g, "");
  if (!address) return false;
  if (address.startsWith("[")) {
    const end = address.indexOf("]");
    if (end <= 1) return false;
    address = address.slice(1, end);
  }
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  if (address.startsWith("::ffff:")) address = address.slice("::ffff:".length);
  return isLoopbackHostname(address);
}

/**
 * Next.js fills x-forwarded-for and x-forwarded-host for every request,
 * including a browser on this machine. Those two headers count as a proxy
 * only when they are not the single loopback hop Next itself records.
 * x-real-ip and cf-connecting-ip are not added by Next or the browser.
 */
export function requestArrivedThroughProxy(input: {
  hostHeader: string | null;
  forwardedFor: string | null;
  forwardedHost: string | null;
  realIp: string | null;
  connectingIp: string | null;
}): boolean {
  if (input.realIp || input.connectingIp) return true;
  if (input.forwardedFor !== null) {
    const hops = input.forwardedFor.split(",").map((part) => part.trim()).filter(Boolean);
    if (hops.length !== 1 || !isLoopbackAddress(hops[0] ?? "")) return true;
  }
  if (input.forwardedHost !== null) {
    const presented = input.forwardedHost.trim().toLowerCase();
    const host = (input.hostHeader ?? "").trim().toLowerCase();
    if (!presented || presented !== host || !isLoopbackHost(presented)) return true;
  }
  return false;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    if (trimmed.slice(0, separator) !== name) continue;
    return trimmed.slice(separator + 1);
  }
  return null;
}

function tokensMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export interface LocalGateInput {
  url: string;
  hostHeader: string | null;
  forwardedFor: string | null;
  forwardedHost: string | null;
  realIp: string | null;
  connectingIp: string | null;
  cookieHeader: string | null;
  demoHeader: string | null;
  secret: string | null;
  enabled: boolean;
}

export function assertLocalDemoGate(
  input: LocalGateInput,
): { ok: true } | { ok: false; message: string } {
  if (!input.enabled) {
    return {
      ok: false,
      message:
        "Local approval writes are turned off. Set RESQ_LOCAL_APPROVALS=1 in the server environment and restart. This demo has no authenticated operator. Nothing was assigned.",
    };
  }
  if (
    requestArrivedThroughProxy({
      hostHeader: input.hostHeader,
      forwardedFor: input.forwardedFor,
      forwardedHost: input.forwardedHost,
      realIp: input.realIp,
      connectingIp: input.connectingIp,
    })
  ) {
    return {
      ok: false,
      message:
        "Approval requests that arrive through a proxy are refused. Open the simulation on this machine. Nothing was assigned.",
    };
  }
  let hostname = "";
  try {
    hostname = new URL(input.url).hostname;
  } catch {
    hostname = "";
  }
  if (!input.hostHeader || !isLoopbackHost(input.hostHeader) || !isLoopbackHostname(hostname)) {
    return {
      ok: false,
      message:
        "Approvals are limited to a browser on this computer. Nothing was assigned.",
    };
  }
  if (!input.secret) {
    return {
      ok: false,
      message:
        "The local demonstration credential is not configured. Nothing was assigned.",
    };
  }
  if (input.demoHeader !== "1") {
    return {
      ok: false,
      message:
        "The approval request is missing its local demonstration header. Nothing was assigned.",
    };
  }
  const presented = readCookie(input.cookieHeader, LOCAL_DEMO_COOKIE);
  if (!presented || !tokensMatch(presented, localDemoToken(input.secret))) {
    return {
      ok: false,
      message:
        "This browser does not have the local demonstration credential. Refresh the command center on localhost. Nothing was assigned.",
    };
  }
  return { ok: true };
}
