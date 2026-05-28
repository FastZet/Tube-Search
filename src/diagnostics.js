// src/diagnostics.js
// Tests the Serper API key instead of hitting Google with Chromium.

const checkGoogleAccess = async () => {
    const apiKey = process.env.SERPER_API_KEY;

    console.log('[DIAGNOSTICS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[DIAGNOSTICS] Serper API diagnostic starting...');

    if (!apiKey) {
        console.error('[DIAGNOSTICS] ❌ RESULT: SERPER_API_KEY env variable is not set');
        console.error('[DIAGNOSTICS] Fix: Add SERPER_API_KEY=<your_key> to your environment');
        console.log('[DIAGNOSTICS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return { ok: false, reason: 'no_api_key' };
    }

    const testQuery = 'Inception 2010 full movie';
    console.log(`[DIAGNOSTICS] Test query: "${testQuery}"`);

    try {
        const http = require('./http-client');
        const response = await http.post(
            'https://google.serper.dev/videos',
            JSON.stringify({ q: testQuery, tbs: 'dur:l', num: 5 }),
            {
                headers: {
                    'X-API-KEY':    apiKey,
                    'Content-Type': 'application/json',
                },
            }
        );

        const videos = response.data?.videos || [];
        console.log(`[DIAGNOSTICS] ✅ RESULT: Serper API working — ${videos.length} video(s) returned`);
        videos.slice(0, 3).forEach((v, i) => {
            console.log(`[DIAGNOSTICS]   [${i + 1}] ${v.title} → ${v.link}`);
        });
        if (videos.length === 0) {
            console.warn('[DIAGNOSTICS] ⚠️  API responded but returned 0 results for test query');
        }

        console.log('[DIAGNOSTICS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return { ok: true, videoCount: videos.length };

    } catch (err) {
        const status = err.response?.status;
        const body   = JSON.stringify(err.response?.data || {}).slice(0, 300);

        if (status === 401 || status === 403) {
            console.error(`[DIAGNOSTICS] ❌ RESULT: Serper key invalid or expired (HTTP ${status})`);
            console.error('[DIAGNOSTICS] Fix: Check your key at https://serper.dev/dashboard');
        } else if (status === 429) {
            console.error('[DIAGNOSTICS] ❌ RESULT: Serper quota exceeded (HTTP 429)');
            console.error('[DIAGNOSTICS] Fix: Upgrade plan at https://serper.dev/billing');
        } else {
            console.error(`[DIAGNOSTICS] ❌ RESULT: Serper request failed — ${err.message}`);
            if (body) console.error(`[DIAGNOSTICS] Response: ${body}`);
        }

        console.log('[DIAGNOSTICS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return { ok: false, reason: 'api_error', status, message: err.message };
    }
};

module.exports = { checkGoogleAccess };
