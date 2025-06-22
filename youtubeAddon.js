const axios = require('axios'); // For making HTTP requests to YouTube API

const YOUTUBE_EMBED_URL_PREFIX = 'https://www.youtube.com/watch?v=';
const YOUTUBE_STREAM_SERVER = 'https://www.youtube.com/watch?v=VIDEO_ID'; // A common way Stremio handles YouTube streams

/**
 * Maps Stremio's duration filter options to YouTube Data API's videoDuration values.
 * @param {string} stremioDuration
 * @returns {string|undefined} YouTube API videoDuration value or undefined if 'any'
 */
function mapDuration(stremioDuration) {
    switch (stremioDuration) {
        case 'short':
            return 'short'; // < 4 minutes
        case 'medium':
            return 'medium'; // 4 - 20 minutes
        case 'long':
            return 'long'; // > 20 minutes
        case 'any':
        default:
            return undefined; // No filter applied
    }
}

/**
 * Maps Stremio's resolution filter options to YouTube Data API's videoDefinition values.
 * @param {string} stremioResolution
 * @returns {string|undefined} YouTube API videoDefinition value or undefined if 'any'
 */
function mapResolution(stremioResolution) {
    switch (stremioResolution) {
        case 'sd':
            return 'standard'; // Standard definition
        case 'hd':
        case 'fullhd': // YouTube API treats HD and Full HD as 'high'
            return 'high'; // High definition
        case 'any':
        default:
            return undefined; // No filter applied
    }
}

/**
 * Defines the catalog and stream handlers for the Tube Search Stremio Add-on.
 * @param {object} builder - The Stremio AddonBuilder instance.
 */
function getTubeSearchHandlers(builder) {

    // Define the catalog handler for search requests
    builder.defineCatalogHandler(async (args) => {
        // Read the YouTube API key from args.config (provided by Stremio after user input)
        const { config } = args;
        const { youtubeApiKey } = config || {};

        console.log(`[Addon Log] Catalog handler invoked. Arguments received: ${JSON.stringify(args)}`); // Debugging log
        console.log(`[Addon Log] Extracted youtubeApiKey: ${youtubeApiKey ? 'Key available (masked)' : 'Key missing/undefined'}`); // Debugging log (don't log actual key)

        // Check if API key is provided
        if (!youtubeApiKey) {
            console.warn('YouTube API Key not provided by user in Stremio configuration.');
            // Stremio might show a more user-friendly error if this is returned as 'err'
            return Promise.resolve({ metas: [], err: 'YouTube API Key is missing. Please configure the add-on.' });
        }

        const { search } = args; // 'search' is now the primary arg for query
        
        // Apply filters from args.extra
        const durationFilter = mapDuration(args.extra && args.extra.duration);
        const resolutionFilter = mapResolution(args.extra && args.extra.resolution);

        const youtubeApiUrl = 'https://www.googleapis.com/youtube/v3/search';
        const params = {
            key: youtubeApiKey,
            part: 'snippet', // Request snippet for title, description, thumbnails
            q: search,
            type: 'video', // Only search for videos
            maxResults: 20 // Limit results to avoid excessive quota usage
        };

        // Add optional filters if they are defined
        if (durationFilter) {
            params.videoDuration = durationFilter;
        }
        if (resolutionFilter) {
            params.videoDefinition = resolutionFilter;
        }

        console.log(`[Addon Log] Attempting YouTube API call with params (key excluded): ${JSON.stringify({ ...params, key: youtubeApiKey ? '********' : undefined })}`); // Debugging log (mask key)
        try {
            const response = await axios.get(youtubeApiUrl, { params });
            console.log(`[Addon Log] YouTube API call successful. Items received: ${response.data.items ? response.data.items.length : 0}`); // Debugging log
            const items = response.data.items || [];

            const metas = items.map(item => ({
                id: `yt_${item.id.videoId}`, // Stremio ID prefix
                type: 'movie', // Consistent with manifest
                name: item.snippet.title,
                poster: item.snippet.thumbnails.high.url, // High-quality thumbnail
                description: item.snippet.description || 'No description available.',
                background: item.snippet.thumbnails.maxres ? item.snippet.thumbnails.maxres.url : item.snippet.thumbnails.high.url, // Use maxres if available
                releaseInfo: item.snippet.publishTime ? new Date(item.snippet.publishTime).getFullYear().toString() : undefined
            }));

            return Promise.resolve({ metas });

        } catch (error) {
            console.error('[Addon Log] Error fetching from YouTube API:', error.message); // Debugging log
            if (error.response && error.response.data && error.response.data.error) {
                console.error('[Addon Log] YouTube API Error Details:', error.response.data.error); // Debugging log
                // Return a user-friendly error if API key is invalid or quota is exceeded
                if (error.response.data.error.code === 403 || error.response.data.error.code === 400) {
                     return Promise.resolve({ metas: [], err: 'YouTube API Error: Please check your API key (invalid or quota exceeded).' });
                }
            }
            return Promise.resolve({ metas: [], err: 'Failed to search YouTube. Please try again later.' });
        }
    });

    // Define the stream handler
    builder.defineStreamHandler(async (args) => {
        const { id } = args;
        const videoId = id.replace('yt_', ''); // Remove our prefix

        if (!videoId) {
            return Promise.resolve({ streams: [] });
        }

        const streams = [{
            url: `${YOUTUBE_STREAM_SERVER}/${videoId}`,
            title: 'YouTube Stream',
            description: `Plays directly from YouTube.`
        }];

        return Promise.resolve({ streams });
    });
}

module.exports = { getTubeSearchHandlers };
