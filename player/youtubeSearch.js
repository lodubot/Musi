"use strict";

const path = require("path");
const fs = require("fs");
const youtubeDl = require("youtube-dl-exec");
const config = require("../config");
const logger = require("../utils/logger");

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
  } catch (err) {
    logger.error("youtubeSearch", `yt-dlp download failed for ${track.url}`, err);
    throw new Error("Failed to download audio with yt-dlp.");
  }

  const prefix = `${track.id}-${track.id}.`;
  const match = fs.readdirSync(DOWNLOAD_DIR).find((f) => f.startsWith(prefix));
  if (!match) {
    throw new Error("Downloaded file not found after yt-dlp finished.");
  }
  return path.join(DOWNLOAD_DIR, match);
}

module.exports = { search, resolveTrack, downloadAudio, DOWNLOAD_DIR };
