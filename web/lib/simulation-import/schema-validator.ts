import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import "server-only";

import {
  ENGINE_VERSION,
  FORBIDDEN_SIMULATION_KEYS,
  MAX_ISSUES,
  MAX_NESTING_DEPTH,
  SCHEMA_ID,
  SCHEMA_VERSION,
  type ImportIssue,
} from "@/lib/simulation-import/types";

interface SchemaNode {
  readonly $ref?: string;
  readonly $id?: string;
  readonly anyOf?: readonly SchemaNode[];
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly type?: string | readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxItems?: number;
  readonly items?: SchemaNode;
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | SchemaNode;
  readonly propertyNames?: SchemaNode;
}

const FORBIDDEN = new Set<string>(FORBIDDEN_SIMULATION_KEYS);

let cachedSchema: SchemaNode | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SCHEMA_FILE = "public-schema.json";

/** Reads the shipped public schema from the repo. The path is not a client import. */
function publicSchemaPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "..", "resq-handoff", SCHEMA_FILE),
    path.resolve(process.cwd(), "resq-handoff", SCHEMA_FILE),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Public schema file could not be read.");
  return found;
}

function loadSchema(): SchemaNode {
  if (cachedSchema !== undefined) return cachedSchema;
  const schema = JSON.parse(readFileSync(publicSchemaPath(), "utf8")) as SchemaNode;
  const properties = schema.properties;
  if (schema.$id !== SCHEMA_ID) throw new Error("Public schema identity does not match the adapter allowlist.");
  if (properties?.schemaVersion?.const !== SCHEMA_VERSION || properties.engineVersion?.const !== ENGINE_VERSION) {
    throw new Error("Public schema version does not match the adapter allowlist.");
  }
  cachedSchema = schema;
  return schema;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return false;
}

function resolveRef(root: SchemaNode, ref: string): SchemaNode {
  if (!ref.startsWith("#/")) throw new Error("Unsupported public schema reference.");
  let cursor: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    if (!isRecord(cursor)) throw new Error("Broken public schema reference.");
    cursor = cursor[part];
  }
  if (!isRecord(cursor)) throw new Error("Broken public schema reference.");
  return cursor as SchemaNode;
}

function safeSegment(key: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,80}$/.test(key) ? key : undefined;
}

export function exceedsNestingDepth(value: unknown, maxDepth = MAX_NESTING_DEPTH): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.depth > maxDepth) return true;
    const children = Array.isArray(current.value)
      ? current.value
      : isRecord(current.value)
        ? Object.values(current.value)
        : [];
    for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }
  return false;
}

export function collectSchemaIssues(value: unknown): ImportIssue[] {
  const issues: ImportIssue[] = [];
  evaluate(value, loadSchema(), "$", 0, issues);
  return issues.slice(0, MAX_ISSUES);
}

function evaluate(instance: unknown, node: SchemaNode, path: string, depth: number, issues: ImportIssue[]): void {
  if (issues.length >= MAX_ISSUES) return;
  if (depth > 32) {
    issues.push(Object.freeze({ path, message: "Schema reference is too deep." }));
    return;
  }
  if (typeof node.$ref === "string") {
    evaluate(instance, resolveRef(loadSchema(), node.$ref), path, depth + 1, issues);
    return;
  }
  if (Array.isArray(node.anyOf)) {
    let closest: ImportIssue[] | undefined;
    for (const option of node.anyOf) {
      const local: ImportIssue[] = [];
      evaluate(instance, option, path, depth + 1, local);
      if (local.length === 0) return;
      if (closest === undefined || local.length < closest.length) closest = local;
    }
    for (const issue of closest ?? []) {
      if (issues.length >= MAX_ISSUES) return;
      issues.push(issue);
    }
    if ((closest ?? []).length === 0) issues.push(Object.freeze({ path, message: "Value is not allowed." }));
    return;
  }
  if (Object.prototype.hasOwnProperty.call(node, "const") && instance !== node.const) {
    issues.push(Object.freeze({ path, message: "Value is not allowed." }));
  }
  if (Array.isArray(node.enum) && !node.enum.some((item) => item === instance)) {
    issues.push(Object.freeze({ path, message: "Value is not allowed." }));
  }
  if (typeof instance === "number" && !Number.isFinite(instance)) {
    issues.push(Object.freeze({ path, message: "Non-finite numbers are rejected." }));
    return;
  }
  const types = node.type === undefined ? undefined : Array.isArray(node.type) ? node.type : [node.type];
  if (types !== undefined && !types.some((type) => matchesType(instance, type))) {
    issues.push(Object.freeze({ path, message: "Value has the wrong type." }));
    return;
  }
  if (typeof instance === "string") {
    const length = [...instance].length;
    if (typeof node.minLength === "number" && length < node.minLength) issues.push(Object.freeze({ path, message: "Text is shorter than the contract allows." }));
    if (typeof node.maxLength === "number" && length > node.maxLength) issues.push(Object.freeze({ path, message: "Text is longer than the contract allows." }));
    if (typeof node.pattern === "string" && !new RegExp(node.pattern).test(instance)) issues.push(Object.freeze({ path, message: "Value does not match the required pattern." }));
    if (node.format === "date-time") {
      const parsed = Date.parse(instance);
      if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== instance) issues.push(Object.freeze({ path, message: "Timestamp must be canonical UTC." }));
    }
  }
  if (typeof instance === "number") {
    if (typeof node.minimum === "number" && instance < node.minimum) issues.push(Object.freeze({ path, message: "Number is below the contract minimum." }));
    if (typeof node.maximum === "number" && instance > node.maximum) issues.push(Object.freeze({ path, message: "Number is above the contract maximum." }));
  }
  if (Array.isArray(instance)) {
    if (typeof node.maxItems === "number" && instance.length > node.maxItems) issues.push(Object.freeze({ path, message: "Array exceeds the contract limit." }));
    if (node.items !== undefined) {
      for (let index = 0; index < instance.length && issues.length < MAX_ISSUES; index += 1) {
        evaluate(instance[index], node.items, `${path}[${index}]`, depth + 1, issues);
      }
    }
  }
  if (!isRecord(instance)) return;
  for (const key of node.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(instance, key)) issues.push(Object.freeze({ path: `${path}.${key}`, message: "Required property is missing." }));
  }
  const properties = node.properties ?? {};
  for (const [key, child] of Object.entries(instance)) {
    if (issues.length >= MAX_ISSUES) return;
    if (FORBIDDEN.has(key)) {
      const segment = safeSegment(key);
      issues.push(Object.freeze({ path: segment === undefined ? path : `${path}.${segment}`, message: "Forbidden private field." }));
      continue;
    }
    if (node.propertyNames !== undefined) evaluate(key, node.propertyNames, path, depth + 1, issues);
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      const segment = safeSegment(key);
      evaluate(child, properties[key] as SchemaNode, segment === undefined ? path : `${path}.${segment}`, depth + 1, issues);
      continue;
    }
    if (node.additionalProperties === false) {
      issues.push(Object.freeze({ path, message: "Unexpected property." }));
      continue;
    }
    if (isRecord(node.additionalProperties)) {
      const segment = safeSegment(key);
      evaluate(child, node.additionalProperties, segment === undefined ? path : `${path}.${segment}`, depth + 1, issues);
    }
  }
}
