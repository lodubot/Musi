"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");

const LOGS_DIR = path.join(__dirname, "..", config.LOGS_DIR || "logs");

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const ERROR_LOG = path.join(LOGS_DIR, "error.log");
const MUSIC_LOG = path.join(LOGS_DIR, "music.log");

function timestamp() {
  return new Date().toISOString();
}

function appendLine(filePath, line) {
  fs.appendFile(filePath, line + "\n", (err) => {
    if (err) {
      // Last resort: if we can't write logs, surface it on stderr once.
      process.stderr.write(`[logger] failed to write to ${filePath}: ${err.message}\n`);
    }
  });
}

function formatMeta(meta) {
  if (!meta) return "";
  if (meta instanceof Error) {
    return ` :: ${meta.message}\n${meta.stack}`;
  }
  try {
    return ` :: ${JSON.stringify(meta)}`;
  } catch (_err) {
    return ` :: ${String(meta)}`;
  }
}

const logger = {
  info(scope, message, meta) {
    const line = `[${timestamp()}] [INFO] [${scope}] ${message}${formatMeta(meta)}`;
    console.log(line);
    appendLine(MUSIC_LOG, line);
  },

  music(message, meta) {
    const line = `[${timestamp()}] [MUSIC] ${message}${formatMeta(meta)}`;
    console.log(line);
    appendLine(MUSIC_LOG, line);
  },

  warn(scope, message, meta) {
    const line = `[${timestamp()}] [WARN] [${scope}] ${message}${formatMeta(meta)}`;
    console.warn(line);
    appendLine(MUSIC_LOG, line);
  },

  error(scope, message, meta) {
    const line = `[${timestamp()}] [ERROR] [${scope}] ${message}${formatMeta(meta)}`;
    console.error(line);
    appendLine(ERROR_LOG, line);
  }
};

module.exports = logger;
