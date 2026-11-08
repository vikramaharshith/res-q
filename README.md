# RES-Q by B7

### AI-Powered Disaster Response Command Center

**When every second counts, clarity saves lives.**

RES-Q by B7 is an AI-assisted emergency operations platform built for **fictional disaster simulations**. It combines an interactive command center, NVIDIA Nemotron investigations, human-controlled decisions, and an independent disaster simulation engine.

Built for **HackUTD 2026: ZeroDay**.

> **Important:** RES-Q is a simulation and research prototype. It is not connected to real emergency services and does not perform real-world dispatch.

---

## Overview

During large disasters, emergency teams can receive thousands of reports in a short period. These reports may be incomplete, duplicated, delayed, or contradictory.

RES-Q explores how AI can help emergency operators organize incoming information, investigate incidents, and make informed decisions while keeping humans in control.

The project consists of two independent systems:

**RES-Q Command Center:** A Next.js dashboard that displays emergency reports, incidents, maps, responder availability, and NVIDIA Nemotron investigations.

**B7 Chaos Engine:** A deterministic, event-driven disaster simulator that generates thousands of fictional emergency observations, responder activity, communication failures, resource constraints, and cascading incidents.

The systems communicate through a validated, versioned public JSON contract.

## Key Features

### RES-Q Command Center

- Interactive incident map built with Leaflet and OpenStreetMap.
- Searchable emergency incident queue.
- Incident case files with relevant reports and context.
- NVIDIA Nemotron AI investigations using tool calling.
- Incident prioritization and responder recommendations.
- Explicit human approval, rejection, and override controls.
- Server-side validation, idempotency, and decision audit history.
- Supabase integration for incidents, reports, responders, and assignments.
- Responsive desktop and mobile dashboard.
- Separate Chaos Simulation dashboard with fictional local-grid visualization.

### B7 Chaos Engine

- Independent deterministic simulation architecture.
- Seeded, reproducible disaster scenarios.
- Virtual clock and event-driven scheduling.
- Duplicate, delayed, incomplete, and conflicting reports.
- Cascading disaster events and evolving incidents.
- Eight responder types.
- Simulated responder tasks, availability, travel, and communications.
- Fatigue, equipment condition, inventory, recovery, and replenishment.
- Resource shortages and infrastructure disruptions.
- Strict separation between hidden simulation ground truth and public observations.
- Versioned public JSON exports with validation and deterministic replay.
- Standalone command-line interface and automated tests.

## Performance

### Chaos Engine — EXTREME Benchmark

| Metric | Result |
|---|---:|
| Initial emergency reports | 10,000 |
| Final emergency observations | 11,264 |
| Simulated responders | 200 |
| Processed simulation events | 15,511 |
| Simulation runtime | 12.67 seconds |
| Automated tests | 220 passed |
| Test suites | 49 passed |

An earlier 10,000-report workload took approximately 120 seconds. Optimization reduced the measured runtime to 12.67 seconds, approximately a **9.5× speedup**.

A separate audit run measured 9.49 seconds. Performance varies with hardware and runtime conditions.

These benchmarks describe the standalone Chaos Engine, not Supabase import or AI investigation latency.

## System Architecture

```text
                 B7 CHAOS ENGINE
             Independent Simulator
                       |
                       v
             Public JSON Export
              resq.simulation.v1
                       |
                       v
              RES-Q Import Adapter
           Schema + Security Validation
                       |
                       v
                  SUPABASE
            Isolated Staging Tables
                       |
                       v
              RES-Q COMMAND CENTER
             Reports + Maps + Cases
                       |
                       v
                NVIDIA NEMOTRON
            AI-Assisted Investigation
                       |
                       v
                 HUMAN OPERATOR
             Approve / Reject / Override
                       |
                       v
               Audited Simulated Action
```

