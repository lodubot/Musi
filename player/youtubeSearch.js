"use strict";

const path = require("path");
const fs = require("fs");
//const { create } = require("youtube-dl-exec");
const config = require("../config");
const logger = require("../utils/logger");

// We skip youtube-dl-exec's own postinstall download (YOUTUBE_DL_SKIP_DOWNLOAD=1)
// and rely on the system-wide yt-dlp installed by install.sh instead.
const youtubeDl = create(config.YT_DLP_PATH || "/usr/local/bin/yt-dlp");

const DOWNLOAD_DIR = path.join(__dirname, "..", config.DOWNLOAD_DIR || "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const URL_REGEX = /^(https?:\/\/)/i;

/**
 * Runs a yt-dlp search (ytsearchN:) or resolves a direct URL's metadata.
 * Returns an array of { id, title, url, duration, uploader }.
 */
async function search(query, limit = 5) {
  const target = URL_REGEX.test(query) ? query : `ytsearch${limit}:${query}`;

  let output;
  try {
    output = await youtubeDl(target, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      skipDownload: true,
      flatPlaylist: true
    });
  } catch (err) {
    logger.error("youtubeSearch", `yt-dlp search failed for "${query}"`, err);
    throw new Error("Could not search YouTube. Make sure yt-dlp is installed and on PATH.");
  }

  const entries = output.entries ? output.entries : [output];
  return entries
    .filter(Boolean)
    .map((e) => ({
      id: e.id,
      title: e.title || "Unknown title",
      url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
      duration: e.duration || 0,
      uploader: e.uploader || e.channel || "Unknown"
    }));
}

/**
 * Resolves a single track from a raw user query: a direct URL is used as-is,
 * free text triggers a yt-dlp search and takes the top result.
 */
async function resolveTrack(query) {
  const results = await search(query, 1);
  if (results.length === 0) {
    throw new Error(`No results found for "${query}"`);
  }
  return results[0];
}

/**
 * Downloads best-available audio for a track into downloads/<id>.<ext>.
 * Falls back to third-party converter sites (player/fallbackDownload.js)
 * only if yt-dlp itself fails — e.g. YouTube blocking the server's IP.
 * Those fallbacks are unofficial and can break at any time, so yt-dlp
 * always gets tried first.
 * Returns the local file path. Caller is responsible for deleting it
 * once playback finishes (see player/voiceChatManager.js).
 */
async function downloadAudio(track) {
  const outputTemplate = path.join(DOWNLOAD_DIR, `${track.id}-%(id)s.%(ext)s`);

  try {
    await youtubeDl(track.url, {
      output: outputTemplate,
      format: "bestaudio/best",
      noPlaylist: true,
      noWarnings: true,
      noCheckCertificates: true,
      restrictFilenames: true
    });

    const prefix = `${track.id}-${track.id}.`;
    const match = fs.readdirSync(DOWNLOAD_DIR).find((f) => f.startsWith(prefix));
    if (!match) {
      throw new Error("Downloaded file not found after yt-dlp finished.");
    }
    return path.join(DOWNLOAD_DIR, match);
  } catch (err) {
    logger.warn("youtubeSearch", `yt-dlp download failed for ${track.url}, trying fallback sources`, err);
    try {
      const { downloadAudioFallback } = require("./fallbackDownload");
      const { filePath } = await downloadAudioFallback(track.url);
      return filePath;
    } catch (fallbackErr) {
      logger.error("youtubeSearch", `All download sources failed for ${track.url}`, fallbackErr);
      throw new Error("Failed to download audio (yt-dlp and fallback sources all failed).");
    }
  }
}

module.exports = { search, resolveTrack, downloadAudio, DOWNLOAD_DIR };
