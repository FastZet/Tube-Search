const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const manifest = require('./manifest.json');

const app = express();

// Helper function to parse the combined config string
function parseConfigString(configString) {
    let tmdbApiKey = '';
    let omdbApiKey = '';
    if (configString) {
        try {
            const decodedConfigString = decodeURIComponent(configString);
            const params = decodedConfigString.split('|');
            params.forEach(param => {
                const parts = param.split('=');
                if (parts.length === 2) {
                    if (parts[0] === 'tmdb') tmdbApiKey = parts[1];
                    else if (parts[0] === 'omdb') omdbApiKey = parts[1];
                }
            });
        } catch (e) { console.error('[Addon Log] Error decoding config string:', e.message); }
    }
    return { tmdbApiKey, omdbApiKey };
}

// Helper function to parse duration strings (e.g., "1:22:36" or "22:36") into minutes
function parseDurationToMinutes(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') return null;
    const parts = durationStr.split(':').map(Number);
    let minutes = 0;
    if (parts.length === 3) { minutes = parts[0] * 60 + parts[1] + parts[2] / 60; }
    else if (parts.length === 2) { minutes = parts[0] + parts[1] / 60; }
    else { return null; }
    return isNaN(minutes) ? null : minutes;
}

// --- Main function for fetching metadata and streams ---
async function getStreamsForContent(type, id, config) {
    const { tmdbApiKey, omdbApiKey } = config;
    if (!tmdbApiKey) { return { streams: [], error: 'TMDb API key is required.' }; }

    let IMDB_ID = null, TMDB_ID = null, queryTitle = '', queryYear = '', seasonNum, episodeNum, episodeTitle = '';
    let apiRuntime = null;

    try {
        // --- (Metadata fetching logic - no changes needed here) ---
        let rawContentId = id;
        if (type === 'series') {
            const parts = id.split(':');
            rawContentId = parts[0];
            IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null;
            TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null);
            seasonNum = parts[1];
            episodeNum = parts[2];
        } else if (type === 'movie') {
            rawContentId = id;
            IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null;
            TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null);
        }
        if (TMDB_ID && isNaN(TMDB_ID) && TMDB_ID.includes(':')) { TMDB_ID = TMDB_ID.split(':')[1]; }
        else if (TMDB_ID && isNaN(TMDB_ID) && !TMDB_ID.startsWith('tt')) { TMDB_ID = null; }

        if (IMDB_ID) {
            try {
                const tmdbFindUrl = `https://api.themoviedb.org/3/find/${IMDB_ID}?api_key=${tmdbApiKey}&external_source=imdb_id`;
                const tmdbFindResponse = await axios.get(tmdbFindUrl);
                if (type === 'movie' && tmdbFindResponse.data.movie_results.length > 0) {
                    TMDB_ID = tmdbFindResponse.data.movie_results[0].id;
                    queryTitle = tmdbFindResponse.data.movie_results[0].title;
                    queryYear = (new Date(tmdbFindResponse.data.movie_results[0].release_date)).getFullYear();
                } else if (type === 'series' && tmdbFindResponse.data.tv_results.length > 0) {
                    TMDB_ID = tmdbFindResponse.data.tv_results[0].id;
                    queryTitle = tmdbFindResponse.data.tv_results[0].name;
                    queryYear = (new Date(tmdbFindResponse.data.tv_results[0].first_air_date)).getFullYear();
                }
            } catch (findError) { console.warn(`[Addon Log] TMDb Find error for IMDb ID ${IMDB_ID}: ${findError.message}.`); }
        }
        
        if (TMDB_ID && !queryTitle) {
            const directTmdbUrl = (type === 'movie') ? `https://api.themoviedb.org/3/movie/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids` : `https://api.themoviedb.org/3/tv/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
            try {
                const directTmdbResponse = await axios.get(directTmdbUrl);
                queryTitle = type === 'movie' ? directTmdbResponse.data.title : directTmdbResponse.data.name;
                queryYear = type === 'movie' ? (new Date(directTmdbResponse.data.release_date)).getFullYear() : (new Date(directTmdbResponse.data.first_air_date)).getFullYear();
                if (type === 'movie' && directTmdbResponse.data.runtime) { apiRuntime = directTmdbResponse.data.runtime; }
                if (!IMDB_ID && directTmdbResponse.data.external_ids && directTmdbResponse.data.external_ids.imdb_id) { IMDB_ID = directTmdbResponse.data.external_ids.imdb_id; }
            } catch (tmdbIdError) { console.warn(`[Addon Log] Direct TMDb lookup failed for TMDB ID ${TMDB_ID}: ${tmdbIdError.message}`); }
        }

        if (!queryTitle && IMDB_ID && omdbApiKey) {
            const omdbUrl = `http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&plot=short&r=json`;
            try {
                const omdbResponse = await axios.get(omdbUrl);
                if (omdbResponse.data.Response === 'True') {
                    queryTitle = omdbResponse.data.Title;
                    queryYear = omdbResponse.data.Year ? parseInt(omdbResponse.data.Year.substring(0,4)) : '';
                    if (omdbResponse.data.Runtime && omdbResponse.data.Runtime !== "N/A") { apiRuntime = parseInt(omdbResponse.data.Runtime); }
                }
            } catch (omdbError) { console.error(`[Addon Log] OMDb API error for IMDb ID ${IMDB_ID}: ${omdbError.message}`); }
        }
        
        if (queryTitle && !TMDB_ID) {
            try {
                const searchYear = queryYear ? queryYear.toString().substring(0, 4) : '';
                const searchUrl = `https://api.themoviedb.org/3/search/${type === 'movie' ? 'movie' : 'tv'}?api_key=${tmdbApiKey}&query=${encodeURIComponent(queryTitle)}&first_air_date_year=${searchYear}`;
                const searchResponse = await axios.get(searchUrl);
                if (searchResponse.data && searchResponse.data.results.length > 0) {
                    const bestMatch = searchResponse.data.results.find(r => (r.name || r.title) === queryTitle);
                    TMDB_ID = bestMatch ? bestMatch.id : searchResponse.data.results[0].id;
                }
            } catch (searchError) { console.warn(`[Addon Log] TMDb search fallback failed: ${searchError.message}`); }
        }
        
        if (!queryTitle) { throw new Error('Failed to retrieve title.'); }
        
        if (type === 'series' && TMDB_ID) {
            try {
                const epUrl = `https://api.themoviedb.org/3/tv/${TMDB_ID}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`;
                const episodeResponse = await axios.get(epUrl);
                episodeTitle = episodeResponse.data.name;
                if (episodeResponse.data.runtime) { apiRuntime = episodeResponse.data.runtime; }
            } catch (e) { /* Optional */ }
        }
        if (!episodeTitle && type === 'series' && IMDB_ID && omdbApiKey) {
            try {
                const omdbEpUrl = `http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&Season=${seasonNum}&Episode=${episodeNum}`;
                const omdbEpRes = await axios.get(omdbEpUrl);
                if (omdbEpRes.data && omdbEpRes.data.Response === 'True') { 
                    episodeTitle = omdbEpRes.data.Title;
                    if (omdbEpRes.data.Runtime && omdbEpRes.data.Runtime !== "N/A") { apiRuntime = parseInt(omdbEpRes.data.Runtime); }
                }
            } catch (e) { /* Optional */ }
        }
        
        if (apiRuntime) { console.log(`[Addon Log] Official runtime from API: ${apiRuntime} minutes.`); }

        // --- HYBRID SCRAPING LOGIC ---
        let googleSearchQuery;
        if (type === 'movie') { googleSearchQuery = `${queryTitle} ${queryYear || ''} full movie`; }
        else { const pS = seasonNum.toString().padStart(2, '0'); const pE = episodeNum.toString().padStart(2, '0'); googleSearchQuery = `${queryTitle} S${pS} E${pE} ${episodeTitle || ''}`.trim(); }

        const googleSearchLink = `https://www.google.com/search?q=${encodeURIComponent(googleSearchQuery)}&tbs=dur:l&tbm=vid`;
        let streams = [];
        let html = '';

        try {
            console.log(`[Addon Log] Scraping Google for: "${googleSearchQuery}"`);
            const response = await axios.get(googleSearchLink, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36' } });
            html = response.data;
            const $ = cheerio.load(html);
            let results = [];
            const seenUrls = new Set();
            
            // --- ATTEMPT A: Structured Scraping (High Quality) ---
            console.log('[Addon Log] Attempting primary scraping strategy (structured).');
            $('div.vt6azd, div.MjjYud').each((i, el) => {
                const linkEl = $(el).find('a');
                let url = linkEl.attr('href');
                if (url && url.startsWith('/url?q=')) { url = new URLSearchParams(url.split('?')[1]).get('q'); }
                if (url && url.startsWith('http') && !seenUrls.has(url)) {
                    const title = $(el).find('h3.LC20lb').text();
                    const source = $(el).find('cite').first().text().split(' › ')[0].replace('www.', '');
                    const duration = $(el).find('.c8rnLc span, .O1CVkc').text();
                    if(title) {
                        results.push({ title, url, source, duration });
                        seenUrls.add(url);
                    }
                }
            });

            // --- ATTEMPT B: Link-based Fallback Scraping (More Resilient) ---
            if (results.length === 0) {
                console.warn('[Addon Log] Primary strategy failed. Attempting fallback link search.');
                const videoDomains = ['youtube.com', 'dailymotion.com', 'vimeo.com', 'archive.org', 'vk.com']; // Whitelist for fallback
                $('a').each((i, el) => {
                    let url = $(el).attr('href');
                    if (url && url.startsWith('/url?q=')) { url = new URLSearchParams(url.split('?')[1]).get('q'); }
                    if (!url || !url.startsWith('http') || seenUrls.has(url)) return;
                    if (videoDomains.some(domain => url.includes(domain))) {
                        let title = ($(el).find('h3').text() || $(el).text()).trim();
                        if (title) {
                            results.push({ title, url, source: new URL(url).hostname.replace('www.', ''), duration: '' });
                            seenUrls.add(url);
                        }
                    }
                });
            }

            // --- Filtering and Processing ---
            if (apiRuntime > 0) {
                const tolerance = type === 'movie' ? 20 : 3;
                const originalCount = results.length;
                results = results.filter(res => {
                    const scrapedMinutes = parseDurationToMinutes(res.duration);
                    if (scrapedMinutes === null) return true; // Keep if we can't parse duration
                    return Math.abs(scrapedMinutes - apiRuntime) <= tolerance;
                });
                console.log(`[Addon Log] Filtered by duration: ${originalCount} -> ${results.length} results.`);
            }

            if (results.length === 0) { throw new Error('No valid video results found after all scraping attempts and filtering.'); }
            
            results.slice(0, 5).forEach(res => {
                streams.push({
                    title: `[${res.source || 'Stream'}] ${res.title}\n${res.duration ? `Duration: ${res.duration}` : ''}`,
                    externalUrl: res.url,
                    behaviorHints: { externalUrl: true }
                });
            });

        } catch (error) {
            console.error(`[Addon Log] FINAL FALLBACK: ${error.message}. Reverting to simple search link.`);
            if (html) { console.error('[Addon Log] HTML of failed page received. Check for CAPTCHA or layout changes.'); }
            streams.push({ title: `[Scraping Failed] 🔍 Google Search`, externalUrl: googleSearchLink, behaviorHints: { externalUrl: true } });
        }

        if (streams.length > 0) {
            streams.push({ title: `🔍 See all results on Google...`, externalUrl: googleSearchLink, behaviorHints: { externalUrl: true } });
        }
        
        return { streams };

    } catch (error) {
        console.error(`[Addon Log] General error in getStreamsForContent:`, error.message);
        return { streams: [], error: 'Failed to retrieve streams due to an internal error.' };
    }
}