**Integration status:** The Chaos Engine's public JSON has been validated and a two-report sample was successfully imported into Supabase and displayed in the Chaos Simulation dashboard. The complete large-scale Chaos-to-Nemotron-to-approval workflow has not yet been verified. Human approval functionality is demonstrated in the separate Urban Flood scenario.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS |
| Mapping | Leaflet, OpenStreetMap |
| Database | Supabase / PostgreSQL |
| AI | NVIDIA Nemotron |
| Simulation | TypeScript, Node.js |
| Testing | Automated Node.js/TypeScript tests |
| Development | Cursor, Codex, Grok, ChatGPT |

## Repository Structure

```text
res-q/
├── web/                    # RES-Q command center
│   ├── app/                # Next.js application and APIs
│   ├── components/         # Dashboard and map components
│   ├── lib/                # AI, approval, import, and data logic
│   └── scripts/            # Database migrations and import tools
├── chaos-engine/           # Independent B7 Chaos Engine
│   ├── src/                # Simulation, reporting, CLI, and export
│   ├── test/               # Automated tests
│   ├── scripts/            # Benchmarks and schema tools
│   └── README.md
├── resq-handoff/           # Public JSON schema and sample
└── docs/                   # Architecture and integration documents
```

## Getting Started

### Prerequisites

- Node.js and npm
- A Supabase project for persistent database features
- An NVIDIA API key for Nemotron investigations

### Run the RES-Q Command Center

```bash
git clone https://github.com/vikramaharshith/res-q.git
cd res-q/web
npm install
npm run dev
```

Open:

- **Urban Flood Command Center:** http://localhost:3000
- **Chaos Simulation:** http://localhost:3000/?scenario=chaos

Some live features require configured Supabase credentials, database migrations, and imported scenario data. Without those services, available functionality depends on the local demo fallback.

Environment files containing credentials are intentionally excluded from the repository.

### Run the Chaos Engine

```bash
cd chaos-engine
npm install
npm run check
```

To view available simulation commands:

```bash
npm run chaos -- --help
```

The Chaos Engine runs independently of Supabase, Nemotron, and the RES-Q dashboard.

## Testing

### RES-Q

From the `web` directory:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

**Last verified:** 72/72 automated tests passed, TypeScript clean, ESLint clean, and Next.js production build successful.

### Chaos Engine

From the `chaos-engine` directory:

```bash
npm run check
```

**Last verified:** 220/220 tests passed across 49 suites, with successful typecheck and build verification.

## AI Safety and Human Approval

RES-Q is designed around the principle that AI recommendations should remain advisory.

NVIDIA Nemotron can investigate incident reports, identify contradictory information, evaluate uncertainty, and recommend possible responses.

However, the AI cannot independently authorize a simulated responder assignment.

The human decision workflow includes explicit confirmation, eligibility checks, capability matching, idempotency protection, transactional safeguards, and an audit trail.

The Chaos Engine also separates hidden simulation truth from AI-visible public observations, allowing future evaluations of model reasoning without giving the model access to the actual internal disaster state.

## Current Limitations

- The project operates exclusively on fictional emergency data.
- The current Chaos Simulation dashboard has been verified with a two-report imported sample.
- The 10,000-report EXTREME benchmark is a standalone Chaos Engine result, not a completed RES-Q database import.
- The Chaos-specific live Nemotron investigation workflow has not been fully verified.
- The current application uses local-only protections for sensitive approval functions and is not configured as an unrestricted public deployment.

## Future Development

**B7 Chaos Lab** is a planned interactive disaster simulation environment featuring customizable disaster scenarios, intensity, populations, responder resources, infrastructure failures, simulation speed, replay, and repeatable scenario comparisons.

Additional work will focus on larger imported simulations, automated JSON handoff, scalable observation visualization, and broader AI investigation evaluation.

## HackUTD 2026

Developed as a solo hackathon project for **HackUTD 2026: ZeroDay**.

**RES-Q by B7**

*During an emergency, information shouldn't be the bottleneck.*
