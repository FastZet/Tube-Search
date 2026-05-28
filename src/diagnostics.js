// src/diagnostics.js
const { fetchRenderedPage } = require('./browser');
const config = require('./config');
const cheerio = require('cheerio');

/**
 * Runs a real Google video search using headless Chromium and diagnoses
 * exactly why scraping may be returning 0 results.
 */
const checkGoogleAccess = async () => {
    const testQuery = 'Inception 2010 full movie';
    const url = `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(testQuery)}&tbm=vid&tbs=dur:l`;

    console.log('[DIAGNOSTICS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[DIAGNOSTICS] Google scrape diagnostic starting...');
    console.log(`[DIAGNOSTICS] Test URL: ${url}`);

    try {
        const html = await fetchRenderedPage(url, 'a[href*="youtube.com"], div.g');

        if (!html) {
            console.error('[DIAGNOSTICS] ❌ RESULT: Chromium failed to fetch the page — browser may have crashed');
            return { ok: false, reason: 'browser_failed' };
        }

        const body = html;
        const snippet = body.substring(0, 800).replace(/\s+/g, ' ');

        console.log(`[DIAGNOSTICS] Response size: ${body.length} bytes`);

        // --- Check 1: CAPTCHA / unusual traffic page ---
        const isCaptcha =
            body.includes('detected unusual traffic') ||
            body.includes('our systems have detected') ||
            body.includes('/sorry/index') ||
            body.includes('recaptcha') ||
            body.toLowerCase().includes('captcha');

        if (isCaptcha) {
            console.error('[DIAGNOSTICS] ❌ RESULT: CAPTCHA — Google flagged this IP even with a real browser');
            console.error('[DIAGNOSTICS] Fix: Use a residential proxy via ADDON_PROXY env variable');
            console.error(`[DIAGNOSTICS] Response snippet: ${snippet}`);
            return { ok: false, reason: 'captcha' };
        }

        // --- Check 2: JS rendered fine but selectors find nothing ---
        const $ = cheerio.load(body);

        const videoLinks = $('a[href]').filter((_, el) => {
            const href = $(el).attr('href') || '';
            return (
                href.includes('youtube.com/watch') ||
                href.includes('dailymotion.com/video') ||
                href.includes('vimeo.com/') ||
                href.includes('archive.org/details')
            );
        });

        const scraperResults = $('div.g, div[data-ved], div.MjjYud').filter((_, el) => {
            const text = $(el).text();
            return text.length > 10;
        });

        console.log(`[DIAGNOSTICS] Raw video platform links found in page: ${videoLinks.length}`);
        console.log(`[DIAGNOSTICS] Scraper-style result containers found: ${scraperResults.length}`);

        if (videoLinks.length === 0 && scraperResults.length === 0) {
            console.error('[DIAGNOSTICS] ❌ RESULT: SELECTOR MISMATCH — JS rendered fine but zero video links found');
            console.error('[DIAGNOSTICS] Google likely changed their HTML structure — scraper selectors need updating');
            console.error(`[DIAGNOSTICS] Response snippet: ${snippet}`);
            return { ok: false, reason: 'selector_mismatch' };
        }

        if (videoLinks.length > 0) {
            console.log(`[DIAGNOSTICS] ✅ RESULT: Google access is working fine`);
            videoLinks.slice(0, 5).each((_, el) => {
                console.log(`[DIAGNOSTICS]   Found link: ${$(el).attr('href')}`);
            });
            return { ok: true, videoLinksFound: videoLinks.length };
        }

        // Containers found but no video platform links
        console.warn('[DIAGNOSTICS] ⚠️  RESULT: Got result containers but no video platform URLs');
        console.warn('[DIAGNOSTICS] Scraper selectors may need updating');
        console.warn(`[DIAGNOSTICS] Response snippet: ${snippet}`);
        return { ok: false, reason: 'no_video_links' };

    } catch (err) {
        console.error(`[DIAGNOSTICS] ❌ RESULT: Unexpected error — ${err.message}`);
        if (err.code) console.error(`[DIAGNOSTICS] Error code: ${err.code}`);
        return { ok: false, reason: 'unexpected_error', error: err.message, code: err.code };
    } finally {
        console.log('[DIAGNOSTICS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
};

module.exports = { checkGoogleAccess };
