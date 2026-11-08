import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SimulationConfigError,
  SimulationEngine,
  SimulationEventError,
  SimulationLimitError,
  type InitialIncidentDefinition,
  type InitialResponderDefinition,
  type SimulationConfig,
  type TaskDefinition,
} from "../src/index.js";

const START = 80_000;
const INCIDENT: InitialIncidentDefinition = {
  incidentType: "FICTIONAL_EMERGENCY",
  location: { latitude: 10, longitude: 10, label: "Simulated District" },
  severity: 4,
};

function responder(
  responderType: InitialResponderDefinition["responderType"],
  overrides: Partial<InitialResponderDefinition> = {},
): InitialResponderDefinition {
  return {
    responderType,
    location: {
      fictional: true,
      coordinateSystem: "SIMULATED_LOCAL_GRID",
      x: 1,
      y: 2,
      label: "Fictional Task Response Base",
    },
    crewCapacity: 4,
    equipmentInventory: { radio: 4, kit: 2 },
    ...overrides,
  };
}

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    scenarioId: "phase-6b-tasks",
    seed: "task-seed",
    startTimeMs: START,
    maxDurationMs: 100_000,
    initialIncidents: [INCIDENT],
    ...overrides,
  };
}

function task(
  relatedIncidentId: string,
  overrides: Partial<TaskDefinition> = {},
): TaskDefinition {
  return {
    relatedIncidentId,
    requiredCapabilities: ["LOGISTICS"],
    requiredEquipment: { kit: 1 },
    requiredCrewCapacity: 2,
    priority: "HIGH",
    estimatedEffortMs: 30_000,
    ...overrides,
  };
}

function drain(engine: SimulationEngine): void {
  engine.start();
  engine.runUntilEmpty();
}

describe("Phase 6B task creation and lifecycle", () => {
  it("creates deterministic unique tasks and permits multiple tasks per incident", () => {
    const run = () => {
      const engine = new SimulationEngine(config());
      const incidentId = engine.getState().incidents[0]!.id;
      const first = engine.createTask(task(incidentId));
      const second = engine.createTask(task(incidentId, { priority: "CRITICAL" }));
      drain(engine);
      return { first, second, state: engine.getState() };
    };

    const firstRun = run();
    const secondRun = run();
    assert.equal(firstRun.state.tasks.length, 2);
    assert.equal(new Set(firstRun.state.tasks.map((item) => item.id)).size, 2);
    assert.ok(firstRun.state.tasks.every((item) => item.id.startsWith("task_auto_")));
    assert.ok(
      firstRun.state.tasks.every((item) => item.relatedIncidentId === firstRun.state.incidents[0]!.id),
    );
    assert.deepEqual(firstRun.state.tasks, secondRun.state.tasks);
    assert.equal(firstRun.first.relatedTaskId, secondRun.first.relatedTaskId);
    assert.equal(firstRun.second.relatedTaskId, secondRun.second.relatedTaskId);
    assert.deepEqual(
      firstRun.state.tasks.map((item) => [item.createdAtMs, item.lastUpdatedAtMs]),
      [[START, START], [START, START]],
    );
  });

  it("rejects nonexistent incidents, duplicate IDs, and maximum-task overflow", () => {
    const engine = new SimulationEngine(config({ maxTaskCount: 1 }));
    const incidentId = engine.getState().incidents[0]!.id;
    const definition = task(incidentId, { id: "task_custom_one" });
    engine.createTask(definition);
    const pending = engine.getState().pendingEventCount;
    assert.throws(() => engine.createTask(definition), SimulationLimitError);
    assert.equal(engine.getState().pendingEventCount, pending);

    const missingIncidentEngine = new SimulationEngine(config());
    assert.throws(
      () => missingIncidentEngine.createTask(task("inc_missing")),
      /does not exist/,
    );

    const duplicateEngine = new SimulationEngine(config({ maxTaskCount: 2 }));
    const existingIncidentId = duplicateEngine.getState().incidents[0]!.id;
    const duplicate = task(existingIncidentId, { id: "task_custom_duplicate" });
    duplicateEngine.createTask(duplicate);
    assert.throws(() => duplicateEngine.createTask(duplicate), /Duplicate task ID/);
  });

  it("applies the valid lifecycle without resolving the related incident", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [responder("SUPPLY_DELIVERY")] }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    const taskId = engine.getTasks()[0]!.id;
    const responderId = engine.getResponders()[0]!.id;
    engine.assignTask(taskId, responderId);
    drain(engine);
    engine.scheduleTaskStateTransition(taskId, "EN_ROUTE", START + 10);
    engine.scheduleTaskStateTransition(taskId, "IN_PROGRESS", START + 10);
    engine.scheduleTaskStateTransition(taskId, "COMPLETED", START + 10);
    drain(engine);

    assert.equal(engine.getTask(taskId)?.status, "COMPLETED");
    assert.equal(engine.getIncident(incidentId)?.status, "DETECTED");
    assert.deepEqual(
      engine.getTask(taskId)?.causalEventHistory.map((entry) => entry.status),
      ["PENDING", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"],
    );
  });

  it("fails on invalid queued task transitions without partially mutating the task", () => {
    const engine = new SimulationEngine(config());
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    const before = engine.getTasks()[0]!;
    engine.scheduleTaskStateTransition(before.id, "COMPLETED", START + 1);
    engine.start();
    assert.throws(() => engine.runUntilEmpty(), SimulationEventError);
    assert.equal(engine.status, "FAILED");
    assert.deepEqual(engine.getTask(before.id), before);
  });

  it("rejects negative task requirements without mutating state", () => {
    const engine = new SimulationEngine(config());
    const incidentId = engine.getState().incidents[0]!.id;
    const before = engine.getState();
    assert.throws(
      () => engine.createTask(task(incidentId, { requiredEquipment: { kit: -1 } })),
      SimulationConfigError,
    );
    assert.deepEqual(engine.getState(), before);
  });
});

