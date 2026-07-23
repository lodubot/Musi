"use strict";

const config = require("../config");
const logger = require("../utils/logger");
const { isOwner } = require("../utils/permissions");
const sessionManager = require("../telegram/sessionManager");
const conversationState = require("../handlers/conversationState");

const STAGE_AWAITING_PHONE = "awaiting_phone";
const PHONE_REGEX = /^\+?\d{7,15}$/;

function requireOwner(ctx) {
  if (!isOwner(ctx)) {
    ctx.reply("Only the bot owner can manage userbot accounts.");
    return false;
  }
  if (!config.API_ID || !config.API_HASH) {
    ctx.reply("API_ID / API_HASH are not set in config.js yet. Fill them in from https://my.telegram.org first.");
    return false;
  }
  return true;
}

function registerUserAccountCommands(bot) {
  bot.command("adduser", (ctx) => {
    if (!requireOwner(ctx)) return;

    if (sessionManager.pendingLogins.has(ctx.chat.id)) {
      return ctx.reply("A login is already in progress in this chat. Send /canceladduser to abort it.");
    }

    conversationState.set(ctx.chat.id, STAGE_AWAITING_PHONE);
    ctx.reply(
      "Send the Telegram phone number for the account you want to add, in international format.\n\nExample:\n+91XXXXXXXXXX"
    );
  });

  bot.command("canceladduser", (ctx) => {
    if (!requireOwner(ctx)) return;
    conversationState.clear(ctx.chat.id);
    const cancelled = sessionManager.cancelLogin(ctx.chat.id);
    ctx.reply(cancelled ? "Login cancelled." : "There was no login in progress.");
  });

  bot.command("otp", (ctx) => {
    if (!requireOwner(ctx)) return;
    const code = ctx.match && ctx.match.trim();
    if (!code) {
      return ctx.reply("Usage: /otp 12345");
    }
    try {
      sessionManager.provideOtp(ctx.chat.id, code);
      ctx.reply("OTP received, continuing login...");
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.command("password", (ctx) => {
    if (!requireOwner(ctx)) return;
    const password = ctx.match && ctx.match.trim();
    if (!password) {
      return ctx.reply("Usage: /password yourpassword");
    }
    try {
      sessionManager.providePassword(ctx.chat.id, password);
      ctx.reply("Password received, continuing login...");
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.command("listusers", (ctx) => {
    if (!requireOwner(ctx)) return;
    const users = sessionManager.listUsers();
    if (users.length === 0) {
      return ctx.reply("No userbot accounts added yet. Use /adduser to add one.");
    }
    const lines = users.map(
      (u, i) => `${i + 1}. ${u.sessionName} (+${u.phone}) — ${u.connected ? "connected" : "disconnected"}`
    );
    ctx.reply(lines.join("\n"));
  });

  bot.command("removeuser", async (ctx) => {
    if (!requireOwner(ctx)) return;
    const sessionName = ctx.match && ctx.match.trim();
    if (!sessionName) {
      return ctx.reply("Usage: /removeuser <sessionName>\nRun /listusers to see session names.");
    }
    try {
      await sessionManager.removeUser(sessionName);
      ctx.reply(`Removed session: ${sessionName}`);
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.command("logoutuser", async (ctx) => {
    if (!requireOwner(ctx)) return;
    const sessionName = ctx.match && ctx.match.trim();
    if (!sessionName) {
      return ctx.reply("Usage: /logoutuser <sessionName>\nRun /listusers to see session names.");
    }
    try {
      await sessionManager.logoutUser(sessionName);
      ctx.reply(`Logged out and removed session: ${sessionName}`);
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }
  });

  // Handles the plain-text phone number reply that follows /adduser.
  bot.on("message:text", async (ctx, next) => {
    const state = conversationState.get(ctx.chat.id);
    if (!state || state.stage !== STAGE_AWAITING_PHONE) {
      return next();
    }

    const phoneNumber = ctx.message.text.trim();
    if (!PHONE_REGEX.test(phoneNumber)) {
      return ctx.reply("That doesn't look like a valid phone number. Send it like: +91XXXXXXXXXX");
    }

    conversationState.clear(ctx.chat.id);
    ctx.reply(`Sending OTP to ${phoneNumber}... Reply with /otp 12345 once you receive it.`);

    try {
      await sessionManager.startLogin(
        ctx.chat.id,
        phoneNumber,
        (sessionName) => {
          ctx.reply(`Userbot account added successfully: ${sessionName}`);
        },
        (err) => {
          logger.error("userAccounts", "Login failed", err);
          ctx.reply(`Login failed: ${err.message}`);
        }
      );
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }
  });
}

module.exports = { registerUserAccountCommands };
