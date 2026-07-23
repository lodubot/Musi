"use strict";

const config = require("../config");
const sessionManager = require("../telegram/sessionManager");

const HELP_TEXT = `Telegram Voice Chat Music Bot

Account setup (owner only):
/adduser - add a Telegram userbot account (phone login)
/otp <code> - submit the OTP you received
/password <password> - submit 2FA password if required
/canceladduser - abort an in-progress login
/listusers - list connected userbot accounts
/removeuser <sessionName> - delete a saved session
/logoutuser <sessionName> - log out and delete a session

Music (group admins only):
/play <song name or URL> - play audio in the voice chat
/vplay <name or URL> - play video/audio stream
/pause - pause playback
/resume - resume playback
/skip - skip current track
/stop - stop and clear the queue
/end - end the voice chat stream and leave
/queue - show the current queue
/clear - clear the queue
/shuffle - shuffle the queue
/loop off|track|queue - set loop mode
/nowplaying - show the currently playing track
/search <query> - search YouTube without playing

General:
/ping - check bot latency
/help - show this message`;

function registerBasicCommands(bot) {
  bot.command("start", (ctx) => {
    ctx.reply("Music bot is online. Send /help to see available commands.");
  });

  bot.command("help", (ctx) => {
    ctx.reply(HELP_TEXT);
  });

  bot.command("ping", async (ctx) => {
    const start = Date.now();
    const sent = await ctx.reply("Pinging...");
    const latency = Date.now() - start;
    const connectedAccounts = sessionManager.listUsers().filter((u) => u.connected).length;
    await ctx.api.editMessageText(
      ctx.chat.id,
      sent.message_id,
      `Pong! ${latency}ms\nPrefix: ${config.PREFIX}\nConnected userbot accounts: ${connectedAccounts}`
    );
  });
}

module.exports = { registerBasicCommands };
