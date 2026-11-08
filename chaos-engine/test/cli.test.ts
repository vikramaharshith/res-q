import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { CHAOS_ENGINE_VERSION, PUBLIC_SIMULATION_SCHEMA_VERSION, runChaosCli } from "../src/index.js";

function capture() { const out: string[] = []; const err: string[] = []; return { out, err, io: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) } }; }

describe("Phase 7B CLI discovery and argument handling", () => {
  it("prints help, version, scenario, and difficulty listings", async () => {
    for (const command of ["help", "version", "presets"] as const) { const c = capture(); assert.equal(await runChaosCli([command], c.io), 0); assert.equal(c.err.length, 0); const text = c.out.join("\n"); if (command === "help") assert.match(text, /simulate[\s\S]*replay/); if (command === "version") { assert.match(text, new RegExp(CHAOS_ENGINE_VERSION.replaceAll(".", "\\."))); assert.match(text, new RegExp(PUBLIC_SIMULATION_SCHEMA_VERSION.replaceAll(".", "\\."))); } if (command === "presets") for (const value of ["flood", "earthquake", "storm", "fire", "CALM", "BUSY", "CHAOS", "EXTREME"]) assert.match(text, new RegExp(value, "i")); }
  });

  it("rejects unknown commands, options, scenarios, difficulties, and invalid numeric overrides", async () => {
    const cases = [["unknown"], ["preview", "--bad", "x"], ["preview", "--scenario", "ocean"], ["preview", "--difficulty", "impossible"], ["preview", "--reports", "0"], ["preview", "--responders", "1001"], ["preview", "--duration", "5"]];
    for (const args of cases) { const c = capture(); assert.equal(await runChaosCli(args, c.io), 2); assert.match(c.err[0] ?? "", /Chaos Engine error/); }
  });
});

describe("Phase 7B preview and overrides", () => {
  it("runs calm and busy previews with selected scenario, difficulty, seed, and ordered public timeline", async () => {
    for (const [scenario, difficulty] of [["flood", "calm"], ["earthquake", "busy"]]) { const c = capture(); assert.equal(await runChaosCli(["preview", "--scenario", scenario!, "--difficulty", difficulty!, "--seed", "preview-seed", "--samples", "4"], c.io), 0); const text = c.out.join("\n"); assert.match(text, /FICTIONAL SIMULATION/); assert.match(text, new RegExp(`Difficulty: ${difficulty!.toUpperCase()}`)); assert.match(text, /Seed: preview-seed/); assert.doesNotMatch(text, /internalIncidentId|sourceQuality|cascadeDepth|severity:/); const times = [...text.matchAll(/^  (\d{4}-[^ ]+)/gm)].map((match) => match[1]!); assert.deepEqual(times, [...times].sort()); }
  });

  it("applies safe report, responder, and duration overrides reproducibly", async () => { const c = capture(); assert.equal(await runChaosCli(["preview", "--scenario", "storm", "--difficulty", "calm", "--seed", "override", "--reports", "12", "--responders", "4", "--duration", "600000", "--samples", "0"], c.io), 0); const text = c.out.join("\n"); assert.match(text, /Reports: 12 base/); assert.match(text, /Responders: 4/); assert.match(text, /Scenario: Severe Storm/); });
});

describe("Phase 7B simulate, validate, and replay", () => {
  it("exports, validates, replays byte-identically, refuses overwrite, and preserves the original", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chaos-cli-")); const file = join(directory, "simulation.json");
    try {
      const simulate = capture(); assert.equal(await runChaosCli(["simulate", "--scenario", "fire", "--difficulty", "calm", "--seed", "replay-42", "--reports", "20", "--responders", "5", "--duration", "600000", "--out", file], simulate.io), 0); assert.match(simulate.out.join("\n"), /Export:/);
      const original = await readFile(file, "utf8"); const document = JSON.parse(original) as { replayManifest: Record<string, unknown> }; for (const key of ["presetVersion", "engineVersion", "schemaVersion", "scenario", "difficulty", "seed", "reportCount", "responderCount", "durationMs"]) assert.ok(key in document.replayManifest);
      const validate = capture(); assert.equal(await runChaosCli(["validate", "--input", file], validate.io), 0); assert.match(validate.out[0] ?? "", /VALID/);
      const replay = capture(); assert.equal(await runChaosCli(["replay", "--input", file], replay.io), 0); assert.match(replay.out[0] ?? "", /REPLAY MATCH/); assert.equal(await readFile(file, "utf8"), original);
      const collision = capture(); assert.equal(await runChaosCli(["simulate", "--scenario", "fire", "--difficulty", "calm", "--seed", "replay-42", "--reports", "20", "--responders", "5", "--duration", "600000", "--out", file], collision.io), 1); assert.match(collision.err[0] ?? "", /already exists/);
      const overwrite = capture(); assert.equal(await runChaosCli(["simulate", "--scenario", "fire", "--difficulty", "calm", "--seed", "replay-42", "--reports", "20", "--responders", "5", "--duration", "600000", "--out", file, "--overwrite"], overwrite.io), 0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects invalid JSON, missing manifests, and incompatible replay versions with nonzero exit codes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chaos-cli-invalid-"));
    try {
      const invalid = join(directory, "invalid.json"); await writeFile(invalid, "not-json", "utf8"); const a = capture(); assert.equal(await runChaosCli(["validate", "--input", invalid], a.io), 1);
      const missing = join(directory, "missing.json"); await writeFile(missing, "{}", "utf8"); const b = capture(); assert.equal(await runChaosCli(["replay", "--input", missing], b.io), 1);
      const valid = join(directory, "valid.json"); const sim = capture(); assert.equal(await runChaosCli(["simulate", "--reports", "5", "--responders", "2", "--duration", "600000", "--out", valid], sim.io), 0); const doc = JSON.parse(await readFile(valid, "utf8")); doc.replayManifest.engineVersion = "999.0.0"; await writeFile(valid, JSON.stringify(doc), "utf8"); const c = capture(); assert.equal(await runChaosCli(["replay", "--input", valid], c.io), 1); assert.match(c.err[0] ?? "", /invalid|incompatible/i);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("contains no external service or application integration imports", async () => { const source = await readFile(new URL("../src/cli/chaos-cli.ts", import.meta.url), "utf8"); for (const forbidden of ["supabase", "nemotron", "next/", "react", "RES-Q/"]) assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false); });
});