// --- (Server routes - no changes needed here) ---
app.get('/:configString/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  const { tmdbApiKey, omdbApiKey } = parseConfigString(req.params.configString);
  const configuredManifest = { ...manifest };
  configuredManifest.id = configuredManifest.id + `_${tmdbApiKey.substring(0,5)}_${omdbApiKey.substring(0,5)}`; 
  configuredManifest.name = `Tube Search`; 
  configuredManifest.config = { tmdbApiKey, omdbApiKey };
  res.json(configuredManifest);
});
app.get('/:configString/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  const { tmdbApiKey, omdbApiKey } = parseConfigString(req.params.configString);
  const { type, id } = req.params;
  try {
    const config = { tmdbApiKey, omdbApiKey };
    const result = await getStreamsForContent(type, id, config); 
    res.json(result);
  } catch (error) {
    console.error('[Server Log] Stream handler error:', error);
    res.status(500).json({ err: 'Internal server error processing stream request.' });
  }
});
app.get('/', (req, res) => { res.redirect('/configure'); });
app.get('/:configString?/configure', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => { res.status(404).send('Not Found'); });
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
    console.log(`Tube Search add-on running on port ${PORT}`);
    console.log(`Manifest URL (example): http://localhost:${PORT}/tmdb=YOUR_TMDB_KEY|omdb=YOUR_OMDB_KEY/manifest.json`);
});
