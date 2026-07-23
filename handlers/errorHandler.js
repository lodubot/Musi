"use strict";

const { GrammyError, HttpError } = require("grammy");
const logger = require("../utils/logger");

function registerErrorHandler(bot) {
  bot.catch((err) => {
    const ctx = err.ctx;
    const error = err.error;

    if (error instanceof GrammyError) {
      logger.error("bot", `grammY API error for update ${ctx.update.update_id}`, error);
    } else if (error instanceof HttpError) {
      logger.error("bot", "Could not reach Telegram", error);
    } else {
      logger.error("bot", "Unknown error while handling update", error);
    }

    try {
      ctx.reply("Something went wrong handling that command. It has been logged.").catch(() => {});
    } catch (_err) {
      /* ignore secondary failure */
    }
  });
}

module.exports = { registerErrorHandler };
