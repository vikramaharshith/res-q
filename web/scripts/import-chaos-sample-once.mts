import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runChaosSampleOnce, type ChaosOnceImporter } from "@/lib/simulation-import/chaos-import-once";

/**
 * One-shot local import of resq-handoff/sample-simulation.json.
 * importChaosOnServer performs the approval latch and the single RPC.
 * A failed call is final.
 */

const SERVER_ENV_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

type ServerEnvKey = (typeof SERVER_ENV_KEYS)[number];

function samplePath(): string {
  return fileURLToPath(new URL("../../resq-handoff/sample-simulation.json", import.meta.url));
}

function credentialsPresent(): boolean {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  return Boolean(url && process.env.SUPABASE_SECRET_KEY?.trim());
}

function fillUnset(key: ServerEnvKey, value: string): void {
  if (!process.env[key]?.trim() && value) process.env[key] = value;
}

function readEnvFile(filePath: string): void {
  let text = "";
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    if (!SERVER_ENV_KEYS.some((key) => key === name)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fillUnset(name as ServerEnvKey, value);
  }
}

function fillUnsetServerEnv(): void {
  if (credentialsPresent()) return;
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  readEnvFile(path.join(webRoot, ".env.local"));
  readEnvFile(path.join(webRoot, "..", ".env.local"));
}

const importOnce: ChaosOnceImporter = async (text, options) => {
  fillUnsetServerEnv();
  const { importChaosOnServer } = await import("@/lib/simulation-import/chaos-import-server");
  return await importChaosOnServer(text, options);
};

function executedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.normalize(path.resolve(entry)).toLowerCase() === path.normalize(fileURLToPath(import.meta.url)).toLowerCase();
}

async function main(): Promise<void> {
  if (process.argv.slice(2).length > 0) {
    console.log("Outcome: rejected");
    process.exitCode = 2;
    return;
  }
  const text = readFileSync(samplePath(), "utf8");
  const result = await runChaosSampleOnce(text, importOnce);
  console.log(result.output);
  process.exitCode = result.exitCode;
}

if (executedDirectly()) {
  try {
    await main();
  } catch {
    console.log("Outcome: rejected");
    process.exitCode = 1;
  }
}
