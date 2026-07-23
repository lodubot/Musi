"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const config = require("../config");
const logger = require("../utils/logger");

const DOWNLOAD_DIR = path.join(__dirname, "..", config.DOWNLOAD_DIR || "downloads");

// --- Source 1: id-y2mate.com ------------------------------------------------

const Y2MATE_BASE = "https://id-y2mate.com";
const Y2MATE_MAX_TOTAL_MS = 58000;
const Y2MATE_POLL_LIMIT = 55;
const Y2MATE_POLL_DELAY_MS = 1000;

function findDownloadUrl(data) {
  if (!data) return null;
  if (typeof data === "string") {
    const match = data.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0].replace(/\\\//g, "/") : null;
  }
  if (typeof data !== "object") return null;
  const keys = ["dlink", "download", "download_url", "url", "link", "result", "result_url", "file", "href"];
  for (const key of keys) {
    if (typeof data[key] === "string" && /^https?:\/\//i.test(data[key])) {
      return data[key].replace(/\\\//g, "/");
    }
  }
  for (const value of Object.values(data)) {
    const found = findDownloadUrl(value);
    if (found) return found;
  }
  return null;
}

function pickFormat(links, type, quality) {
  const group = links && links[type];
  if (!group) return null;
  const entries = Object.entries(group).map(([id, data]) => ({ id, ...data }));
  return (
    entries.find((v) => v.q === quality || v.id === quality) ||
    entries.find((v) => v.q === "auto") ||
    entries[0] ||
    null
  );
}

async function tryY2mate(youtubeUrl) {
  const startedAt = Date.now();
  const jar = new CookieJar();
  const api = wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 20000,
      validateStatus: () => true,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept: "*/*",
        origin: Y2MATE_BASE,
        referer: `${Y2MATE_BASE}/`,
        "x-requested-with": "XMLHttpRequest"
      }
    })
  );

  const elapsed = () => Date.now() - startedAt;

  await api.get(`${Y2MATE_BASE}/`, { timeout: 15000 });

  const analyzeBody = new URLSearchParams({ k_query: youtubeUrl, k_page: "home", hl: "en", q_auto: "0" });
  const analyzeRes = await api.post(`${Y2MATE_BASE}/mates/analyzeV2/ajax`, analyzeBody.toString(), {
    timeout: 20000,
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }
  });

  if (analyzeRes.status !== 200 || analyzeRes.data?.status !== "ok") {
    throw new Error(`y2mate analyze failed: ${analyzeRes.data?.message || analyzeRes.status}`);
  }

  const detail = analyzeRes.data;
  const selected = pickFormat(detail.links, "mp3", "128kbps");
  if (!selected || !selected.k) {
    throw new Error("y2mate: no mp3 format available for this video");
  }

  const convertBody = new URLSearchParams({ vid: detail.vid, k: selected.k });
  const convertRes = await api.post(`${Y2MATE_BASE}/mates/convertV2/index`, convertBody.toString(), {
    timeout: 20000,
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }
  });

  let resultUrl = findDownloadUrl(convertRes.data);

  if (!resultUrl && convertRes.data?.b_id) {
    for (let i = 0; i < Y2MATE_POLL_LIMIT; i++) {
      if (elapsed() >= Y2MATE_MAX_TOTAL_MS) break;
      const pollBody = new URLSearchParams({ b_id: convertRes.data.b_id });
      const pollRes = await api.post(`${Y2MATE_BASE}/mates/convertV2/pool`, pollBody.toString(), {
        timeout: 10000,
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }
      });
      const found = findDownloadUrl(pollRes.data);
      if (found) {
        resultUrl = found;
        break;
      }
      if (pollRes.data?.c_status === "FAILED" || pollRes.data?.status === "error") break;
      await new Promise((r) => setTimeout(r, Y2MATE_POLL_DELAY_MS));
    }
  }

  if (!resultUrl) throw new Error("y2mate: no download link produced");
  return { title: detail.title || "Unknown title", downloadUrl: resultUrl };
}

// --- Source 2: akuari.my.id -------------------------------------------------

async function tryAkuari(youtubeUrl) {
  const { data } = await axios.get("https://api.akuari.my.id/downloader/ytmp3", {
    params: { link: youtubeUrl },
    timeout: 30000,
    maxRedirects: 5
  });

  if (!data || !data.status || !data.hasil || !data.hasil.url) {
    throw new Error("akuari: no result");
  }

  return { title: data.hasil.title || "Unknown title", downloadUrl: data.hasil.url };
}

// --- Public API --------------------------------------------------------------

/**
 * Tries each fallback source in turn and downloads the resulting mp3 into
 * downloads/<random>.mp3. Only meant to be used when yt-dlp itself fails
 * (e.g. YouTube blocking the server's IP) — these are unofficial third-party
 * sites with no uptime guarantee, so treat this as a last resort, not primary.
 */
async function downloadAudioFallback(youtubeUrl) {
  const sources = [
    { name: "y2mate", fn: tryY2mate },
    { name: "akuari", fn: tryAkuari }
  ];

  let lastError = null;
  for (const source of sources) {
    try {
      const { title, downloadUrl } = await source.fn(youtubeUrl);
      const filePath = await fetchToFile(downloadUrl);
      logger.info("fallbackDownload", `Downloaded via ${source.name}: ${title}`);
      return { title, filePath };
    } catch (err) {
      lastError = err;
      logger.warn("fallbackDownload", `${source.name} failed: ${err.message}`);
    }
  }

  throw new Error(
    `All fallback download sources failed. Last error: ${lastError ? lastError.message : "unknown"}`
  );
}

async function fetchToFile(url) {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const id = crypto.randomBytes(6).toString("hex");
  const filePath = path.join(DOWNLOAD_DIR, `fallback_${id}.mp3`);

  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 60000, maxRedirects: 10 });
  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error("Downloaded fallback audio was empty");

  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = { downloadAudioFallback };
