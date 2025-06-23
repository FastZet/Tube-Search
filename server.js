const express = require('express');
const axios = require('axios');
const path = require('path');
const manifest = require('./manifest.json');

const app = express();

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
        // Don't return error here, proceed with TMDb only
    }

    let IMDB_ID = null;
    let TMDB_ID = null;
    let queryTitle = '';
    let queryYear = '';

    // Series specific parsing (season/episode numbers)
    let seasonNum, episodeNum;
    if (type === 'series') {
        const parts = id.split(':');
        IMDB_ID = parts[0].startsWith('tt') ? parts[0] : null;
        TMDB_ID = (parts[0] && !IMDB_ID) ? parts[0] : null;
        seasonNum = parts[1];
        episodeNum = parts[2];
        console.log(`[Addon Log] Parsed Series ID: IMDB=${IMDB_ID}, TMDB=${TMDB_ID}, S:${seasonNum}, E:${episodeNum}`);
    } else if (type === 'movie') {
        IMDB_ID = id.startsWith('tt') ? id : null;
        TMDB_ID = (id && !IMDB_ID) ? id.split(':')[0] : null; // Handle tmdb:id format, get only the ID part
        console.log(`[Addon Log] Parsed Movie ID: IMDB=${IMDB_ID}, TMDB=${TMDB_ID}`);
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
        const actualTmdbId = TMDB_ID && TMDB_ID.includes(':') ? TMDB_ID.split(':')[1] : TMDB_ID;

        if (actualTmdbId && !queryTitle) {
            const directTmdbUrl = (type === 'movie') ?
                `https://api.themoviedb.org/3/movie/${actualTmdbId}?api_key=${tmdbApiKey}` :
                `https://api.themoviedb.org/3/tv/${actualTmdbId}?api_key=${tmdbApiKey}`;
            
            try {
                console.log(`[Addon Log] Trying direct TMDb lookup with TMDB ID: ${actualTmdbId}`);
                const directTmdbResponse = await axios.get(directTmdbUrl);
                if (type === 'movie') {
                    queryTitle = directTmdbResponse.data.title;
                    queryYear = (new Date(directTmdbResponse.data.release_date)).getFullYear();
                    // Also try to get IMDb ID from TMDb external_ids if not already available
                    if (!IMDB_ID && directTmdbResponse.data.external_ids && directTmdbResponse.data.external_ids.imdb_id) {
                        IMDB_ID = directTmdbResponse.data.external_ids.imdb_id;
                        console.log(`[Addon Log] Retrieved IMDb ID from TMDb external_ids: ${IMDB_ID}`);
                    }
                } else { // series
                    queryTitle = directTmdbResponse.data.name;
                    queryYear = (new Date(directTmdbResponse.data.first_air_date)).getFullYear();
                     // Also try to get IMDb ID from TMDb external_ids if not already available
                    if (!IMDB_ID && directTmdbResponse.data.external_ids && directTmdbResponse.data.external_ids.imdb_id) {
                        IMDB_ID = directTmdbResponse.data.external_ids.imdb_id;
                        console.log(`[Addon Log] Retrieved IMDb ID from TMDb external_ids: ${IMDB_ID}`);
                    }
                }
                console.log(`[Addon Log] Found ${type} via direct TMDb ID lookup: ${queryTitle}`);
            } catch (tmdbIdError) {
                console.warn(`[Addon Log] Direct TMDb lookup failed for TMDB ID ${actualTmdbId}: ${tmdbIdError.message}`);
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
                    queryYear = omdbResponse.data.Year ? parseInt(omdbResponse.data.Year.substring(0,4)) : ''; // OMDb Year can be "2001" or "2001-"
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

        // --- Step 3: Generate Google Search Stream Result ---
        let googleSearchQuery = `${queryTitle} ${queryYear || ''}`;
        if (type === 'movie') {
            googleSearchQuery += ' full movie';
        } else if (type === 'series' && seasonNum && episodeNum) {
            googleSearchQuery = `${queryTitle} S${seasonNum} E${episodeNum}`;
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

// Serve the manifest.json file directly
app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Extract query parameters from the request to manifest.json
  const tmdbApiKey = req.query.tmdbApiKey || '';
  const omdbApiKey = req.query.omdbApiKey || '';

  // Attach configuration to the manifest
  const configuredManifest = { ...manifest };
  // Update unique ID and name
  configuredManifest.id = configuredManifest.id + `_${tmdbApiKey.substring(0,5)}_${omdbApiKey.substring(0,5)}`; 
  configuredManifest.name = `Tube Search`; 
  configuredManifest.config = {
    tmdbApiKey,
    omdbApiKey
  };
  
  res.json(configuredManifest);
});

// Handle Stream requests
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  const { type, id } = req.params;
  console.log(`[Server Log] Received stream request for Type: ${type}, ID: ${id}`); 

  try {
    // Extract configuration from the request URL
    const { tmdbApiKey, omdbApiKey } = req.query;

    const config = {
        tmdbApiKey,
        omdbApiKey
    };
    
    console.log(`[Server Log] Parsed stream arguments: ${JSON.stringify({ type, id })} with config: ${JSON.stringify(config)}`); 
    
    // Call the helper function to get streams
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
app.get('/configure', (req, res) => {
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
    console.log(`Manifest URL (example): http://localhost:${PORT}/manifest.json?tmdbApiKey=YOUR_TMDB_KEY&omdbApiKey=YOUR_OMDB_KEY`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
