// src/diagnostics.js
const http = require('./http-client');
const config = require('./config');
const cheerio = require('cheerio');

/**
 * Runs a real Google video search and diagnoses exactly why scraping
 * may be returning 0 results: IP block, CAPTCHA, selector mismatch, or success.
 */
const checkGoogleAccess = async () => {
    const testQuery = 'Inception 2010 full movie';
    const url = `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(testQuery)}&tbm=vid&tbs=dur:l`;

    console.log('[DIAGNOSTICS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[DIAGNOSTICS] Google scrape diagnostic starting...');
    console.log(`[DIAGNOSTICS] Test URL: ${url}`);

    try {
        const response = await http.get(url, {
            headers: {
                'User-Agent': config.scraping.userAgent,
                'Accept-Language': 'en-US,en;q=0.5',
            },
            validateStatus: () => true, // never throw on HTTP errors
            timeout: 15000,
        });

        const status = response.status;
        const body = (response.data || '').toString();
        const snippet = body.substring(0, 800).replace(/\s+/g, ' ');

        console.log(`[DIAGNOSTICS] HTTP status: ${status}`);
        console.log(`[DIAGNOSTICS] Response size: ${body.length} bytes`);

        // --- Check 1: Hard IP block ---
        if (status === 429) {
            console.error('[DIAGNOSTICS] ❌ RESULT: IP BLOCKED — Google returned 429 Too Many Requests');
            console.error('[DIAGNOSTICS] Fix: Use a residential proxy via ADDON_PROXY env variable');
            return { ok: false, reason: 'ip_blocked_429', status };
        }

        if (status === 403) {
            console.error('[DIAGNOSTICS] ❌ RESULT: IP BLOCKED — Google returned 403 Forbidden');
            console.error('[DIAGNOSTICS] Fix: Use a residential proxy via ADDON_PROXY env variable');
            return { ok: false, reason: 'ip_blocked_403', status };
        }

        if (status !== 200) {
            console.error(`[DIAGNOSTICS] ❌ RESULT: Unexpected HTTP ${status}`);
            console.error(`[DIAGNOSTICS] Response snippet: ${snippet}`);
            return { ok: false, reason: `unexpected_status_${status}`, status };
        }

        // --- Check 2: CAPTCHA / unusual traffic page (status 200 but not real results) ---
        const isCaptcha =
            body.includes('detected unusual traffic') ||
            body.includes('our systems have detected') ||
            body.includes('/sorry/index') ||
            body.includes('recaptcha') ||
            body.toLowerCase().includes('captcha');

        if (isCaptcha) {
            console.error('[DIAGNOSTICS] ❌ RESULT: CAPTCHA — Google flagged this IP and is serving a challenge page');
            console.error('[DIAGNOSTICS] Fix: Use a residential proxy via ADDON_PROXY env variable');
            console.error(`[DIAGNOSTICS] Response snippet: ${snippet}`);
            return { ok: false, reason: 'captcha', status };
        }

        // --- Check 3: Real 200 but selectors find nothing (HTML structure changed) ---
        const $ = cheerio.load(body);

        // Count raw video platform links in the page
        const videoLinks = $('a[href]').filter((_, el) => {
            const href = $(el).attr('href') || '';
            return (
                href.includes('youtube.com/watch') ||
                href.includes('dailymotion.com/video') ||
                href.includes('vimeo.com/') ||
                href.includes('archive.org/details')
            );
        });

        // Count what the actual scraper selectors would find
        // (mirror whatever selectors scraper-service.js uses)
        const scraperResults = $('div.g, div[data-ved], div.MjjYud').filter((_, el) => {
            const text = $(el).text();
            return text.length > 10;
        });

        console.log(`[DIAGNOSTICS] Raw video platform links found in page: ${videoLinks.length}`);
        console.log(`[DIAGNOSTICS] Scraper-style result containers found: ${scraperResults.length}`);

        if (videoLinks.length === 0 && scraperResults.length === 0) {
            console.error('[DIAGNOSTICS] ❌ RESULT: SELECTOR MISMATCH — Got 200 with content but zero video links found');
            console.error('[DIAGNOSTICS] Google likely changed their HTML structure');
            console.error(`[DIAGNOSTICS] Response snippet: ${snippet}`);
            return { ok: false, reason: 'selector_mismatch', status };
        }

        if (videoLinks.length > 0) {
            console.log(`[DIAGNOSTICS] ✅ RESULT: Google access is working fine`);
            videoLinks.slice(0, 5).each((_, el) => {
                console.log(`[DIAGNOSTICS]   Found link: ${$(el).attr('href')}`);
            });
            return { ok: true, status, videoLinksFound: videoLinks.length };
        }

        // Got containers but no video links — partial selector match
        console.warn('[DIAGNOSTICS] ⚠️  RESULT: Got result containers but no video platform URLs');
        console.warn('[DIAGNOSTICS] Scraper selectors may need updating');
        console.warn(`[DIAGNOSTICS] Response snippet: ${snippet}`);
        return { ok: false, reason: 'no_video_links', status };

    } catch (err) {
        console.error(`[DIAGNOSTICS] ❌ RESULT: Request failed entirely — ${err.message}`);
        if (err.code) console.error(`[DIAGNOSTICS] Error code: ${err.code}`);
        console.error('[DIAGNOSTICS] This could mean the VPS has no outbound HTTP access to Google');
        return { ok: false, reason: 'request_failed', error: err.message, code: err.code };
    } finally {
        console.log('[DIAGNOSTICS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
};

module.exports = { checkGoogleAccess };
