import { registerHooks } from "node:module";

const root = new URL("../", import.meta.url);
const serverOnly = new URL("../node_modules/server-only/empty.js", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return nextResolve(serverOnly.href, context);
    if (specifier.startsWith("@/")) {
      const target = new URL(`${specifier.slice(2)}.ts`, root);
      return nextResolve(target.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (
      url.startsWith(root.href) &&
      !url.includes("/node_modules/") &&
      (url.endsWith(".ts") || url.endsWith(".mts"))
    ) {
      return nextLoad(url, { ...context, format: "module-typescript" });
    }
    return nextLoad(url, context);
  },
});
