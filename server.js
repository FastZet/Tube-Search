const express = require('express');
const axios = require('axios'); // For making HTTP requests to TMDb and YouTube
const path = require('path');
const manifest = require('./manifest.json'); // Still need manifest for its base data

const app = express();

// --- Helper function for fetching TMDb and YouTube data ---
async function getStreamsForContent(type, id, config) {
    const { youtubeApiKey, tmdbApiKey, maxStreams, videoDuration, videoSort } = config;

    console.log('[Addon Log] Stream handler invoked with config:', {
        maxStreams,
        videoDuration,
        videoSort,
        youtubeApiKey: youtubeApiKey ? 'Provided' : 'Missing',
        tmdbApiKey: tmdbApiKey ? 'Provided' : 'Missing'
    });

    if (!youtubeApiKey || !tmdbApiKey) {
        console.error('[Addon Log] Missing YouTube or TMDb API key.');
        return { streams: [], error: 'API keys are required.' };
    }

    const IMDB_ID = id; // Stremio uses IMDb IDs (ttXXXXXXX)
    let queryTitle = '';
    let queryYear = '';

    try {
        // Step 1: Get TMDb ID from IMDb ID
        const tmdbFindUrl = `https://api.themoviedb.org/3/find/${IMDB_ID}?api_key=${tmdbApiKey}&external_source=imdb_id`;
        const tmdbFindResponse = await axios.get(tmdbFindUrl);

        let tmdbId = null;
        if (type === 'movie' && tmdbFindResponse.data.movie_results.length > 0) {
            tmdbId = tmdbFindResponse.data.movie_results[0].id;
            queryTitle = tmdbFindResponse.data.movie_results[0].title;
            queryYear = (new Date(tmdbFindResponse.data.movie_results[0].release_date)).getFullYear();
            console.log(`[Addon Log] Found movie TMDb ID: ${tmdbId}, Title: ${queryTitle}, Year: ${queryYear}`);
        } else if (type === 'series' && tmdbFindResponse.data.tv_results.length > 0) {
            tmdbId = tmdbFindResponse.data.tv_results[0].id;
            queryTitle = tmdbFindResponse.data.tv_results[0].name;
            queryYear = (new Date(tmdbFindResponse.data.tv_results[0].first_air_date)).getFullYear();
            console.log(`[Addon Log] Found series TMDb ID: ${tmdbId}, Title: ${queryTitle}, Year: ${queryYear}`);
        } else {
            console.log(`[Addon Log] No TMDb results found for IMDb ID: ${IMDB_ID}`);
            return { streams: [] };
        }

        if (!queryTitle) {
            console.log('[Addon Log] No title extracted from TMDb. Cannot search YouTube.');
            return { streams: [] };
        }

        // Step 2: Search YouTube with title and year
        const youtubeSearchQuery = `${queryTitle} ${queryYear || ''}`;
        const youtubeUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(youtubeSearchQuery)}&key=${youtubeApiKey}&type=video&maxResults=${maxStreams}&videoDuration=${videoDuration}&order=${videoSort}`;
        
        console.log(`[Addon Log] Searching YouTube for: "${youtubeSearchQuery}" with maxResults=${maxStreams}, videoDuration=${videoDuration}, order=${videoSort}`);
        const youtubeResponse = await axios.get(youtubeUrl);

        if (!youtubeResponse.data.items || youtubeResponse.data.items.length === 0) {
            console.log('[Addon Log] No YouTube results found.');
            return { streams: [] };
        }

        const streams = youtubeResponse.data.items.map(item => ({
            // Improved title for clarity
            title: `▶️ ${item.snippet.title} (Open on YouTube)`, 
            // Optional: Add more descriptive info
            // description: `Uploaded by: ${item.snippet.channelTitle}\nPublished: ${new Date(item.snippet.publishedAt).toLocaleDateString()}`,
            externalUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`, 
            ytId: item.id.videoId, 
            thumbnail: item.snippet.thumbnails.high.url,
            // Explicitly hint to Stremio to open externally
            behaviorHints: {
                externalUrl: true 
            }
        }));

        console.log(`[Addon Log] Found ${streams.length} YouTube streams.`);
        return { streams };

    } catch (error) {
        console.error(`[Addon Log] Error fetching data:`, error.message);
        if (error.response) {
            console.error(`[Addon Log] API Error Status: ${error.response.status}, Data:`, error.response.data);
            if (error.response.status === 403) {
                return { streams: [], error: 'YouTube API Key (403): Quota Exceeded or Permissions Issue.' };
            }
            if (error.response.status === 401) {
                return { streams: [], error: 'TMDb/YouTube API Key (401): Unauthorized. Check your API keys.' };
            }
            if (error.response.status === 404) {
                return { streams: [], error: 'TMDb (404): Content not found.' };
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
  const youtubeApiKey = req.query.youtubeApiKey || '';
  const tmdbApiKey = req.query.tmdbApiKey || '';
  const maxStreams = req.query.maxStreams || '5';
  const videoDuration = req.query.videoDuration || 'any';
  const videoSort = req.query.videoSort || 'relevance';

  // Attach configuration to the manifest (this is how Stremio sends it to streams)
  const configuredManifest = { ...manifest };
  // Create unique ID for Stremio caching based on config
  configuredManifest.id = configuredManifest.id + `_${youtubeApiKey.substring(0,5)}_${tmdbApiKey.substring(0,5)}_${maxStreams}_${videoDuration}_${videoSort}`; 
  configuredManifest.name = configuredManifest.name + ` (Configured)`;
  configuredManifest.config = {
    youtubeApiKey,
    tmdbApiKey,
    maxStreams: parseInt(maxStreams, 10),
    videoDuration,
    videoSort
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
    // Extract configuration from the request URL (these parameters come from the manifest URL)
    const { youtubeApiKey, tmdbApiKey, maxStreams, videoDuration, videoSort } = req.query;

    const config = {
        youtubeApiKey,
        tmdbApiKey,
        maxStreams: parseInt(maxStreams, 10) || 5, // Default to 5 if not valid
        videoDuration: videoDuration || 'any',
        videoSort: videoSort || 'relevance'
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
    console.log(`Manifest URL (example): http://localhost:${PORT}/manifest.json?youtubeApiKey=YOUR_YOUTUBE_KEY&tmdbApiKey=YOUR_TMDB_KEY`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
