// src/browser.js
const puppeteer = require('puppeteer-core');

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

let _browser = null;

const getBrowser = async () => {
    if (_browser && _browser.isConnected()) return _browser;

    console.log('[BROWSER] Launching Chromium...');
    _browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // use /tmp instead of /dev/shm (important in Docker)
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--mute-audio',
        ],
    });

    _browser.on('disconnected', () => {
        console.warn('[BROWSER] Chromium disconnected — will relaunch on next request');
        _browser = null;
    });

    console.log('[BROWSER] Chromium ready');
    return _browser;
};

/**
 * Fetches a URL using a real headless browser, executing JavaScript.
 * Returns the fully rendered HTML string, or null on failure.
 */
const fetchRenderedPage = async (url, waitForSelector = null) => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

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
