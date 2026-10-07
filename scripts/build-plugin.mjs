import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const packageDir = resolve(process.argv[2] ?? "magpie-plugin");
await mkdir(join(packageDir, "dist"), { recursive: true });

await build({
  entryPoints: ["src/magpie/plugin.ts"],
  outfile: join(packageDir, "dist/index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["es2023"],
  legalComments: "none",
  treeShaking: true,
});
await copyFile("LICENSE", join(packageDir, "LICENSE"));
await copyFile("node_modules/zod/LICENSE", join(packageDir, "THIRD_PARTY_LICENSES.txt"));
if (packageDir !== resolve("magpie-plugin")) {
  for (const file of ["package.json", "README.md"])
    await copyFile(join("magpie-plugin", file), join(packageDir, file));
}
