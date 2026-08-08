import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PackageMeta = {
  name: string;
  version: string;
};

/**
 * Resolve package.json from compiled (dist/) or source (src/) layout.
 */
export function getPackageMeta(): PackageMeta {
  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = require(join(here, "..", "package.json")) as PackageMeta;
  return { name: pkg.name, version: pkg.version };
}

export function getPackageVersion(): string {
  return getPackageMeta().version;
}

export function getPackageName(): string {
  return getPackageMeta().name;
}