describe("Phase 6B capability matching", () => {
  it("maps representative task capabilities to the correct responder foundations", () => {
    const engine = new SimulationEngine(
      config({
        initialResponders: [
          responder("WATER_RESCUE"),
          responder("SEARCH_AND_RESCUE"),
          responder("AMBULANCE"),
          responder("UTILITY_REPAIR"),
          responder("SUPPLY_DELIVERY"),
        ],
      }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    const requirements = [
      "WATER_RESCUE",
      "SEARCH_AND_RESCUE",
      "EMERGENCY_MEDICAL_CARE",
      "ELECTRICAL_REPAIR",
      "LOGISTICS",
    ];
    for (const capability of requirements) {
      engine.createTask(
        task(incidentId, {
          requiredCapabilities: [capability],
          requiredEquipment: {},
          requiredCrewCapacity: 1,
        }),
      );
    }
    drain(engine);

    assert.deepEqual(
      engine.getTasks().map((item) => engine.getEligibleRespondersForTask(item.id)[0]?.responderType),
      ["WATER_RESCUE", "SEARCH_AND_RESCUE", "AMBULANCE", "UTILITY_REPAIR", "SUPPLY_DELIVERY"],
    );
  });

  it("enforces responder type, capability, equipment, and crew requirements", () => {
    const engine = new SimulationEngine(
      config({
        initialResponders: [
          responder("POLICE", {
            capabilities: ["SPECIAL"],
            crewCapacity: 2,
            equipmentInventory: { tool: 1 },
          }),
          responder("POLICE", {
            capabilities: ["SPECIAL"],
            crewCapacity: 5,
            equipmentInventory: { tool: 3 },
          }),
          responder("AMBULANCE", {
            capabilities: ["SPECIAL"],
            crewCapacity: 5,
            equipmentInventory: { tool: 3 },
          }),
        ],
      }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(
      task(incidentId, {
        requiredCapabilities: ["SPECIAL"],
        requiredEquipment: { tool: 2 },
        requiredCrewCapacity: 4,
        eligibleResponderTypes: ["POLICE"],
      }),
    );
    drain(engine);
    const matches = engine.getEligibleRespondersForTask(engine.getTasks()[0]!.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.responderType, "POLICE");
    assert.equal(matches[0]?.crewCapacity, 5);
  });

  it("returns no match for capability, equipment, crew, or availability shortages", () => {
    const engine = new SimulationEngine(
      config({
        initialResponders: [
          responder("SUPPLY_DELIVERY", {
            capabilities: ["LOGISTICS"],
            crewCapacity: 1,
            equipmentInventory: { kit: 0 },
            initialState: "OFFLINE",
          }),
        ],
      }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(
      task(incidentId, {
        requiredCapabilities: ["LOGISTICS", "COLD_CHAIN"],
        requiredEquipment: { kit: 2 },
        requiredCrewCapacity: 3,
      }),
    );
    drain(engine);
    assert.deepEqual(engine.getEligibleRespondersForTask(engine.getTasks()[0]!.id), []);
  });

  it("uses stable best-fit selection when multiple responders qualify", () => {
    const select = () => {
      const engine = new SimulationEngine(
        config({
          initialResponders: [
            responder("AMBULANCE", {
              capabilities: ["MEDICAL"],
              crewCapacity: 6,
              equipmentInventory: { kit: 5 },
            }),
            responder("AMBULANCE", {
              capabilities: ["MEDICAL"],
              crewCapacity: 4,
              equipmentInventory: { kit: 4 },
            }),
            responder("AMBULANCE", {
              capabilities: ["MEDICAL"],
              crewCapacity: 4,
              equipmentInventory: { kit: 2 },
            }),
          ],
          automaticTaskAssignment: true,
        }),
      );
      const incidentId = engine.getState().incidents[0]!.id;
      engine.createTask(
        task(incidentId, {
          requiredCapabilities: ["MEDICAL"],
          requiredEquipment: { kit: 2 },
          requiredCrewCapacity: 3,
        }),
      );
      drain(engine);
      const assignedId = engine.getTasks()[0]!.assignedResponderId!;
      return engine.getResponder(assignedId)!.callsign;
    };

    assert.equal(select(), "MED-003");
    assert.equal(select(), select());
  });

  it("makes identical policy choices when only hidden incident severity differs", () => {
    const select = (severity: number) => {
      const engine = new SimulationEngine(
        config({
          initialIncidents: [{ ...INCIDENT, severity }],
          initialResponders: [
            responder("SUPPLY_DELIVERY", { crewCapacity: 5 }),
            responder("SUPPLY_DELIVERY", { crewCapacity: 3 }),
          ],
          automaticTaskAssignment: true,
        }),
      );
      const incidentId = engine.getState().incidents[0]!.id;
      engine.createTask(task(incidentId));
      drain(engine);
      return engine.getResponder(engine.getTasks()[0]!.assignedResponderId!)!.callsign;
    };

    assert.equal(select(1), select(10));
  });
});

describe("Phase 6B assignments and event integration", () => {
  it("keeps automatic assignment disabled by default", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [responder("SUPPLY_DELIVERY")] }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    assert.equal(engine.config.automaticTaskAssignment, false);
    assert.equal(engine.getTasks()[0]?.status, "PENDING");
    assert.ok(!engine.getState().eventHistory.some((record) => record.event.type === "TASK_ASSIGN"));
  });

  it("automatically assigns only qualified available responders with baseline origin", () => {
    const engine = new SimulationEngine(
      config({
        automaticTaskAssignment: true,
        initialResponders: [
          responder("POLICE"),
          responder("SUPPLY_DELIVERY"),
        ],
      }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    const creation = engine.createTask(task(incidentId));
    drain(engine);
    const assigned = engine.getTasks()[0]!;
    assert.equal(assigned.status, "ASSIGNED");
    assert.equal(assigned.assignmentOrigin, "SIMULATION_BASELINE");
    assert.equal(engine.getResponder(assigned.assignedResponderId!)?.responderType, "SUPPLY_DELIVERY");
    assert.equal(engine.getResponder(assigned.assignedResponderId!)?.availabilityState, "RESERVED");
    const assignmentRecord = engine
      .getState()
      .eventHistory.find((record) => record.event.type === "TASK_ASSIGN");
    assert.equal(assignmentRecord?.event.causeEventId, creation.id);
    assert.deepEqual(assignmentRecord?.change, {
      kind: "TASK_ASSIGNED",
      taskId: assigned.id,
      responderId: assigned.assignedResponderId,
      previousStatus: "PENDING",
      status: "ASSIGNED",
      origin: "SIMULATION_BASELINE",
      automatic: true,
    });
  });

  it("orders same-time automatic decisions by observable task priority", () => {
    const engine = new SimulationEngine(
      config({
        automaticTaskAssignment: true,
        initialResponders: [responder("SUPPLY_DELIVERY")],
      }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId, { priority: "LOW" }));
    engine.createTask(task(incidentId, { priority: "CRITICAL" }));
    drain(engine);
    const [low, critical] = engine.getTasks();
    assert.equal(low?.status, "PENDING");
    assert.equal(critical?.status, "ASSIGNED");
  });

  it("leaves tasks pending and records the decision when no responder is eligible", () => {
    const engine = new SimulationEngine(
      config({
        automaticTaskAssignment: true,
        initialResponders: [responder("POLICE")],
      }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    const pending = engine.getTasks()[0]!;
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.assignedResponderId, undefined);
    assert.equal(pending.causalEventHistory.at(-1)?.action, "ASSIGNMENT_SKIPPED");
    assert.deepEqual(engine.getState().eventHistory.at(-1)?.change, {
      kind: "TASK_ASSIGNMENT_SKIPPED",
      taskId: pending.id,
      status: "PENDING",
      origin: "SIMULATION_BASELINE",
      reason: "NO_ELIGIBLE_RESPONDER",
    });
  });

  it("supports explicit manual simulation assignment with causal history", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [responder("SUPPLY_DELIVERY")] }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    const creation = engine.createTask(task(incidentId));
    drain(engine);
    const taskId = engine.getTasks()[0]!.id;
    const responderId = engine.getResponders()[0]!.id;
    const assignment = engine.assignTask(taskId, responderId, START, 0, creation.id);
    drain(engine);
    const assigned = engine.getTask(taskId)!;
    assert.equal(assigned.assignmentOrigin, "SIMULATION_BASELINE");
    assert.equal(assigned.causalEventHistory.at(-1)?.eventId, assignment.id);
    assert.equal(assigned.causalEventHistory.at(-1)?.causeEventId, creation.id);
  });

  it("rejects unavailable or unqualified responders before consuming an event", () => {
    const engine = new SimulationEngine(
      config({
        initialResponders: [
          responder("SUPPLY_DELIVERY", { initialState: "OFFLINE" }),
          responder("POLICE"),
        ],
      }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    const taskId = engine.getTasks()[0]!.id;
    const before = engine.getState();
    assert.throws(
      () => engine.assignTask(taskId, engine.getResponders()[0]!.id),
      /not eligible/,
    );
    assert.throws(
      () => engine.assignTask(taskId, engine.getResponders()[1]!.id),
      /not eligible/,
    );
    assert.deepEqual(engine.getState(), before);
  });

  it("prevents duplicate active assignments even if telemetry is manually reset", () => {
    const engine = new SimulationEngine(
      config({ initialResponders: [responder("SUPPLY_DELIVERY")] }),
    );
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId));
    engine.createTask(task(incidentId));
    drain(engine);
    const [firstTask, secondTask] = engine.getTasks();
    const responderId = engine.getResponders()[0]!.id;
    engine.assignTask(firstTask!.id, responderId);
    drain(engine);
    engine.scheduleResponderStateTransition(responderId, "AVAILABLE", START);
    drain(engine);
    assert.throws(
      () => engine.assignTask(secondTask!.id, responderId),
      /not eligible/,
    );
    assert.equal(engine.getTask(secondTask!.id)?.status, "PENDING");
  });

  it("does not consume deterministic IDs after rejected scheduling", () => {
    const setup = () => {
      const engine = new SimulationEngine(
        config({ initialResponders: [responder("POLICE")] }),
      );
      const incidentId = engine.getState().incidents[0]!.id;
      engine.createTask(task(incidentId));
      drain(engine);
      return { engine, incidentId };
    };
    const subject = setup();
    const control = setup();
    assert.throws(
      () => subject.engine.assignTask(subject.engine.getTasks()[0]!.id, subject.engine.getResponders()[0]!.id),
      /not eligible/,
    );
    const subjectEvent = subject.engine.createTask(task(subject.incidentId));
    const controlEvent = control.engine.createTask(task(control.incidentId));
    assert.equal(subjectEvent.id, controlEvent.id);
    assert.equal(subjectEvent.relatedTaskId, controlEvent.relatedTaskId);
  });
});

describe("Phase 6B immutability, reset, and replay", () => {
  it("returns deeply immutable task and history snapshots", () => {
    const engine = new SimulationEngine(config());
    const incidentId = engine.getState().incidents[0]!.id;
    engine.createTask(task(incidentId));
    drain(engine);
    const snapshot = engine.getTasks()[0]!;
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.requiredCapabilities));
    assert.ok(Object.isFrozen(snapshot.requiredEquipment));
    assert.ok(Object.isFrozen(snapshot.causalEventHistory));
    assert.ok(Object.isFrozen(snapshot.causalEventHistory[0]));
    assert.ok(Object.isFrozen(engine.getState().tasks));
    assert.throws(() => {
      (snapshot.requiredCapabilities as string[]).push("MUTATED");
    }, TypeError);
  });

  it("resets task state and replays assignments byte-for-byte", () => {
    const engine = new SimulationEngine(
      config({
        automaticTaskAssignment: true,
        initialResponders: [responder("SUPPLY_DELIVERY")],
      }),
    );
    const initial = engine.getState();
    const replay = () => {
      const incidentId = engine.getState().incidents[0]!.id;
      engine.createTask(task(incidentId));
      engine.start();
      return JSON.stringify(engine.runUntilEmpty());
    };

    const first = replay();
    engine.reset();
    assert.deepEqual(engine.getState(), initial);
    const second = replay();
    assert.equal(second, first);
  });
});
