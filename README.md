# Telegram Voice Chat Music Bot

Plays music into Telegram group/supergroup voice chats using:

- **grammY** — the bot-token side (commands, permissions)
- **GramJS (`telegram`)** — MTProto userbot client(s) that actually join the voice chat
- **tgcalls-gramjs** — bridges GramJS to Telegram's group-call WebRTC layer
- **yt-dlp** — search + download, no YouTube API key or cookies
- **FFmpeg** — transcodes downloaded audio to raw PCM for streaming

No Spotify keys, no Google API key, no MongoDB, no Docker, no `.env` — everything lives in `config.js`.

## 1. Requirements

- Ubuntu 22.04 or 24.04 (other Linux distros will likely work but are untested by this script)
- Node.js 20, 22, or 24
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An `api_id` / `api_hash` pair from https://my.telegram.org
- At least one Telegram **account** (phone number) to act as the "assist" userbot that physically joins voice chats — bot accounts cannot join voice chats themselves, this is a Telegram platform limitation

## 2. Install

```bash
git clone <this-repo>
cd music-bot
sudo ./install.sh
```

This installs `ffmpeg`, `yt-dlp`, Node.js (if missing), PM2, and your npm dependencies.

## 3. Configure

Edit `config.js`:

```js
module.exports = {
  BOT_TOKEN: "123456:ABC-your-bot-token",
  API_ID: 123456,
  API_HASH: "your32characterapihash",
  OWNER_ID: 123456789,
  PREFIX: "/"
};
```

## 4. Add a userbot (assist) account

In a private chat with your bot, as the owner:

```
/adduser
+91XXXXXXXXXX
/otp 12345
/password yourpassword   (only if your account has 2FA enabled)
```

The session is saved under `sessions/` and reconnects automatically on every restart. Repeat `/adduser` to add more accounts — `/listusers`, `/removeuser <name>`, and `/logoutuser <name>` manage them.

## 5. Run

```bash
pm2 start ecosystem.config.js
pm2 logs music-bot
pm2 startup && pm2 save   # survive VPS reboots
```

## 6. Use it

Add the bot **and** the userbot account to your group, start a voice chat, then (group admins only):

```
/play never gonna give you up
/vplay https://youtube.com/watch?v=...
/pause  /resume  /skip  /stop  /end
/queue  /clear  /shuffle  /loop queue
/nowplaying
/search lofi hip hop
```

## Honest notes on this stack

- `tgcalls-gramjs` is a small, low-traffic community package (see its npm/Socket.dev listing). It works, but it's not as actively maintained as the Python `pytgcalls` ecosystem — if you hit voice-chat join/stream bugs, check its GitHub issues before assuming your code is wrong.
- The userbot account joining a voice chat 24/7 to relay audio is common practice for this genre of bot, but it does mean that account is subject to Telegram's normal account-limits/ToS like any other client — don't run more assist accounts than you're prepared to actually operate as real accounts.
- Downloaded audio files are deleted automatically after each track finishes (`player/ffmpegConverter.js` → `deleteFile`). If the bot crashes mid-track, orphaned files can be safely deleted from `downloads/`.

## Project structure

```
music-bot/
  config.js
  index.js
  package.json
  commands/       bot command handlers (grammY)
  handlers/        conversation state + global error handling
  player/          yt-dlp search, ffmpeg conversion, queue, voice-chat streaming
  telegram/        GramJS userbot session manager (login, persistence, reconnect)
  utils/           logger, permission checks
  sessions/        saved userbot sessions (gitignored)
  downloads/       temp audio files (auto-cleaned)
  logs/            error.log, music.log, pm2 logs
  install.sh
  update.sh
  ecosystem.config.js
```
