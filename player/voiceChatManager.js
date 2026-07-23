"use strict";

const { GramTGCalls } = require("tgcalls-gramjs");
const logger = require("../utils/logger");
const sessionManager = require("../telegram/sessionManager");
const ffmpegConverter = require("./ffmpegConverter");

// chatId -> { gram: GramTGCalls, ffmpegProcess, currentFile, sessionName }
const activeCalls = new Map();

function requireAssistClient() {
  const assist = sessionManager.getAnyClient();
  if (!assist) {
    throw new Error(
      "No userbot account is connected. Add one with /adduser before playing music."
    );
  }
  return assist;
}

/**
 * Joins (if needed) the voice chat for a chat and starts streaming the
 * given local audio file. Calls onFinish() when playback completes
 * naturally (used by the queue manager to advance to the next track).
 */
async function playFile(chatId, filePath, onFinish) {
  let entry = activeCalls.get(chatId);

  if (!entry) {
    const assist = requireAssistClient();
    const gram = new GramTGCalls(assist.client, chatId);
    entry = { gram, ffmpegProcess: null, currentFile: null, sessionName: assist.sessionName };
    activeCalls.set(chatId, entry);
  }

  // Stop whatever is currently playing in this chat before starting the next track.
  if (entry.ffmpegProcess) {
    try {
      entry.ffmpegProcess.kill("SIGKILL");
    } catch (_err) {
      /* already exited */
    }
    entry.ffmpegProcess = null;
  }
  if (entry.currentFile) {
    ffmpegConverter.deleteFile(entry.currentFile);
    entry.currentFile = null;
  }

  const { stream, process: ffmpegProcess, sampleRate, channelCount, bitsPerSample } =
    ffmpegConverter.toPcmStream(filePath);

  entry.ffmpegProcess = ffmpegProcess;
  entry.currentFile = filePath;

  await entry.gram.stream({
    readable: stream,
    options: {
      sampleRate,
      channelCount,
      bitsPerSample,
      onFinish: () => {
        ffmpegConverter.deleteFile(entry.currentFile);
        entry.currentFile = null;
        entry.ffmpegProcess = null;
        if (typeof onFinish === "function") onFinish();
      }
    }
  });

  logger.music(`Streaming started in chat ${chatId}: ${filePath}`);
}

function pause(chatId) {
  const entry = activeCalls.get(chatId);
  if (!entry) return null;
  return entry.gram.pauseAudio();
}

function resume(chatId) {
  const entry = activeCalls.get(chatId);
  if (!entry) return null;
  return entry.gram.resumeAudio();
}

async function stopAndLeave(chatId) {
  const entry = activeCalls.get(chatId);
  if (!entry) return false;

  if (entry.ffmpegProcess) {
    try {
      entry.ffmpegProcess.kill("SIGKILL");
    } catch (_err) {
      /* already exited */
    }
  }
  if (entry.currentFile) {
    ffmpegConverter.deleteFile(entry.currentFile);
  }

  const result = await entry.gram.stop();
  activeCalls.delete(chatId);
  logger.music(`Left voice chat ${chatId}`);
  return result;
}

function isActive(chatId) {
  return activeCalls.has(chatId);
}

module.exports = { playFile, pause, resume, stopAndLeave, isActive };
