"use strict";

const fs = require("fs");
const path = require("path");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const config = require("../config");
const logger = require("../utils/logger");

const SESSIONS_DIR = path.join(__dirname, "..", config.SESSIONS_DIR || "sessions");
const INDEX_FILE = path.join(SESSIONS_DIR, "index.json");

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * On-disk index: { "<sessionName>": { phone, addedBy, addedAt } }
 */
function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch (err) {
    logger.error("sessionManager", "Failed to parse sessions/index.json, starting fresh", err);
    return {};
  }
}

function writeIndex(indexObj) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexObj, null, 2), "utf8");
}

function sanitizePhone(phone) {
  return phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
}

function sessionFilePath(sessionName) {
  return path.join(SESSIONS_DIR, `${sessionName}.session`);
}

// In-memory registry of connected userbot clients, keyed by sessionName.
const activeClients = new Map();

// In-memory registry of logins that are mid-flow (waiting for OTP / password),
// keyed by the Telegram chat id of the admin who ran /adduser.
const pendingLogins = new Map();

/**
 * Begin an /adduser login flow. Does not block: registers resolver hooks
 * that /otp and /password (via provideOtp / providePassword) will fulfill.
 */
async function startLogin(chatId, phoneNumber, onDone, onError) {
  if (pendingLogins.has(chatId)) {
    throw new Error("A login is already in progress for this chat. Finish or /cancel it first.");
  }

  const sanitized = sanitizePhone(phoneNumber);
  const sessionName = sanitized;

  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, Number(config.API_ID), config.API_HASH, {
    connectionRetries: 5
  });

  const state = {
    client,
    phoneNumber: sanitized,
    sessionName,
    codeResolver: null,
    passwordResolver: null,
    finished: false
  };
  pendingLogins.set(chatId, state);

  const waitForCode = () =>
    new Promise((resolve) => {
      state.codeResolver = resolve;
    });

  const waitForPassword = () =>
    new Promise((resolve) => {
      state.passwordResolver = resolve;
    });

  // Fire-and-forget: GramJS's start() call will hang on phoneCode / password
  // until provideOtp() / providePassword() resolve the pending promises above.
  client
    .start({
      phoneNumber: async () => sanitized,
      phoneCode: waitForCode,
      password: waitForPassword,
      onError: (err) => {
        logger.error("sessionManager", `Login error for ${sanitized}`, err);
        if (!state.finished) {
          state.finished = true;
          pendingLogins.delete(chatId);
          onError(err);
        }
      }
    })
    .then(async () => {
      if (state.finished) return;
      state.finished = true;

      const savedSession = client.session.save();
      fs.writeFileSync(sessionFilePath(sessionName), savedSession, "utf8");

      const index = readIndex();
      index[sessionName] = {
        phone: sanitized,
        addedBy: chatId,
        addedAt: new Date().toISOString()
      };
      writeIndex(index);

      activeClients.set(sessionName, client);
      pendingLogins.delete(chatId);

      logger.info("sessionManager", `Userbot session created: ${sessionName}`);
      onDone(sessionName);
    })
    .catch((err) => {
      if (!state.finished) {
        state.finished = true;
        pendingLogins.delete(chatId);
        logger.error("sessionManager", `Login flow failed for ${sanitized}`, err);
        onError(err);
      }
    });

  return sessionName;
}

function provideOtp(chatId, code) {
  const state = pendingLogins.get(chatId);
  if (!state) {
    throw new Error("No login in progress. Start one with /adduser first.");
  }
  if (!state.codeResolver) {
    throw new Error("Not waiting for an OTP right now.");
  }
  const resolve = state.codeResolver;
  state.codeResolver = null;
  resolve(String(code).trim());
}

function providePassword(chatId, password) {
  const state = pendingLogins.get(chatId);
  if (!state) {
    throw new Error("No login in progress. Start one with /adduser first.");
  }
  if (!state.passwordResolver) {
    throw new Error("Not waiting for a 2FA password right now.");
  }
  const resolve = state.passwordResolver;
  state.passwordResolver = null;
  resolve(String(password));
}

function cancelLogin(chatId) {
  const state = pendingLogins.get(chatId);
  if (!state) return false;
  state.finished = true;
  pendingLogins.delete(chatId);
  try {
    state.client.destroy();
  } catch (_err) {
    /* ignore */
  }
  return true;
}

function listUsers() {
  const index = readIndex();
  return Object.entries(index).map(([sessionName, meta]) => ({
    sessionName,
    phone: meta.phone,
    addedAt: meta.addedAt,
    connected: activeClients.has(sessionName)
  }));
}

async function removeUser(sessionName) {
  const index = readIndex();
  if (!index[sessionName]) {
    throw new Error(`No such session: ${sessionName}`);
  }

  const client = activeClients.get(sessionName);
  if (client) {
    try {
      await client.destroy();
    } catch (_err) {
      /* ignore */
    }
    activeClients.delete(sessionName);
  }

  const file = sessionFilePath(sessionName);
  if (fs.existsSync(file)) fs.unlinkSync(file);

  delete index[sessionName];
  writeIndex(index);
}

async function logoutUser(sessionName) {
  const client = activeClients.get(sessionName);
  if (!client) {
    throw new Error(`Session ${sessionName} is not currently connected.`);
  }
  await client.invoke(new (require("telegram").Api.auth.LogOut)());
  await removeUser(sessionName);
}

/**
 * Called once at boot: reconnects every saved session so the bot survives
 * restarts without re-running /adduser.
 */
async function loadAllSessions() {
  const index = readIndex();
  const sessionNames = Object.keys(index);

  for (const sessionName of sessionNames) {
    const file = sessionFilePath(sessionName);
    if (!fs.existsSync(file)) {
      logger.warn("sessionManager", `Missing session file for ${sessionName}, skipping`);
      continue;
    }

    try {
      const savedSession = fs.readFileSync(file, "utf8").trim();
      const stringSession = new StringSession(savedSession);
      const client = new TelegramClient(stringSession, Number(config.API_ID), config.API_HASH, {
        connectionRetries: 5
      });

      await client.connect();
      const isAuthorized = await client.isUserAuthorized();
      if (!isAuthorized) {
        logger.warn("sessionManager", `Session ${sessionName} is no longer authorized, removing`);
        await removeUser(sessionName);
        continue;
      }

      activeClients.set(sessionName, client);
      logger.info("sessionManager", `Reconnected userbot session: ${sessionName}`);
    } catch (err) {
      logger.error("sessionManager", `Failed to reconnect session ${sessionName}`, err);
    }
  }

  return activeClients;
}

function getClient(sessionName) {
  return activeClients.get(sessionName);
}

function getAllClients() {
  return Array.from(activeClients.entries()).map(([sessionName, client]) => ({ sessionName, client }));
}

function getAnyClient() {
  const first = activeClients.values().next();
  return first.done ? null : first.value;
}

module.exports = {
  startLogin,
  provideOtp,
  providePassword,
  cancelLogin,
  listUsers,
  removeUser,
  logoutUser,
  loadAllSessions,
  getClient,
  getAllClients,
  getAnyClient,
  pendingLogins
};
