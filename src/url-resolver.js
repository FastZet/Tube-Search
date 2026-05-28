// src/url-resolver.js

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const YTDLP_PATH          = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';
const RESOLVE_TIMEOUT_MS  = 25000;
const CACHE_TTL_MS        = 4 * 60 * 60 * 1000;

const cache = new Map();

const purgeExpired = () => {
    const now = Date.now();
    for (const [k, v] of cache) {
        if (now > v.expiresAt) cache.delete(k);
    }
};

const hostnameOf = (url) => {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
};

const isYouTube = (url) => {
    const host = hostnameOf(url);
    return host.includes('youtube.com') || host === 'youtu.be' || host.endsWith('.youtube.com');
};

const isBlockedDomain = (url) => {
    const host = hostnameOf(url);
    if (!host) return false;

    return (
        host.includes('yandex.') ||
        host.includes('rutube.ru') ||
        host.includes('naver.com') ||
        host.includes('bilibili.com')
    );
};

const isOkRu = (url) => {
    const host = hostnameOf(url);
    return host.includes('ok.ru') || host.includes('odnoklassniki.ru');
};

const canResolveYouTubeDirectly = () => {
    return process.env.YTDLP_ENABLE_YOUTUBE === 'true';
};

const getFormatSelector = (pageUrl) => {
    if (isYouTube(pageUrl)) {
        // IMPORTANT:
        // We need a single direct-play URL for Stremio, not split audio+video URLs.
        // So prefer a progressive MP4 stream, then WebM, then any single best stream.
        return 'best[ext=mp4]/best[ext=webm]/best';
    }

    return 'best[ext=mp4]/best[ext=webm]/best';
};

const buildArgs = (pageUrl) => {
    const args = [
        '--get-url',
        '--no-playlist',
        '--no-warnings',
        '--format',
        getFormatSelector(pageUrl),
        '--socket-timeout',
        '10',
    ];

    const cookiesFile = process.env.YTDLP_COOKIES_FILE;
    if (cookiesFile) {
        args.push('--cookies', cookiesFile);
    }

    args.push(pageUrl);
    return args;
};

const resolveDirectUrl = async (pageUrl) => {
    if (isBlockedDomain(pageUrl)) {
        console.log(`[URL_RESOLVER] Skipped (blocked extractor/domain): ${pageUrl}`);
        return null;
    }

    if (isYouTube(pageUrl) && !canResolveYouTubeDirectly()) {
        console.log(`[URL_RESOLVER] Skipped YouTube direct resolution (set YTDLP_ENABLE_YOUTUBE=true to enable): ${pageUrl}`);
        return null;
    }

    const hit = cache.get(pageUrl);
    if (hit && Date.now() < hit.expiresAt) {
        console.log(`[URL_RESOLVER] Cache hit for ${pageUrl}`);
        return hit.url;
    }

    console.log(`[URL_RESOLVER] Resolving: ${pageUrl}`);

    const timeoutMs = isOkRu(pageUrl) ? 8000 : RESOLVE_TIMEOUT_MS;

    try {
        const args = buildArgs(pageUrl);
        const { stdout } = await Promise.race([
            execFileAsync(YTDLP_PATH, args, { timeout: timeoutMs }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('yt-dlp timed out')), timeoutMs)
            ),
        ]);

        const urls = stdout.trim().split('\n').filter(Boolean);
        if (!urls.length) {
            console.warn(`[URL_RESOLVER] yt-dlp returned no URL for ${pageUrl}`);
            return null;
        }

        const directUrl = urls[0];
        console.log(`[URL_RESOLVER] Resolved OK: ${directUrl.substring(0, 80)}...`);

        purgeExpired();
        cache.set(pageUrl, {
            url: directUrl,
            expiresAt: Date.now() + CACHE_TTL_MS,
        });

        return directUrl;
    } catch (err) {
        const msg = err.message || '';

        if (isYouTube(pageUrl) && msg.includes('Sign in to confirm you’re not a bot')) {
            console.warn(`[URL_RESOLVER] YouTube bot-check encountered; using externalUrl fallback: ${pageUrl}`);
            return null;
        }

        console.warn(`[URL_RESOLVER] Failed for ${pageUrl}: ${msg}`);
        return null;
    }
};

module.exports = { resolveDirectUrl };
