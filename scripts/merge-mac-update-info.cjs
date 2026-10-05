const fs = require("node:fs");
const yaml = require("js-yaml");
const { mergeMacUpdateInfo } = require("../electron/update-info.cjs");

const [arm64Path, x64Path, outputPath] = process.argv.slice(2);
if (!arm64Path || !x64Path || !outputPath) {
  throw Error(
    "用法：node scripts/merge-mac-update-info.cjs ARM64.yml X64.yml OUTPUT.yml",
  );
}
const arm64 = yaml.load(fs.readFileSync(arm64Path, "utf8"));
const x64 = yaml.load(fs.readFileSync(x64Path, "utf8"));
const merged = mergeMacUpdateInfo(arm64, x64);
fs.writeFileSync(outputPath, yaml.dump(merged, { lineWidth: 120 }));
