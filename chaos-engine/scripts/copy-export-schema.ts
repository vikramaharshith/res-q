import { copyFile, mkdir } from "node:fs/promises";

const destination = new URL("../dist/src/export/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(
  new URL("../src/export/public-simulation-export-v1.schema.json", import.meta.url),
  new URL("public-simulation-export-v1.schema.json", destination),
);
