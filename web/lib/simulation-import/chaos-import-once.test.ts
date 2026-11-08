import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SAMPLE_CHAOS_DESTINATION,
  SAMPLE_CHAOS_DIGEST_HEX,
  SAMPLE_CHAOS_SEED,
  SAMPLE_IMPORT_APPROVAL,
  chaosServerCallAllowed,
  runControlledChaosImport,
} from "@/lib/simulation-import/chaos-import";
import { runChaosSampleOnce, type ChaosOnceImporter } from "@/lib/simulation-import/chaos-import-once";

const sampleText = readFileSync(new URL("../../../resq-handoff/sample-simulation.json", import.meta.url), "utf8");
const importRunId = `cimp_run_${SAMPLE_CHAOS_DIGEST_HEX.slice(0, 32)}`;

const READY_OUTPUT = [
  "Outcome: STAGED",
  `Import: ${importRunId}`,
  "Emergency: 2",
  "Operational: 7",
  "Units: 1",
  "Assignments: 1",
].join("\n");

function assertNoSecrets(value: string): void {
  if (/eyJ|sb_|nvapi-|SUPABASE_SECRET|BEGIN |service_role/i.test(value)) {
    throw new Error("Command output contained a credential marker.");
  }
}

test("the one-shot runner checks the sample identity and calls the importer once", async () => {
  let calls = 0;
  const importer: ChaosOnceImporter = async (text, options) => {
    calls += 1;
    assert.equal(text, sampleText);
    assert.equal(options.mode, "apply");
    const destination: string = options.destinationScenarioId;
    assert.equal(destination === "scn_demo_flood", false);
    assert.equal(options.destinationScenarioId, SAMPLE_CHAOS_DESTINATION);
    return {
      ok: true,
      mode: "apply",
      outcome: "staged",
      code: "STAGED",
      invoked: true,
      databaseWrites: true,
      externalCalls: true,
      remoteChecked: true,
      importRunId,
    };
  };
  const staged = await runChaosSampleOnce(sampleText, importer);
  assert.equal(calls, 1);
  assert.equal(staged.exitCode, 0);
  assert.equal(staged.output, READY_OUTPUT);
  assert.equal(staged.output.includes(SAMPLE_CHAOS_DIGEST_HEX), false);
  assert.equal(staged.output.includes(SAMPLE_CHAOS_SEED), false);
  assertNoSecrets(staged.output);

  const duplicate = await runChaosSampleOnce(sampleText, async () => ({
    ok: false,
    mode: "apply",
    outcome: "duplicate",
    code: "DUPLICATE_IMPORT",
    message: `hidden ${SAMPLE_CHAOS_SEED}`,
    invoked: true,
    databaseWrites: false,
    externalCalls: true,
    remoteChecked: true,
  }));
  assert.equal(duplicate.exitCode, 1);
  assert.match(duplicate.output, /^Outcome: DUPLICATE_IMPORT/);
  assert.equal(duplicate.output.includes(SAMPLE_CHAOS_SEED), false);

  const foreign = "cimp_run_" + "ab".repeat(16);
  const mismatched = await runChaosSampleOnce(sampleText, async () => ({
    ok: true,
    mode: "apply",
    outcome: "staged",
    code: "STAGED",
    invoked: true,
    databaseWrites: true,
    externalCalls: true,
    remoteChecked: true,
    importRunId: foreign,
  }));
  assert.equal(mismatched.exitCode, 1);
  assert.match(mismatched.output, /^Outcome: RPC_FAILED/);
  assert.equal(mismatched.output.includes(foreign), false);
  assert.match(mismatched.output, new RegExp(`Import: ${importRunId}`));
});

test("a different file never reaches the importer", async () => {
  let calls = 0;
  const importer: ChaosOnceImporter = async () => {
    calls += 1;
    throw new Error("importer should not run");
  };
  const rejected = await runChaosSampleOnce(`${sampleText}\n`, importer);
  assert.equal(calls, 0);
  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.output, "Outcome: PAYLOAD_REJECTED");
  assert.equal(rejected.output.includes(SAMPLE_CHAOS_SEED), false);
});

test("an importer failure is printed once and is not retried", async () => {
  let calls = 0;
  const failed = await runChaosSampleOnce(sampleText, async () => {
    calls += 1;
    throw new Error(`eyJabc.def.ghi ${SAMPLE_CHAOS_SEED}`);
  });
  assert.equal(calls, 1);
  assert.equal(failed.exitCode, 1);
  assert.match(failed.output, /^Outcome: rejected/);
  assert.equal(failed.output.includes("eyJabc"), false);
  assert.equal(failed.output.includes(SAMPLE_CHAOS_SEED), false);
  assertNoSecrets(failed.output);
});

