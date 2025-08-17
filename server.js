const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const manifest = require('./manifest.json');

const app = express();

// Helper function to parse the combined config string
function parseConfigString(configString) {
    let tmdbApiKey = '', omdbApiKey = '';
    if (configString) {
        try {
            const decodedConfigString = decodeURIComponent(configString);
            decodedConfigString.split('|').forEach(param => {
                const [key, value] = param.split('=');
                if (key === 'tmdb') tmdbApiKey = value;
                else if (key === 'omdb') omdbApiKey = value;
            });
        } catch (e) { console.error('[Log] Error decoding config string:', e.message); }
    }
    return { tmdbApiKey, omdbApiKey };
}

// Helper function to parse duration strings into minutes
function parseDurationToMinutes(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') return null;
    const parts = durationStr.split(':').map(Number);
    let minutes = 0;
    if (parts.length === 3) { minutes = (parts[0] * 60) + parts[1] + (parts[2] / 60); }
    else if (parts.length === 2) { minutes = parts[0] + (parts[1] / 60); }
    else { return null; }
    return isNaN(minutes) ? null : minutes;
}

// --- Main function for fetching metadata and streams ---
async function getStreamsForContent(type, id, config) {
    console.log(`\n[Log] ----- New Request Started: ${type} ${id} -----`);
    const { tmdbApiKey, omdbApiKey } = config;
    if (!tmdbApiKey) { return { streams: [], error: 'TMDb API key is required.' }; }

    let IMDB_ID = null, TMDB_ID = null, queryTitle = '', queryYear = '', seasonNum, episodeNum, episodeTitle = '';
    let apiRuntime = null;

    try {
        console.log('[Log Step 1/5] Starting metadata enrichment...');
        // --- (Metadata fetching logic - no changes needed here) ---
        let rawContentId = id;
        if (type === 'series') {
            const parts = id.split(':');
            rawContentId = parts[0];
            IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null;
            TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null);
            seasonNum = parts[1];
            episodeNum = parts[2];
        } else if (type === 'movie') { rawContentId = id; IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null; TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null); }
        if (TMDB_ID && isNaN(TMDB_ID) && TMDB_ID.includes(':')) { TMDB_ID = TMDB_ID.split(':')[1]; } else if (TMDB_ID && isNaN(TMDB_ID) && !TMDB_ID.startsWith('tt')) { TMDB_ID = null; }

        if (IMDB_ID) {
            try {
                const tmdbFindUrl = `https://api.themoviedb.org/3/find/${IMDB_ID}?api_key=${tmdbApiKey}&external_source=imdb_id`;
                const tmdbFindResponse = await axios.get(tmdbFindUrl);
                if (type === 'movie' && tmdbFindResponse.data.movie_results.length > 0) { TMDB_ID = tmdbFindResponse.data.movie_results[0].id; queryTitle = tmdbFindResponse.data.movie_results[0].title; queryYear = (new Date(tmdbFindResponse.data.movie_results[0].release_date)).getFullYear(); }
                else if (type === 'series' && tmdbFindResponse.data.tv_results.length > 0) { TMDB_ID = tmdbFindResponse.data.tv_results[0].id; queryTitle = tmdbFindResponse.data.tv_results[0].name; queryYear = (new Date(tmdbFindResponse.data.tv_results[0].first_air_date)).getFullYear(); }
            } catch (e) { console.warn(`[Log] TMDb Find error: ${e.message}.`); }
        }
        if (TMDB_ID && !queryTitle) {
            const directTmdbUrl = (type === 'movie') ? `https://api.themoviedb.org/3/movie/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids` : `https://api.themoviedb.org/3/tv/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
            try {
                const res = await axios.get(directTmdbUrl);
                queryTitle = type === 'movie' ? res.data.title : res.data.name;
                queryYear = type === 'movie' ? (new Date(res.data.release_date)).getFullYear() : (new Date(res.data.first_air_date)).getFullYear();
                if (type === 'movie' && res.data.runtime) { apiRuntime = res.data.runtime; }
                if (!IMDB_ID && res.data.external_ids?.imdb_id) { IMDB_ID = res.data.external_ids.imdb_id; }
            } catch (e) { console.warn(`[Log] Direct TMDb lookup failed: ${e.message}`); }
        }
        if (!queryTitle && IMDB_ID && omdbApiKey) {
            try {
                const omdbRes = await axios.get(`http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&plot=short&r=json`);
                if (omdbRes.data.Response === 'True') { queryTitle = omdbRes.data.Title; queryYear = omdbRes.data.Year ? parseInt(omdbRes.data.Year.substring(0,4)) : ''; if (omdbRes.data.Runtime !== "N/A") { apiRuntime = parseInt(omdbRes.data.Runtime); } }
            } catch (e) { console.error(`[Log] OMDb API error: ${e.message}`); }
        }
        if (queryTitle && !TMDB_ID) {
            try {
                const searchUrl = `https://api.themoviedb.org/3/search/${type === 'movie' ? 'movie' : 'tv'}?api_key=${tmdbApiKey}&query=${encodeURIComponent(queryTitle)}&first_air_date_year=${queryYear ? queryYear.toString().substring(0, 4) : ''}`;
                const searchResponse = await axios.get(searchUrl);
                if (searchResponse.data?.results.length > 0) { TMDB_ID = (searchResponse.data.results.find(r => (r.name || r.title) === queryTitle) || searchResponse.data.results[0]).id; }
            } catch (e) { console.warn(`[Log] TMDb search fallback failed: ${e.message}`); }
        }
        if (!queryTitle) { throw new Error('Failed to retrieve title.'); }
        if (type === 'series' && TMDB_ID) {
            try {
                const epRes = await axios.get(`https://api.themoviedb.org/3/tv/${TMDB_ID}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`);
                episodeTitle = epRes.data.name;
                if (epRes.data.runtime) { apiRuntime = epRes.data.runtime; }
            } catch (e) { /* Optional */ }
        }
        if (!episodeTitle && type === 'series' && IMDB_ID && omdbApiKey) {
            try {
                const omdbEpRes = await axios.get(`http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&Season=${seasonNum}&Episode=${episodeNum}`);
                if (omdbEpRes.data?.Response === 'True') { episodeTitle = omdbEpRes.data.Title; if (omdbEpRes.data.Runtime !== "N/A") { apiRuntime = parseInt(omdbEpRes.data.Runtime); } }
            } catch (e) { /* Optional */ }
        }
        console.log(`[Log] Metadata found: Title='${queryTitle}', Episode='${episodeTitle || 'N/A'}', Runtime=${apiRuntime || 'N/A'} mins.`);
        
        // --- HYBRID SCRAPING & SCORING LOGIC ---
        const searchQueries = [];
        const paddedSeason = type === 'series' ? seasonNum.toString().padStart(2, '0') : '';
        const paddedEpisode = type === 'series' ? episodeNum.toString().padStart(2, '0') : '';
        const seasonEpisodeString = type === 'series' ? `S${paddedSeason} E${paddedEpisode}` : '';

        if (type === 'movie') {
            searchQueries.push(`${queryTitle} ${queryYear || ''} full movie`);
        } else {
            searchQueries.push(`${queryTitle} ${seasonEpisodeString} ${episodeTitle || ''}`.trim());
            if (episodeTitle) { // Add a second query without the episode title
                searchQueries.push(`${queryTitle} ${seasonEpisodeString}`);
            }
        }

        let streams = [];
        let allResults = [];
        const seenUrls = new Set();
        
        console.log(`[Log Step 2/5] Starting Google scraping for ${searchQueries.length} queries.`);
        const scrapePromises = searchQueries.map(async (query) => {
            const googleSearchLink = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbs=dur:l&tbm=vid`;
            try {
                const response = await axios.get(googleSearchLink, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36
' } });
                return { query, html: response.data, success: true };
            } catch (error) {
                console.error(`[Log] Failed to scrape query "${query}": ${error.message}`);
                return { query, html: null, success: false };
            }
        });

        const scrapedPages = await Promise.all(scrapePromises);
        
        console.log('[Log Step 3/5] Parsing HTML and extracting links...');
        for (const page of scrapedPages) {
            if (!page.success) continue;
            const $ = cheerio.load(page.html);

            // Attempt A: Structured scrape
            let foundInAttemptA = false;
            $('div.vt6azd').each((i, el) => {
                const linkEl = $(el).find('a').first();
                let url = linkEl.attr('href');
                if (url && url.startsWith('/url?q=')) { url = new URLSearchParams(url.split('?')[1]).get('q'); }
                if (url && url.startsWith('http') && !seenUrls.has(url)) {
                    let title = $(el).find('h3.LC20lb').first().text();
                    const source = $(el).find('cite').first().text().split(' › ')[0].replace('www.', '');
                    const duration = $(el).find('.c8rnLc span, .O1CVkc').first().text();
                    if(title) { allResults.push({ title, url, source, duration }); seenUrls.add(url); foundInAttemptA = true; }
                }
            });

            // Attempt B: Fallback link scrape if A fails for this page
            if (!foundInAttemptA) {
                $('a').each((i, el) => {
                    let url = $(el).attr('href');
                    if (url && url.startsWith('/url?q=')) { url = new URLSearchParams(url.split('?')[1]).get('q'); }
                    if (!url || !url.startsWith('http') || seenUrls.has(url)) return;
                    if (/(video|movie|film|watch)/i.test(url) || /(mp4|mkv|avi|mov)$/i.test(url)) {
                        let title = ($(el).find('h3').text() || $(el).text()).trim();
                        if (title) {
                            allResults.push({ title, url, source: new URL(url).hostname.replace('www.', ''), duration: '' });
                            seenUrls.add(url);
                        }
                    }
                });
            }
        }
        console.log(`[Log] Found ${allResults.length} initial unique results from all queries.`);

        console.log('[Log Step 4/5] Scoring and sorting results...');
        const videoDomains = ['youtube.com', 'dailymotion.com', 'vimeo.com', 'archive.org', 'facebook.com', 'ok.ru']; // Whitelist for prioritization

        const calculateScore = (result) => {
            let score = 0;
            const lowerTitle = result.title.toLowerCase();

            // Duration scoring (weight: 3)
            if (apiRuntime > 0) {
                const scrapedMinutes = parseDurationToMinutes(result.duration);
                if (scrapedMinutes) {
                    const tolerance = type === 'movie' ? 20 : 3;
                    const diff = Math.abs(scrapedMinutes - apiRuntime);
                    if (diff <= tolerance) {
                        score += 3 * (1 - (diff / tolerance)); // Score is higher the closer it is
                    } else {
                        score -= 5; // Heavily penalize if outside tolerance
                    }
                }
            }
            
            // Title scoring (weight: 2)
            if (lowerTitle.includes(queryTitle.toLowerCase())) score += 2;
            if (type === 'series' && lowerTitle.includes(seasonEpisodeString.replace(' ', '').toLowerCase())) score += 2; // S01E01 match

            // Whitelist scoring (weight: 1)
            if (videoDomains.some(domain => result.url.includes(domain))) score += 1;

            return score;
        };

        const scoredResults = allResults.map(res => ({ ...res, score: calculateScore(res) }));
        scoredResults.sort((a, b) => b.score - a.score); // Sort descending by score
        
        console.log(`[Log] Top scored results: ${scoredResults.slice(0, 5).map(r => `(${r.score.toFixed(2)}) ${r.title}`).join(', ')}`);

        // Final processing
        if (scoredResults.length > 0) {
             const finalResults = scoredResults.slice(0, 2); // Limit to top 2
             console.log(`[Log Step 5/5] Success. Returning ${finalResults.length} best streams.`);
             finalResults.forEach(res => {
                let cleanTitle = res.title.replace(/ - video Dailymotion/i, '').replace(/\| YouTube/i, '').replace(/- YouTube/i, '').replace(/\| Facebook/i, '').trim().replace(/[\s\-,|]+$/, '');
                streams.push({
                    title: `[${res.source || 'Stream'}] ${cleanTitle}\n${res.duration ? `Duration: ${res.duration}` : ''}`,
                    externalUrl: res.url,
                    behaviorHints: { externalUrl: true }
                });
            });
        } else {
            console.warn('[Log Step 5/5] Failure. No valid results found after all steps.');
            throw new Error('No valid video results found after all scraping attempts and filtering.');
        }

        streams.push({ title: `🔍 See all results on Google...`, externalUrl: `https://www.google.com/search?q=${encodeURIComponent(searchQueries[0])}&tbs=dur:l&tbm=vid`, behaviorHints: { externalUrl: true } });
        return { streams };

    } catch (error) {
        console.error(`[Log] FINAL FALLBACK: ${error.message}. Reverting to simple search link.`);
        const fallbackQuery = type === 'movie' ? `${queryTitle} ${queryYear || ''} full movie` : `${queryTitle} ${seasonNum ? 'S'+seasonNum.padStart(2, '0') : ''}${episodeNum ? 'E'+episodeNum.padStart(2, '0') : ''}`;
        const googleSearchLink = `https://www.google.com/search?q=${encodeURIComponent(fallbackQuery)}&tbs=dur:l&tbm=vid`;
        return { streams: [{ title: `[Scraping Failed] 🔍 Google Search`, externalUrl: googleSearchLink, behaviorHints: { externalUrl: true } }] };
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
