// src/browser.js
const puppeteer = require('puppeteer-core');

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

let _browser = null;

// ---------------------------------------------------------------------------
// Internal helper: parse ADDON_PROXY into a host:port string that Chromium
// understands via --proxy-server.
//
// gluetun exposes a plain HTTP proxy (e.g. http://gluetun:8080).
// Chromium's --proxy-server flag accepts  "http=host:port;https=host:port"
// or just "host:port" (which applies to all schemes).
//
// The key insight: we NEVER pass --proxy-server for HTTPS targets because
// gluetun's built-in HTTP proxy does NOT support the CONNECT method that
// HTTPS tunneling requires.  Instead we route ALL traffic through the
// gluetun *network namespace* (i.e. the container's default route already
// exits through the VPN) and simply do NOT pass any proxy flag to Chromium.
//
// However, if the operator has configured a proper CONNECT-capable proxy
// (e.g. Squid, tinyproxy with CONNECT enabled, a SOCKS5 proxy), we honour
// it via --proxy-server.
//
// Detection rule:
//   socks4:// | socks5://  → always supports CONNECT → pass to Chromium
//   http://                → assume plain-HTTP-only (gluetun default) → skip
//   https://               → treat as CONNECT-capable → pass to Chromium
// ---------------------------------------------------------------------------
const _chromiumProxyArg = () => {
    const raw = (process.env.ADDON_PROXY || '').trim();
    if (!raw) return null;

    try {
        const u = new URL(raw);
        const scheme = u.protocol.replace(':', '');

        if (scheme === 'socks4' || scheme === 'socks5') {
            // e.g. socks5://user:pass@host:1080  →  socks5://host:1080
            return `--proxy-server=socks5://${u.hostname}:${u.port}`;
        }

        if (scheme === 'https') {
            return `--proxy-server=https://${u.hostname}:${u.port}`;
        }

        // scheme === 'http' (gluetun, tinyproxy plain-HTTP, etc.)
        // These proxies do NOT support HTTP CONNECT for HTTPS targets.
        // Chromium routes HTTPS through the OS network stack (already VPN-ed),
        // so we skip --proxy-server entirely.
        console.log('[BROWSER] ADDON_PROXY is plain-HTTP; skipping --proxy-server for Chromium (VPN container routing assumed)');
        return null;

    } catch (_) {
        return null;
    }
};

const getBrowser = async () => {
    if (_browser && _browser.isConnected()) return _browser;

    const proxyArg = _chromiumProxyArg();

    console.log('[BROWSER] Launching Chromium...');
    _browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--mute-audio',
            // Only injected for SOCKS or HTTPS proxies; plain-HTTP proxies
            // (gluetun) are intentionally omitted — see _chromiumProxyArg().
            ...(proxyArg ? [proxyArg] : []),
        ],
    });

    _browser.on('disconnected', () => {
        console.warn('[BROWSER] Chromium disconnected — will relaunch on next request');
        _browser = null;
    });

    console.log('[BROWSER] Chromium ready');
    return _browser;
};

// Rotate realistic Chrome UAs to reduce fingerprint monotony
const _USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

/**
 * Fetches a URL using a real headless browser, executing JavaScript.
 * Returns the fully rendered HTML string, or null on failure.
 */
const fetchRenderedPage = async (url, waitForSelector = null) => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        const ua = _USER_AGENTS[Math.floor(Math.random() * _USER_AGENTS.length)];
        await page.setUserAgent(ua);

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
        });

        // Block images, fonts, media — we only need HTML/JS
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Warm up with google.com homepage before any search request.
        // Arriving "cold" from a datacenter IP is a strong CAPTCHA signal;
        // a prior homepage visit establishes cookies that reduce bot-score.
        if (url.includes('google.com/search')) {
            try {
                await page.goto('https://www.google.com/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000,
                });
                // Human-like pause: 1.5 – 3.5 seconds
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
            } catch (_) {
                // Warm-up failure is non-fatal — continue to the real URL
            }
        }

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        if (waitForSelector) {
            await page.waitForSelector(waitForSelector, { timeout: 8000 }).catch(() => {
                // Selector didn't appear — page may still have partial content
            });
        }

        return await page.content();
    } catch (err) {
        console.error(`[BROWSER] fetchRenderedPage failed for ${url}: ${err.message}`);
        return null;
    } finally {
        await page.close();
    }
};

const closeBrowser = async () => {
    if (_browser) {
        await _browser.close();
        _browser = null;
        console.log('[BROWSER] Chromium closed');
    }
};

module.exports = { getBrowser, fetchRenderedPage, closeBrowser };
