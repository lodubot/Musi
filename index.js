"use strict";

const { Bot } = require("grammy");
const config = require("./config");
const logger = require("./utils/logger");
const sessionManager = require("./telegram/sessionManager");

const { registerBasicCommands } = require("./commands/basic");
const { registerUserAccountCommands } = require("./commands/userAccounts");
const { registerMusicCommands } = require("./commands/music");
const { registerErrorHandler } = require("./handlers/errorHandler");

function assertConfig() {
  const missing = [];
  if (!config.BOT_TOKEN) missing.push("BOT_TOKEN");
  if (!config.API_ID) missing.push("API_ID");
  if (!config.API_HASH) missing.push("API_HASH");
  if (!config.OWNER_ID) missing.push("OWNER_ID");

  if (missing.length > 0) {
    logger.error("bootstrap", `config.js is missing required fields: ${missing.join(", ")}`);
    console.error(
      `\nconfig.js is missing: ${missing.join(", ")}\nFill these in before starting the bot. See README.md.\n`
    );
    process.exit(1);
  }
}

async function main() {
  assertConfig();

  const bot = new Bot(config.BOT_TOKEN);

  registerErrorHandler(bot);
  registerBasicCommands(bot);
  registerUserAccountCommands(bot);
  registerMusicCommands(bot);

  logger.info("bootstrap", "Reconnecting saved userbot sessions...");
  await sessionManager.loadAllSessions();

  bot.catch((err) => {
    logger.error("bootstrap", "Unhandled bot error", err);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("process", "Unhandled promise rejection", reason);
  });

  process.on("SIGINT", async () => {
    logger.info("bootstrap", "Shutting down (SIGINT)...");
    for (const { client } of sessionManager.getAllClients()) {
      try {
        await client.destroy();
      } catch (_err) {
        /* ignore */
      }
    }
    await bot.stop();
    process.exit(0);
  });

  await bot.start({
    onStart: (botInfo) => {
      logger.info("bootstrap", `Bot started as @${botInfo.username}`);
    }
  });
}

main().catch((err) => {
  logger.error("bootstrap", "Fatal error during startup", err);
  process.exit(1);
});
