"use strict";

// Maps chatId -> { stage: string, data: object }
const states = new Map();

function set(chatId, stage, data = {}) {
  states.set(chatId, { stage, data });
}

function get(chatId) {
  return states.get(chatId) || null;
}

function clear(chatId) {
  states.delete(chatId);
}

function isAwaiting(chatId, stage) {
  const state = states.get(chatId);
  return Boolean(state) && state.stage === stage;
}

module.exports = { set, get, clear, isAwaiting };
