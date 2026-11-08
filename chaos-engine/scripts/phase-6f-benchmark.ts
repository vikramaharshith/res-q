import {
  INTEGRATION_DIFFICULTIES,
  runResponderIntegrationWorkload,
  type ResponderIntegrationMetrics,
} from "../src/index.js";

const metrics: ResponderIntegrationMetrics[] = [];
for (const difficulty of INTEGRATION_DIFFICULTIES) {
  const result = runResponderIntegrationWorkload(difficulty);
  if (result.invariantViolations.length > 0 || result.publicAuditViolations.length > 0) {
    throw new Error(`${difficulty} safety audit failed: ${[...result.invariantViolations, ...result.publicAuditViolations].join(", ")}`);
  }
  metrics.push(result.metrics);
  console.log(JSON.stringify(result.metrics));
}
console.log(JSON.stringify({ benchmark: "PHASE_6F_COMPLETE", workloads: metrics.length }));
