// src/url-resolver.js

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const YTDLP_PATH        = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';
const RESOLVE_TIMEOUT_MS = 25000;   // 25s — yt-dlp can be slow on first run
const CACHE_TTL_MS       = 4 * 60 * 60 * 1000;   // 4h — YouTube CDN URLs valid ~6h

const cache = new Map();

const purgeExpired = () => {
    const now = Date.now();
    for (const [k, v] of cache) {
        if (now > v.expiresAt) cache.delete(k);
    }
};

// ─── Domain blocklist ─────────────────────────────────────────────────────────
// These domains consistently fail from VPS IPs (geo-blocked, bot-detection,
// or broken yt-dlp extractors). They are skipped immediately — no yt-dlp call
// is made — and the caller falls back to externalUrl.
const BLOCKED_DOMAINS = [
    'yandex.',          // YandexVideoPreview extractor broken upstream
    'yandex.kz',
    'yandex.ru',
    'yandex.com',
    'rutube.ru',        // Russian CDN, blocks non-RU IPs
    'naver.com',        // Korean portal, geo-restricted
    'bilibili.com',     // Chinese portal, geo-restricted
];

const isDomainBlocked = (url) => {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return BLOCKED_DOMAINS.some(d => hostname.includes(d));
    } catch {
        return false;
    }
};

// ─── ok.ru: VPS IP blocked but works in-browser ──────────────────────────────
// ok.ru blocks data-centre IPs at the TCP layer (ECONNRESET).
// We still attempt it so users with a proxy (ADDON_PROXY) benefit,
// but we cut the timeout short to 8s so it fails fast without a proxy.
const isSlowDomain = (url) => {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return hostname.includes('ok.ru') || hostname.includes('odnoklassniki.ru');
    } catch {
        return false;
    }
};

/**
 * Resolves a video page URL into a direct playable URL using yt-dlp.
 * Returns null quickly for known-blocked or known-broken domains.
 *
 * @param {string} pageUrl
 * @returns {Promise<string|null>}
 */
const resolveDirectUrl = async (pageUrl) => {
    // 1. Instant-skip for known-broken domains
    if (isDomainBlocked(pageUrl)) {
        console.log(`[URL_RESOLVER] Skipped (blocked domain): ${pageUrl}`);
        return null;
    }

    // 2. Cache hit
    const hit = cache.get(pageUrl);
    if (hit && Date.now() < hit.expiresAt) {
        console.log(`[URL_RESOLVER] Cache hit for ${pageUrl}`);
        return hit.url;
    }

    console.log(`[URL_RESOLVER] Resolving: ${pageUrl}`);

    // 3. Use a shorter timeout for domains known to block VPS IPs at TCP level
    const timeoutMs = isSlowDomain(pageUrl) ? 8000 : RESOLVE_TIMEOUT_MS;

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
            execFileAsync(YTDLP_PATH, args, { timeout: timeoutMs }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('yt-dlp timed out')), timeoutMs)
            ),
        ]);

        // --get-url returns one URL per line (two for merged formats: video + audio).
        // We take the first — if it was a merged format, ffmpeg already handled it.
        const urls = stdout.trim().split('\n').filter(Boolean);
        if (!urls.length) {
            console.warn(`[URL_RESOLVER] yt-dlp returned no URL for ${pageUrl}`);
            return null;
        }

        const directUrl = urls[0];
        console.log(`[URL_RESOLVER] Resolved OK: ${directUrl.substring(0, 80)}...`);

        purgeExpired();
        cache.set(pageUrl, { url: directUrl, expiresAt: Date.now() + CACHE_TTL_MS });

        return directUrl;
    } catch (err) {
        console.warn(`[URL_RESOLVER] Failed for ${pageUrl}: ${err.message}`);
        return null;
    }
};

module.exports = { resolveDirectUrl };
