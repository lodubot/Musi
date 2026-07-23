#!/usr/bin/env bash
set -euo pipefail

echo "=== Telegram Voice Chat Music Bot — installer (Ubuntu 22.04 / 24.04) ==="

if [ "$EUID" -ne 0 ]; then
  echo "Please run this script with sudo: sudo ./install.sh"
  exit 1
fi

echo "--> Updating apt package lists..."
apt-get update -y

echo "--> Installing system packages (ffmpeg, python3, curl, build tools)..."
apt-get install -y ffmpeg python3 python3-pip curl build-essential ca-certificates

echo "--> Installing/upgrading yt-dlp..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version

if ! command -v node >/dev/null 2>&1; then
  echo "--> Installing Node.js 20 LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "--> Node version: $(node -v)"
echo "--> npm version: $(npm -v)"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "--> Installing PM2 globally..."
  npm install -g pm2
fi

echo "--> Installing project dependencies..."
npm install --omit=dev

mkdir -p sessions downloads logs

if [ ! -f config.js ]; then
  echo "config.js not found. Create it before starting the bot (see README.md)."
else
  echo "config.js already present."
fi

echo ""
echo "=== Install complete ==="
echo "1. Edit config.js with your BOT_TOKEN, API_ID, API_HASH, OWNER_ID"
echo "2. Start the bot:   pm2 start ecosystem.config.js"
echo "3. View logs:       pm2 logs music-bot"
echo "4. Enable on boot:  pm2 startup && pm2 save"
