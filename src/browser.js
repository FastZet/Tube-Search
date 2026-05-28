// src/browser.js
const puppeteer = require('puppeteer-core');

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

let _browser = null;

const getBrowser = async () => {
    if (_browser && _browser.isConnected()) return _browser;

    const proxyUrl = process.env.ADDON_PROXY && process.env.ADDON_PROXY.trim();

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
            // Route Chromium through the proxy if ADDON_PROXY is set
            ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : []),
        ],
    });

    _browser.on('disconnected', () => {
        console.warn('[BROWSER] Chromium disconnected — will relaunch on next request');
        _browser = null;
    });

    console.log('[BROWSER] Chromium ready');
    return _browser;
};

// Rotate through realistic Chrome UAs to avoid fingerprint monotony
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
        // This establishes a cookie/session so the search doesn't arrive "cold"
        // from a suspicious datacenter IP, which is a strong CAPTCHA signal.
        if (url.includes('google.com/search')) {
            try {
                await page.goto('https://www.google.com/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000,
                });
                // Human-like delay: 1.5 – 3.5 seconds
                const jitter = 1500 + Math.random() * 2000;
                await new Promise(r => setTimeout(r, jitter));
            } catch (_) {
                // Warm-up failure is non-fatal — continue to the real URL
            }
        }

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        if (waitForSelector) {
            await page.waitForSelector(waitForSelector, { timeout: 8000 }).catch(() => {
                // Selector didn't appear — page may still have partial content, continue anyway
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
