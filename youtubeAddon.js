const axios = require('axios'); // For making HTTP requests to YouTube API

// Base URL for YouTube video embeds (Stremio can play these directly)
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
        const { search, config } = args; // 'config' contains the user-provided API key
        const { youtubeApiKey } = config || {}; // Destructure the API key

        // Check if API key is provided
        if (!youtubeApiKey) {
            console.warn('YouTube API Key not provided by user. Cannot perform search.');
            return Promise.resolve({ metas: [] }); // Return empty results if no API key
        }

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

        try {
            console.log(`Searching YouTube for: "${search}" with filters: ${JSON.stringify({duration: durationFilter, resolution: resolutionFilter})}`);
            const response = await axios.get(youtubeApiUrl, { params });
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
            console.error('Error fetching from YouTube API:', error.message);
            // Provide more specific error info if it's a known API error
            if (error.response && error.response.data && error.response.data.error) {
                console.error('YouTube API Error Details:', error.response.data.error);
                // Depending on the error, you might want to return a different message
                // For instance, if quota exceeded or API key invalid.
            }
            return Promise.resolve({ metas: [] }); // Return empty array on error
        }
    });

    // Define the stream handler
    builder.defineStreamHandler(async (args) => {
        const { id } = args;
        const videoId = id.replace('yt_', ''); // Remove our prefix

        if (!videoId) {
            return Promise.resolve({ streams: [] });
        }

        // For YouTube videos, Stremio can often play them directly using specific URLs.
        // We provide a link that Stremio knows how to handle for YouTube streams.
        // The YOUTUBE_STREAM_SERVER URL is a common Stremio-internal mapping for YouTube streams.
        const streams = [{
            url: `${YOUTUBE_STREAM_SERVER}/${videoId}`,
            title: 'YouTube Stream',
            description: `Plays directly from YouTube.`
            // You could add further stream properties like 'ytId' if needed for specific players
            // but the URL itself is usually sufficient for basic playback.
        }];

        return Promise.resolve({ streams });
    });
}

module.exports = { getTubeSearchHandlers };
