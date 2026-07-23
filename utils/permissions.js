"use strict";

const config = require("../config");

function isOwner(ctx) {
  const userId = ctx.from && ctx.from.id;
  return Boolean(userId) && Number(userId) === Number(config.OWNER_ID);
}

async function isGroupAdmin(ctx) {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
    // In private chats / channels-as-owner context, fall back to owner check.
    return isOwner(ctx);
  }
  if (isOwner(ctx)) return true;

  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return member.status === "administrator" || member.status === "creator";
  } catch (_err) {
    return false;
  }
}

module.exports = { isOwner, isGroupAdmin };