test("the one-shot command stays on the sample file and the server latch", () => {
  const runner = readFileSync(new URL("./chaos-import-once.ts", import.meta.url), "utf8");
  assert.match(runner, /prepareSampleChaosImport\(/);
  assert.match(runner, /SAMPLE_CHAOS_RUN_ID/);
  assert.match(runner, /SAMPLE_CHAOS_DIGEST_HEX/);
  assert.match(runner, /destinationScenarioId: SAMPLE_CHAOS_DESTINATION/);
  assert.match(runner, /mode: "apply"/);
  assert.equal(runner.includes("supabase"), false);
  assert.equal(runner.includes("fetch("), false);
  assert.equal(runner.includes("process.env"), false);
  assert.equal(runner.includes("scn_demo_flood"), false);
  assert.equal(runner.includes("retry"), false);

  const script = readFileSync(new URL("../../scripts/import-chaos-sample-once.mts", import.meta.url), "utf8");
  assert.equal(script.match(/return await importChaosOnServer\(/g)?.length, 1);
  assert.equal(script.includes(".rpc("), false);
  assert.equal(script.includes("retry"), false);
  assert.equal(script.includes("scn_demo_flood"), false);
  assert.match(script, /resq-handoff\/sample-simulation\.json/);
  const jsonMentions = script.match(/\.json/g) ?? [];
  const sampleMentions = script.match(/sample-simulation\.json/g) ?? [];
  assert.ok(sampleMentions.length >= 1);
  assert.equal(jsonMentions.length, sampleMentions.length);
  const executable = script.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual(executable.match(/[A-Za-z0-9_./-]+\.json/g), [
    "../../resq-handoff/sample-simulation.json",
  ]);
  assert.match(script, /return await importChaosOnServer\(text, options\)/);
  assert.equal(script.includes("RESQ_CHAOS_IMPORT_APPROVED"), false);
  assert.equal(script.includes("console.log(process.env"), false);
  assert.equal(script.includes("NVIDIA_"), false);

  const loader = readFileSync(new URL("../../scripts/register-chaos-import-once.mjs", import.meta.url), "utf8");
  assert.match(loader, /server-only\/empty\.js/);
});

test("without the approval token the one-shot import makes no live call", async () => {
  const refusedOutput = [
    "Outcome: APPLY_REFUSED",
    `Import: ${importRunId}`,
    "Emergency: 2",
    "Operational: 7",
    "Units: 1",
    "Assignments: 1",
  ].join("\n");
  const withheld = [undefined, "", "withheld", "sample-two-report-later"] as const;
  for (const approval of withheld) {
    assert.equal(chaosServerCallAllowed("apply", approval), false);
    let executions = 0;
    const importer: ChaosOnceImporter = async (text, options) => {
      if (!chaosServerCallAllowed(options.mode, approval)) {
        return runControlledChaosImport({
          text,
          destinationScenarioId: options.destinationScenarioId,
          mode: options.mode,
        });
      }
      executions += 1;
      throw new Error("withheld approval must not reach an executor");
    };
    const result = await runChaosSampleOnce(sampleText, importer);
    assert.equal(executions, 0);
    assert.equal(result.exitCode, 1);
    assert.equal(result.output, refusedOutput);
    assert.equal(result.output.includes(SAMPLE_CHAOS_SEED), false);
    assert.equal(result.output.includes("127.0.0.1"), false);
    if (approval) assert.equal(result.output.includes(approval), false);
    assertNoSecrets(result.output);
  }

  const blocked = await runControlledChaosImport({
    text: sampleText,
    destinationScenarioId: SAMPLE_CHAOS_DESTINATION,
    mode: "apply",
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.code, "APPLY_REFUSED");
    assert.equal(blocked.invoked, false);
    assert.equal(blocked.databaseWrites, false);
    assert.equal(blocked.externalCalls, false);
    assert.equal(blocked.message.includes(SAMPLE_CHAOS_SEED), false);
  }
  assert.equal(chaosServerCallAllowed("apply", SAMPLE_IMPORT_APPROVAL), true);
  assert.equal(chaosServerCallAllowed("dry-run", SAMPLE_IMPORT_APPROVAL), false);

  const script = readFileSync(new URL("../../scripts/import-chaos-sample-once.mts", import.meta.url), "utf8");
  const mainBody = script.slice(script.indexOf("async function main"));
  const guard = mainBody.indexOf("process.argv.slice(2).length > 0");
  const rejected = mainBody.indexOf('console.log("Outcome: rejected")');
  const exitCode = mainBody.indexOf("process.exitCode = 2");
  const readSample = mainBody.indexOf("readFileSync(samplePath()");
  const run = mainBody.indexOf("runChaosSampleOnce(");
  assert.ok(guard >= 0 && rejected > guard && exitCode > rejected && readSample > exitCode && run > readSample);

  const serverSource = readFileSync(new URL("./chaos-import-server.ts", import.meta.url), "utf8");
  const gate = serverSource.indexOf("if (!chaosServerCallAllowed(");
  const clientCall = serverSource.indexOf("createSupabaseServerClient()");
  assert.ok(gate >= 0 && clientCall > gate);
  assert.match(serverSource, /process\.env\.RESQ_CHAOS_IMPORT_APPROVED/);
  assert.equal(serverSource.includes(".from("), false);
});
