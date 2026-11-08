#!/usr/bin/env node
import { runChaosCli } from "./chaos-cli.js";
process.exitCode = await runChaosCli(process.argv.slice(2));
