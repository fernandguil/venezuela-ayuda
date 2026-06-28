import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = path.join(__dirname, "../messages");

// Helper to flatten a nested object into a set of dot-notation keys
function flattenKeys(obj, prefix = "") {
  return Object.keys(obj).reduce((acc, k) => {
    const pre = prefix.length ? prefix + "." : "";
    if (typeof obj[k] === "object" && obj[k] !== null && !Array.isArray(obj[k])) {
      Object.assign(acc, flattenKeys(obj[k], pre + k));
    } else {
      acc[pre + k] = true;
    }
    return acc;
  }, {});
}

test("i18n namespace parity between 'es' and 'en'", async () => {
  const esDir = path.join(MESSAGES_DIR, "es");
  const enDir = path.join(MESSAGES_DIR, "en");

  const esFiles = (await fs.readdir(esDir)).filter(f => f.endsWith(".json"));
  const enFiles = (await fs.readdir(enDir)).filter(f => f.endsWith(".json"));

  // 1. Check if both locales have the exact same namespace files
  assert.deepStrictEqual(
    esFiles.sort(),
    enFiles.sort(),
    "Missing or extra namespace files between 'es' and 'en'."
  );

  // 2. Check each file for exact key parity
  for (const file of esFiles) {
    const esRaw = await fs.readFile(path.join(esDir, file), "utf-8");
    const enRaw = await fs.readFile(path.join(enDir, file), "utf-8");

    const esObj = JSON.parse(esRaw);
    const enObj = JSON.parse(enRaw);

    const esKeys = Object.keys(flattenKeys(esObj)).sort();
    const enKeys = Object.keys(flattenKeys(enObj)).sort();

    assert.deepStrictEqual(
      esKeys,
      enKeys,
      `Key mismatch in namespace '${file}'. Both locales must have the exact same keys.`
    );
  }
});
