// src/url-resolver.js
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const YTDLP_PATH = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';
const RESOLVE_TIMEOUT_MS = 25000; // 25s — yt-dlp can be slow on first run
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h — YouTube CDN URLs typically valid 6h

const _cache = new Map();

const _purgeExpired = () => {
    const now = Date.now();
    for (const [k, v] of _cache) {
        if (now > v.expiresAt) _cache.delete(k);
    }
};

/**
 * Resolves a web page URL (YouTube, Dailymotion, Vimeo, etc.)
 * into a direct playable video URL using yt-dlp.
 *
 * Format priority:
 *   1. Best single-file MP4 (no merge needed, max compat with Android players)
 *   2. Best single-file WebM
 *   3. Absolute best (may trigger ffmpeg merge for higher quality)
 *
 * @param {string} pageUrl - The video page URL
 * @returns {Promise<string|null>} Direct stream URL, or null on failure
 */
const resolveDirectUrl = async (pageUrl) => {
    // Return from cache if still valid
    const hit = _cache.get(pageUrl);
    if (hit && Date.now() < hit.expiresAt) {
        console.log(`[URL_RESOLVER] Cache hit for: ${pageUrl}`);
        return hit.url;
    }

    console.log(`[URL_RESOLVER] Resolving: ${pageUrl}`);

    try {
        const args = [
            '--get-url',
            '--no-playlist',
            '--no-warnings',
            '--format', 'best[ext=mp4]/best[ext=webm]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
            '--socket-timeout', '10',
            pageUrl,
        ];

        const { stdout } = await Promise.race([
            execFileAsync(YTDLP_PATH, args, { timeout: RESOLVE_TIMEOUT_MS }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('yt-dlp timed out')), RESOLVE_TIMEOUT_MS)
            ),
        ]);

        // --get-url returns one URL per line; for merged formats it returns 2 (video + audio)
        // We take only the first — if it's a merged format, ffmpeg handled it already
        const urls = stdout.trim().split('\n').filter(Boolean);
        if (!urls.length) {
            console.warn(`[URL_RESOLVER] yt-dlp returned no URL for: ${pageUrl}`);
            return null;
        }

        const directUrl = urls[0];
        console.log(`[URL_RESOLVER] Resolved OK: ${directUrl.substring(0, 80)}...`);

        _purgeExpired();
        _cache.set(pageUrl, { url: directUrl, expiresAt: Date.now() + CACHE_TTL_MS });

        return directUrl;
    } catch (err) {
        console.warn(`[URL_RESOLVER] Failed for ${pageUrl}: ${err.message}`);
        return null;
    }
};

module.exports = { resolveDirectUrl };
