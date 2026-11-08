import type { ImportLedger, SimulationImport } from "@/lib/simulation-import/types";

/**
 * In-memory import ledger for Phase 0. Tests use it to prove duplicate
 * rejection and atomic commit. Database writes are intentionally absent.
 */
export class MemoryImportLedger implements ImportLedger {
  private records: SimulationImport[] = [];

  list(): readonly SimulationImport[] {
    return [...this.records];
  }

  findByKey(idempotencyKey: string): SimulationImport | undefined {
    return this.records.find((record) => record.source.idempotencyKey === idempotencyKey);
  }

  findByRun(schemaVersion: string, runId: string): SimulationImport | undefined {
    return this.records.find((record) => record.document.schemaVersion === schemaVersion && record.document.runId === runId);
  }

  commit(record: SimulationImport): void {
    const next = [...this.records, record];
    this.records = next;
  }
}
