import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { redactServerText as redactShared } from "@/lib/security/redact";

/**
 * Privileged Supabase access for server modules.
 * The secret key is read here and must not be imported from a Client Component.
 */

let serverClient: SupabaseClient | undefined;

export function redactServerText(value: string): string {
  return redactShared(value);
}

function readSupabaseUrl(): string {
  const raw =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "";
  if (!raw) {
    throw new Error("Supabase URL is not configured for the server.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Supabase URL is not valid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Supabase URL must be an https origin without credentials.");
  }
  return parsed.origin;
}

function jwtRole(token: string): string | null {
  const parts = token.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

function readSupabaseSecret(): string {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!secret) {
    throw new Error("Supabase server credential is not configured.");
  }
  if (
    secret.startsWith("sb_publishable_") ||
    secret.startsWith("sb_anon_") ||
    (publishable !== undefined && secret === publishable)
  ) {
    throw new Error("Supabase server credential must be the secret key.");
  }
  if (secret.startsWith("eyJ") && jwtRole(secret) !== "service_role") {
    throw new Error("Supabase server credential must be a service-role key.");
  }
  return secret;
}

export function createSupabaseServerClient(): SupabaseClient {
  if (serverClient) return serverClient;
  serverClient = createClient(readSupabaseUrl(), readSupabaseSecret(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch(input, init) {
        return fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal ?? AbortSignal.timeout(12_000),
        });
      },
    },
  });
  return serverClient;
}
