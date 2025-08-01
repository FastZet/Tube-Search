const express = require('express');
const axios = require('axios');
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
                    if (parts[0] === 'tmdb') {
                        tmdbApiKey = parts[1];
                    } else if (parts[0] === 'omdb') {
                        omdbApiKey = parts[1];
                    }
                }
            });
        } catch (e) {
            console.error('[Addon Log] Error decoding or parsing config string:', e.message);
        }
    }
    return { tmdbApiKey, omdbApiKey };
}


// --- Helper function for fetching TMDb/OMDb data and Google Search ---
async function getStreamsForContent(type, id, config) {
    const { tmdbApiKey, omdbApiKey } = config;

    console.log('[Addon Log] Stream handler invoked with config:', {
        tmdbApiKey: tmdbApiKey ? 'Provided' : 'Missing',
        omdbApiKey: omdbApiKey ? 'Provided' : 'Missing'
    });

    if (!tmdbApiKey) {
        console.error('[Addon Log] Missing TMDb API key.');
        return { streams: [], error: 'TMDb API key is required.' };
    }
    if (!omdbApiKey) {
        console.warn('[Addon Log] Missing OMDb API key. OMDb fallback will not be used.');
    }

    let IMDB_ID = null;
    let TMDB_ID = null; // This will hold the numeric TMDb ID
    let queryTitle = '';
    let queryYear = '';

    // Series specific parsing (season/episode numbers)
    let rawContentId = id; // Store the original ID passed to the function

    let seasonNum, episodeNum;
    if (type === 'series') {
        const parts = id.split(':');
        rawContentId = parts[0]; // ttXXXXXXX or tmdb:XXXXXXX or XXXXXXX
        IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null;
        TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null);
        
        seasonNum = parts[1];
        episodeNum = parts[2];
        console.log(`[Addon Log] Parsed Series ID: Original=${id}, IMDB=${IMDB_ID}, TMDB=${TMDB_ID}, S:${seasonNum}, E:${episodeNum}`);
    } else if (type === 'movie') {
        rawContentId = id; // ttXXXXXXX or tmdb:XXXXXXX or XXXXXXX
        IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null;
        TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null);
        
        console.log(`[Addon Log] Parsed Movie ID: Original=${id}, IMDB=${IMDB_ID}, TMDB=${TMDB_ID}`);
    }
    
    // Ensure TMDB_ID is null if it's still 'tmdb' or not a number when it should be.
    if (TMDB_ID && isNaN(TMDB_ID) && TMDB_ID.includes(':')) {
        TMDB_ID = TMDB_ID.split(':')[1];
    } else if (TMDB_ID && isNaN(TMDB_ID) && !TMDB_ID.startsWith('tt')) {
        TMDB_ID = null;
    }


    try {
        // --- Step 1: Get TMDb details based on provided ID ---
        if (IMDB_ID) {
            // Option 1: Try TMDb /find endpoint with IMDb ID
            try {
                const tmdbFindUrl = `https://api.themoviedb.org/3/find/${IMDB_ID}?api_key=${tmdbApiKey}&external_source=imdb_id`;
                console.log(`[Addon Log] Trying TMDb find with IMDb ID: ${IMDB_ID}`);
                const tmdbFindResponse = await axios.get(tmdbFindUrl);

                if (type === 'movie' && tmdbFindResponse.data.movie_results.length > 0) {
                    TMDB_ID = tmdbFindResponse.data.movie_results[0].id;
                    queryTitle = tmdbFindResponse.data.movie_results[0].title;
                    queryYear = (new Date(tmdbFindResponse.data.movie_results[0].release_date)).getFullYear();
                    console.log(`[Addon Log] Found movie via TMDb Find: ${queryTitle}`);
                } else if (type === 'series' && tmdbFindResponse.data.tv_results.length > 0) {
                    TMDB_ID = tmdbFindResponse.data.tv_results[0].id;
                    queryTitle = tmdbFindResponse.data.tv_results[0].name;
                    queryYear = (new Date(tmdbFindResponse.data.tv_results[0].first_air_date)).getFullYear();
                    console.log(`[Addon Log] Found series via TMDb Find: ${queryTitle}`);
                } else {
                    console.log(`[Addon Log] TMDb Find did not return results for IMDb ID: ${IMDB_ID}. Trying direct lookup.`);
                }
            } catch (findError) {
                console.warn(`[Addon Log] TMDb Find error for IMDb ID ${IMDB_ID}: ${findError.message}. Trying direct lookup.`);
            }

            // Fallback for IMDb ID: Direct TMDb movie/tv endpoint if find failed or didn't provide enough.
            if (!queryTitle) {
                const directTmdbUrl = (type === 'movie') ?
                    `https://api.themoviedb.org/3/movie/${IMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids` :
                    `https://api.themoviedb.org/3/tv/${IMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
                
                try {
                    console.log(`[Addon Log] Trying direct TMDb lookup with IMDb ID: ${IMDB_ID}`);
                    const directTmdbResponse = await axios.get(directTmdbUrl);
                    if (type === 'movie') {
                        TMDB_ID = directTmdbResponse.data.id;
                        queryTitle = directTmdbResponse.data.title;
                        queryYear = (new Date(directTmdbResponse.data.release_date)).getFullYear();
                    } else { // series
                        TMDB_ID = directTmdbResponse.data.id;
                        queryTitle = directTmdbResponse.data.name;
                        queryYear = (new Date(directTmdbResponse.data.first_air_date)).getFullYear();
                    }
                    console.log(`[Addon Log] Found ${type} via direct TMDb lookup: ${queryTitle}`);
                } catch (directError) {
                    console.warn(`[Addon Log] Direct TMDb lookup failed for IMDb ID ${IMDB_ID}: ${directError.message}`);
                }
            }
        } 
        
        // If we still don't have a title, but we have a TMDB_ID (e.g., from a TMDB catalog addon)
        if (TMDB_ID && !queryTitle) {
            const directTmdbUrl = (type === 'movie') ?
                `https://api.themoviedb.org/3/movie/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids` :
                `https://api.themoviedb.org/3/tv/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
            
            try {
                console.log(`[Addon Log] Trying direct TMDb lookup with TMDB ID: ${TMDB_ID}`);
                const directTmdbResponse = await axios.get(directTmdbUrl);
                if (type === 'movie') {
                    queryTitle = directTmdbResponse.data.title;
                    queryYear = (new Date(directTmdbResponse.data.release_date)).getFullYear();
                    if (!IMDB_ID && directTmdbResponse.data.external_ids && directTmdbResponse.data.external_ids.imdb_id) {
                        IMDB_ID = directTmdbResponse.data.external_ids.imdb_id;
                        console.log(`[Addon Log] Retrieved IMDb ID from TMDb external_ids: ${IMDB_ID}`);
                    }
                } else { // series
                    queryTitle = directTmdbResponse.data.name;
                    queryYear = (new Date(directTmdbResponse.data.first_air_date)).getFullYear();
                    if (!IMDB_ID && directTmdbResponse.data.external_ids && directTmdbResponse.data.external_ids.imdb_id) {
                        IMDB_ID = directTmdbResponse.data.external_ids.imdb_id;
                        console.log(`[Addon Log] Retrieved IMDb ID from TMDb external_ids: ${IMDB_ID}`);
                    }
                }
                console.log(`[Addon Log] Found ${type} via direct TMDb ID lookup: ${queryTitle}`);
            } catch (tmdbIdError) {
                console.warn(`[Addon Log] Direct TMDb lookup failed for TMDB ID ${TMDB_ID}: ${tmdbIdError.message}`);
            }
        }

        // --- Fallback 2: OMDb API if TMDb failed and we have an IMDb ID ---
        if (!queryTitle && IMDB_ID && omdbApiKey) {
            const omdbUrl = `http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&plot=short&r=json`;
            try {
                console.log(`[Addon Log] TMDb lookup failed. Trying OMDb for IMDb ID: ${IMDB_ID}`);
                const omdbResponse = await axios.get(omdbUrl);
                if (omdbResponse.data.Response === 'True') {
                    queryTitle = omdbResponse.data.Title;
                    queryYear = omdbResponse.data.Year ? parseInt(omdbResponse.data.Year.substring(0,4)) : '';
                    console.log(`[Addon Log] Found content via OMDb: ${queryTitle}`);
                } else {
                    console.warn(`[Addon Log] OMDb did not return results for IMDb ID ${IMDB_ID}: ${omdbResponse.data.Error}`);
                }
            } catch (omdbError) {
                console.error(`[Addon Log] OMDb API error for IMDb ID ${IMDB_ID}: ${omdbError.message}`);
            }
        }


        if (!queryTitle) {
            console.log('[Addon Log] Failed to retrieve title from TMDb or OMDb using any method. Cannot generate search link.');
            return { streams: [] };
        }

        // --- Fetch episode name for series ---
        let episodeTitle = '';
        if (type === 'series' && TMDB_ID && seasonNum && episodeNum) {
            try {
                const episodeUrl = `https://api.themoviedb.org/3/tv/${TMDB_ID}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`;
                console.log(`[Addon Log] Fetching episode details: ${episodeUrl}`);
                const episodeResponse = await axios.get(episodeUrl);
                if (episodeResponse.data && episodeResponse.data.name) {
                    episodeTitle = episodeResponse.data.name;
                    console.log(`[Addon Log] Found episode name: "${episodeTitle}"`);
                }
            } catch (e) {
                console.warn(`[Addon Log] Could not fetch episode name. Search will proceed without it. Error: ${e.message}`);
            }
        }

        // --- Step 3: Generate Google Search Stream Result ---
        let googleSearchQuery = `${queryTitle} ${queryYear || ''}`;
        if (type === 'movie') {
            googleSearchQuery += ' full movie';
        } else if (type === 'series' && seasonNum && episodeNum) {
            const paddedSeason = seasonNum.toString().padStart(2, '0');
            const paddedEpisode = episodeNum.toString().padStart(2, '0');
            googleSearchQuery = `${queryTitle} S${paddedSeason} E${paddedEpisode} ${episodeTitle || ''}`.trim();
        }
        
        const streams = [];

        const googleSearchBaseUrl = "https://www.google.com/search?";
        const googleSearchLink = `${googleSearchBaseUrl}q=${encodeURIComponent(googleSearchQuery)}&tbs=dur:l&tbm=vid`;

        streams.unshift({ 
            title: `🔎 Google Search: "${googleSearchQuery}" (Long Videos)`,
            externalUrl: googleSearchLink, 
            behaviorHints: {
                externalUrl: true 
            }
        });
        console.log('[Addon Log] Added Google Search stream result.');

        return { streams };

    } catch (error) {
        console.error(`[Addon Log] General error in getStreamsForContent:`, error.message);
        if (error.response) {
            console.error(`[Addon Log] API Error Status: ${error.response.status}, Data:`, error.response.data);
            if (error.response.status === 403) {
                return { streams: [], error: 'API Key (403): Quota Exceeded or Permissions Issue. Check TMDb/OMDb keys.' };
            }
            if (error.response.status === 401) {
                return { streams: [], error: 'API Key (401): Unauthorized. Check your TMDb/OMDb keys.' };
            }
            if (error.response.status === 404) {
                return { streams: [], error: 'Content not found on TMDb/OMDb.' };
            }
        }
        return { streams: [], error: 'Failed to retrieve streams due to an internal error.' };
    }
}


