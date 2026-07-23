"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const ffmpegPath = require("ffmpeg-static");
const logger = require("../utils/logger");

// tgcalls expects raw signed 16-bit little-endian PCM, mono, 48kHz.
const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Spawns ffmpeg to transcode a local file into a raw PCM stream on stdout.
 * Returns { stream, process } - stream is a Readable, process is the
 * underlying ffmpeg child so callers can kill() it on skip/stop.
 */
function toPcmStream(inputFilePath) {
  if (!fs.existsSync(inputFilePath)) {
    throw new Error(`Input file does not exist: ${inputFilePath}`);
  }

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputFilePath,
    "-f",
    "s16le",
    "-ac",
    String(CHANNELS),
    "-ar",
    String(SAMPLE_RATE),
    "-acodec",
    "pcm_s16le",
    "pipe:1"
  ];

  const ffmpegProcess = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });

  ffmpegProcess.stderr.on("data", (chunk) => {
    logger.warn("ffmpeg", chunk.toString().trim());
  });

  ffmpegProcess.on("error", (err) => {
    logger.error("ffmpeg", `Failed to spawn ffmpeg for ${inputFilePath}`, err);
  });

  return {
    stream: ffmpegProcess.stdout,
    process: ffmpegProcess,
    sampleRate: SAMPLE_RATE,
    channelCount: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE
  };
}

/**
 * Deletes a downloaded temp file, swallowing errors (e.g. already removed).
 */
function deleteFile(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      logger.warn("ffmpeg", `Failed to delete temp file ${filePath}: ${err.message}`);
    }
  });
}

module.exports = { toPcmStream, deleteFile, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE };
