const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * Ensures a JSON file exists at the given path. If it does not exist, creates
 * it with an empty array so the rest of the app can assume it is present.
 */
function ensureFileSync(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
  }
}

/**
 * Reads JSON from disk, defaulting to an empty array when the file is missing
 * or empty. Errors are re-thrown so the caller can decide how to react.
 */
async function readJson(filePath) {
  try {
    const data = await fsp.readFile(filePath, 'utf8');
    if (!data.trim()) {
      return [];
    }
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeJson(filePath, []);
      return [];
    }
    console.error(`Failed to read JSON file ${filePath}:`, err.message);
    throw err;
  }
}

/**
 * Writes data to disk in pretty-printed JSON format.
 */
async function writeJson(filePath, payload) {
  try {
    const json = JSON.stringify(payload, null, 2);
    await fsp.writeFile(filePath, json, 'utf8');
  } catch (err) {
    console.error(`Failed to write JSON file ${filePath}:`, err.message);
    throw err;
  }
}

module.exports = {
  ensureFileSync,
  readJson,
  writeJson
};
