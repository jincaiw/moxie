const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const yaml = require("js-yaml");

async function sha512Base64(filePath, byteLength) {
  const hash = createHash("sha512");
  let total = 0;
  for await (const chunk of createReadStream(filePath, {
    end: byteLength - 1,
  })) {
    hash.update(chunk);
    total += chunk.length;
  }
  if (total !== byteLength)
    throw new Error(
      `${path.basename(filePath)} is shorter than its metadata size.`,
    );
  return hash.digest("base64");
}

function hasUdifTrailerAt(filePath, byteLength) {
  if (byteLength < 512) return false;
  const descriptor = fs.openSync(filePath, "r");
  try {
    const magic = Buffer.alloc(4);
    return (
      fs.readSync(descriptor, magic, 0, magic.length, byteLength - 512) === 4 &&
      magic.toString("ascii") === "koly"
    );
  } finally {
    fs.closeSync(descriptor);
  }
}

async function normalizeMacDmgFiles(directory = "release") {
  const metadataPath = path.join(directory, "latest-mac.yml");
  const metadata = yaml.load(fs.readFileSync(metadataPath, "utf8"));
  const dmgEntries = (metadata.files || []).filter(
    (entry) => typeof entry.url === "string" && entry.url.endsWith(".dmg"),
  );
  if (dmgEntries.length === 0)
    throw new Error("latest-mac.yml does not contain any DMG entries.");

  for (const entry of dmgEntries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 512 || !entry.sha512)
      throw new Error(`Invalid DMG metadata for ${entry.url}.`);
    const filePath = path.join(directory, path.basename(entry.url));
    const actualSize = fs.statSync(filePath).size;
    if (actualSize < entry.size)
      throw new Error(`${entry.url} is shorter than its latest-mac.yml size.`);
    if (!hasUdifTrailerAt(filePath, entry.size))
      throw new Error(`${entry.url} has no UDIF trailer at its metadata size.`);
    const digest = await sha512Base64(filePath, entry.size);
    if (digest !== entry.sha512)
      throw new Error(
        `${entry.url} does not match its latest-mac.yml SHA-512.`,
      );
    if (actualSize > entry.size) {
      fs.truncateSync(filePath, entry.size);
      process.stdout.write(
        `Trimmed ${entry.url} from ${actualSize} to ${entry.size} bytes using verified metadata.\n`,
      );
    } else {
      process.stdout.write(`Verified ${entry.url} (${entry.size} bytes).\n`);
    }
  }
}

if (require.main === module) {
  normalizeMacDmgFiles(process.argv[2] || "release").catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { normalizeMacDmgFiles };
