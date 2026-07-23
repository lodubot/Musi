"use strict";

const { isGroupAdmin } = require("../utils/permissions");
const youtubeSearch = require("../player/youtubeSearch");
const queueManager = require("../player/queueManager");
const logger = require("../utils/logger");

function formatDuration(seconds) {
  if (!seconds) return "live/unknown";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

async function requireGroup(ctx) {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("Music playback only works inside groups/supergroups with an active voice chat.");
    return false;
  }
  return true;
}

async function requireAdmin(ctx) {
  const allowed = await isGroupAdmin(ctx);
  if (!allowed) {
    await ctx.reply("Only group admins can control playback.");
  }
  return allowed;
}

function registerMusicCommands(bot) {
  bot.command(["play", "vplay"], async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    if (!(await requireAdmin(ctx))) return;

    const query = ctx.match && ctx.match.trim();
    if (!query) {
      return ctx.reply("Usage: /play <song name or YouTube URL>");
    }

    const statusMsg = await ctx.reply(`Searching for "${query}"...`);

    try {
      const track = await youtubeSearch.resolveTrack(query);
      const requestedBy = ctx.from.first_name || ctx.from.username || "someone";
      const { position, startedImmediately } = await queueManager.enqueue(ctx.chat.id, track, requestedBy);

      const text = startedImmediately
        ? `Now playing: ${track.title} (${formatDuration(track.duration)})`
        : `Queued at position ${position}: ${track.title} (${formatDuration(track.duration)})`;

      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, text);
    } catch (err) {
      logger.error("music", `/play failed for "${query}" in chat ${ctx.chat.id}`, err);
      await ctx.api
        .editMessageText(ctx.chat.id, statusMsg.message_id, `Error: ${err.message}`)
        .catch(() => {});
    }
  });

  bot.command("pause", async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    if (!(await requireAdmin(ctx))) return;
    const result = queueManager.pause(ctx.chat.id);
    if (result === null) return ctx.reply("Nothing is playing right now.");
    ctx.reply(result ? "Paused." : "Already paused.");
  });

  bot.command("resume", async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    if (!(await requireAdmin(ctx))) return;
    const result = queueManager.resume(ctx.chat.id);
    if (result === null) return ctx.reply("Nothing is playing right now.");
    ctx.reply(result ? "Resumed." : "Was not paused.");
  });

  bot.command("skip", async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    if (!(await requireAdmin(ctx))) return;
    try {
      await queueManager.skip(ctx.chat.id);
      ctx.reply("Skipped.");
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.command(["stop", "end"], async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    if (!(await requireAdmin(ctx))) return;
    try {
      await queueManager.stop(ctx.chat.id);
      ctx.reply("Stopped playback and left the voice chat.");
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.command("queue", async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    const { current, queue, loop } = queueManager.getQueue(ctx.chat.id);

    if (!current && queue.length === 0) {
      return ctx.reply("Queue is empty.");
    }

    const lines = [];
    if (current) {
      lines.push(`Now playing: ${current.title} (${formatDuration(current.duration)}) — requested by ${current.requestedBy}`);
    }
    if (queue.length > 0) {
      lines.push("", "Up next:");
      queue.slice(0, 20).forEach((t, i) => {
        lines.push(`${i + 1}. ${t.title} (${formatDuration(t.duration)}) — ${t.requestedBy}`);
      });
      if (queue.length > 20) {
        lines.push(`...and ${queue.length - 20} more`);
      }
    }
    lines.push("", `Loop: ${loop}`);
    ctx.reply(lines.join("\n"));
  });

  bot.command("clear", async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    if (!(await requireAdmin(ctx))) return;
    const count = queueManager.clear(ctx.chat.id);
    ctx.reply(`Cleared ${count} track(s) from the queue.`);
  });

  bot.command("shuffle", async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    if (!(await requireAdmin(ctx))) return;
    const count = queueManager.shuffle(ctx.chat.id);
    ctx.reply(`Shuffled ${count} track(s) in the queue.`);
  });

  bot.command("loop", async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    if (!(await requireAdmin(ctx))) return;
    const mode = (ctx.match && ctx.match.trim().toLowerCase()) || "";
    if (!mode) {
      return ctx.reply("Usage: /loop off|track|queue");
    }
    try {
      const applied = queueManager.setLoop(ctx.chat.id, mode);
      ctx.reply(`Loop mode set to: ${applied}`);
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.command("nowplaying", async (ctx) => {
    if (!(await requireGroup(ctx))) return;
    const { current } = queueManager.getQueue(ctx.chat.id);
    if (!current) return ctx.reply("Nothing is playing right now.");
    ctx.reply(`Now playing: ${current.title} (${formatDuration(current.duration)}) — requested by ${current.requestedBy}\n${current.url}`);
  });

  bot.command("search", async (ctx) => {
    const query = ctx.match && ctx.match.trim();
    if (!query) {
      return ctx.reply("Usage: /search <query>");
    }
    const statusMsg = await ctx.reply(`Searching for "${query}"...`);
    try {
      const results = await youtubeSearch.search(query, 5);
      if (results.length === 0) {
        return ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "No results found.");
      }
      const lines = results.map(
        (r, i) => `${i + 1}. ${r.title} (${formatDuration(r.duration)}) — ${r.uploader}\n${r.url}`
      );
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, lines.join("\n\n"));
    } catch (err) {
      await ctx.api
        .editMessageText(ctx.chat.id, statusMsg.message_id, `Error: ${err.message}`)
        .catch(() => {});
    }
  });
}

module.exports = { registerMusicCommands };