// --- Stremio Add-on API Routes ---

// NEW: Manifest route with config string as path parameter
app.get('/:configString/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Parse API keys from the single config string
  const { tmdbApiKey, omdbApiKey } = parseConfigString(req.params.configString);

  const configuredManifest = { ...manifest };
  // Update unique ID and name using parts of the keys
  configuredManifest.id = configuredManifest.id + `_${tmdbApiKey.substring(0,5)}_${omdbApiKey.substring(0,5)}`; 
  configuredManifest.name = `Tube Search`; 
  configuredManifest.config = {
    tmdbApiKey,
    omdbApiKey
  };
  
  res.json(configuredManifest);
});

// NEW: Stream route with config string as path parameter
app.get('/:configString/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  // Parse API keys from the single config string
  const { tmdbApiKey, omdbApiKey } = parseConfigString(req.params.configString);

  const { type, id } = req.params; // type and id are still separate path params
  console.log(`[Server Log] Received stream request for Type: ${type}, ID: ${id}`); 

  try {
    const config = {
        tmdbApiKey,
        omdbApiKey
    };
    
    console.log(`[Server Log] Parsed stream arguments: ${JSON.stringify({ type, id })} with config: ${JSON.stringify(config)}`); 
    
    const result = await getStreamsForContent(type, id, config); 
    
    console.log(`[Server Log] Stream handler returned result: ${result.streams ? result.streams.length + ' streams' : result.error}`); 
    res.json(result);

  } catch (error) {
    console.error('[Server Log] Stream handler error:', error);
    res.status(500).json({ err: 'Internal server error processing stream request.' });
  }
});

// --- Custom Configuration Page Route ---

// Redirect root path to /configure
app.get('/', (req, res) => {
    res.redirect('/configure');
});

// Explicitly serve configure.html for the /configure path
// This route now also accommodates the config string for pre-filling the form.
app.get('/:configString?/configure', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});


// Serve other static assets from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));


// Fallback for any other request not handled by specific routes
app.get('*', (req, res) => {
    res.status(404).send('Not Found');
});


// Start the HTTP server
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
    console.log(`Tube Search add-on running on port ${PORT}`);
    // Updated example URL to reflect combined config string
    console.log(`Manifest URL (example): http://localhost:${PORT}/tmdb=YOUR_TMDB_KEY|omdb=YOUR_OMDB_KEY/manifest.json`);
    console.log(`Configure URL: http://localhost:${PORT}/configure (or directly with keys: /tmdb=YOUR_TMDB_KEY|omdb=YOUR_OMDB_KEY/configure)`);
});
