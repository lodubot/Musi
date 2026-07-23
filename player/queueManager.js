"use strict";

const config = require("../config");
const logger = require("../utils/logger");
const youtubeSearch = require("./youtubeSearch");
const voiceChatManager = require("./voiceChatManager");

const LOOP_OFF = "off";
const LOOP_TRACK = "track";
const LOOP_QUEUE = "queue";

// chatId -> { queue: Track[], current: Track|null, loop: string, busy: boolean, requestedBy: Map }
const chats = new Map();

function getState(chatId) {
  let state = chats.get(chatId);
  if (!state) {
    state = { queue: [], current: null, loop: LOOP_OFF, busy: false };
    chats.set(chatId, state);
  }
  return state;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Adds a resolved track to the chat's queue. Kicks off playback immediately
 * if nothing is currently playing.
 */
async function enqueue(chatId, track, requestedByName) {
  const state = getState(chatId);
  if (state.queue.length >= (config.MAX_QUEUE_SIZE || 200)) {
    throw new Error(`Queue is full (max ${config.MAX_QUEUE_SIZE || 200} tracks).`);
  }

  const queuedTrack = { ...track, requestedBy: requestedByName || "unknown" };
  state.queue.push(queuedTrack);

  const startedImmediately = !state.current && !state.busy;
  if (startedImmediately) {
    await advance(chatId);
  }
  return { queuedTrack, position: state.queue.length, startedImmediately };
}

/**
 * Pulls the next track off the queue and starts streaming it. Handles
 * loop-track (replay same) and loop-queue (recycle to the back) modes.
 */
async function advance(chatId) {
  const state = getState(chatId);
  if (state.busy) return;
  state.busy = true;

  try {
    let next = null;

    if (state.loop === LOOP_TRACK && state.current) {
      next = state.current;
    } else {
      if (state.loop === LOOP_QUEUE && state.current) {
        state.queue.push(state.current);
      }
      next = state.queue.shift() || null;
    }

    if (!next) {
      state.current = null;
      state.busy = false;
      return;
    }

    state.current = next;

    const filePath = await youtubeSearch.downloadAudio(next);
    await voiceChatManager.playFile(chatId, filePath, () => {
      state.busy = false;
      advance(chatId).catch((err) => {
        logger.error("queueManager", `Failed to auto-advance in chat ${chatId}`, err);
      });
    });

    logger.music(`Now playing in chat ${chatId}: ${next.title}`);
  } catch (err) {
    logger.error("queueManager", `Failed to play next track in chat ${chatId}`, err);
    state.current = null;
    state.busy = false;
    // Try the next queued track instead of stalling forever on a bad one.
    if (state.queue.length > 0) {
      await advance(chatId);
    }
    throw err;
  } finally {
    state.busy = false;
  }
}

async function skip(chatId) {
  const state = getState(chatId);
  if (!state.current && state.queue.length === 0) {
    throw new Error("Nothing is playing.");
  }
  // Force loop-track off for this one skip so it doesn't replay itself.
  const savedLoop = state.loop;
  if (savedLoop === LOOP_TRACK) state.loop = LOOP_OFF;
  await advance(chatId);
  if (savedLoop === LOOP_TRACK) state.loop = savedLoop;
}

async function stop(chatId) {
  const state = getState(chatId);
  state.queue = [];
  state.current = null;
  state.loop = LOOP_OFF;
  await voiceChatManager.stopAndLeave(chatId);
}

function pause(chatId) {
  return voiceChatManager.pause(chatId);
}

function resume(chatId) {
  return voiceChatManager.resume(chatId);
}

function clear(chatId) {
  const state = getState(chatId);
  const count = state.queue.length;
  state.queue = [];
  return count;
}

function shuffle(chatId) {
  const state = getState(chatId);
  shuffleArray(state.queue);
  return state.queue.length;
}

function setLoop(chatId, mode) {
  if (![LOOP_OFF, LOOP_TRACK, LOOP_QUEUE].includes(mode)) {
    throw new Error(`Invalid loop mode: ${mode}`);
  }
  const state = getState(chatId);
  state.loop = mode;
  return mode;
}

function getQueue(chatId) {
  const state = getState(chatId);
  return { current: state.current, queue: state.queue, loop: state.loop };
}

module.exports = {
  enqueue,
  advance,
  skip,
  stop,
  pause,
  resume,
  clear,
  shuffle,
  setLoop,
  getQueue,
  LOOP_OFF,
  LOOP_TRACK,
  LOOP_QUEUE
};
