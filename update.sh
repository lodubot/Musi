#!/usr/bin/env bash
set -euo pipefail

echo "=== Updating Telegram Voice Chat Music Bot ==="

echo "--> Updating yt-dlp..."
if [ -w /usr/local/bin/yt-dlp ]; then
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod a+rx /usr/local/bin/yt-dlp
else
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  sudo chmod a+rx /usr/local/bin/yt-dlp
fi
yt-dlp --version

echo "--> Installing npm dependencies..."
npm install --omit=dev

echo "--> Restarting via PM2..."
pm2 restart ecosystem.config.js --update-env

echo "=== Update complete ==="
pm2 logs music-bot --lines 20 --nostream
