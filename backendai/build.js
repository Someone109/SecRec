import fs from "fs";
import path from "path";
import { build } from "esbuild";

const timeStart = new Date();
const TARGET_NODE_VERSION = "node20";

const minifyAndTreeShake = false;

const currDir = process.cwd();
console.log("Targeting node version: " + TARGET_NODE_VERSION);

//get all external node modules so they won't be complied into the worker
const nodeModulesPath = path.resolve("node_modules");
const externals = fs
  .readdirSync(nodeModulesPath)
  .filter((dir) => {
    if (dir.startsWith("@")) {
      const scopedPath = path.join(nodeModulesPath, dir);
      return fs.readdirSync(scopedPath).map((subdir) => `${dir}/${subdir}`);
    }
    return dir;
  })
  .flat();

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: TARGET_NODE_VERSION,
  format: "esm",
  metafile: true,
  outdir: "dist",
  minify: minifyAndTreeShake,
  treeShaking: minifyAndTreeShake,
  external: externals,
}).then((result) => {
  fs.writeFileSync("meta.json", JSON.stringify(result.metafile));
});

const timeDiff = new Date().getTime() - timeStart.getTime();

console.log("Done compiling in " + timeDiff + " ms!");
