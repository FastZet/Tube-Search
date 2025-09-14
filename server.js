// server.js

const express = require('express');
const path = require('path');
const manifest = require('./manifest.json');
const config = require('./src/config');
const streamHandler = require('./src/stream-handler');

const app = express();

// --- Middleware for CORS ---
app.use((req, res, next) => {
    // Using configured origins for better security in production
    res.setHeader('Access-Control-Allow-Origin', config.server.corsOrigins.join(', '));
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

/**
 * Helper function to parse the combined config string from the URL.
 * This is a web-layer responsibility.
 * @param {string} configString - The URL-encoded config string.
 * @returns {{tmdbApiKey: string, omdbApiKey: string}}
 */
const parseConfigString = (configString) => {
    const apiKeys = { tmdbApiKey: '', omdbApiKey: '' };
    if (configString) {
        try {
            const decoded = decodeURIComponent(configString);
            decoded.split('|').forEach(param => {
                const [key, value] = param.split('=');
                if (key === 'tmdb') apiKeys.tmdbApiKey = value;
                else if (key === 'omdb') apiKeys.omdbApiKey = value;
            });
        } catch (e) {
            console.error('[SERVER] Error decoding config string:', e.message);
        }
    }
    return apiKeys;
};

// --- Route Definitions ---

// Manifest route: Provides the addon configuration to Stremio
app.get('/:configString/manifest.json', (req, res) => {
    const { configString } = req.params;
    const apiKeys = parseConfigString(configString);

    if (!apiKeys.tmdbApiKey) {
        return res.status(400).json({ err: 'TMDb API key is missing from the configuration URL.' });
    }

    // Create a dynamic manifest ID based on the user's keys to ensure uniqueness
    const dynamicId = `${manifest.id}_${apiKeys.tmdbApiKey.substring(0, 5)}_${apiKeys.omdbApiKey.substring(0, 5) || 'na'}`;
    const configuredManifest = { ...manifest, id: dynamicId, name: 'Tube Search' };
    
    res.json(configuredManifest);
});

// Stream route: The main endpoint for finding content
app.get('/:configString/stream/:type/:id.json', async (req, res) => {
    try {
        const { configString, type, id } = req.params;
        const apiKeys = parseConfigString(configString);
        
        // Delegate all business logic to the stream handler
        const result = await streamHandler.getStreams(type, id, apiKeys);
        
        res.json(result);
    } catch (error) {
        console.error(`[SERVER] Unhandled error in stream handler: ${error.message}`);
        res.status(500).json({ err: 'An internal server error occurred.' });
    }
});

// Configuration UI routes (explicit, no optional token)
app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.get('/:configString/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

// Liveness/health route for Docker healthcheck
app.get('/health', (req, res) => {
    res.json({ ok: true });
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// 404 handler for any unhandled routes
app.get('*', (req, res) => {
    res.status(404).send('Not Found');
});

// --- Server Initialization ---
const PORT = config.server.port;
app.listen(PORT, () => {
    console.log(`[SERVER] Tube Search add-on running on port ${PORT}`);
    console.log(`[SERVER] To configure, visit: http://localhost:${PORT}/configure`);
});
