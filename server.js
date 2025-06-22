const express = require('express');
const { addonBuilder } = require('stremio-addon-sdk'); // Removed serveHTTP
const path = require('path');
const manifest = require('./manifest.json'); // Import your manifest

// Import the modular YouTube add-on logic
const { getTubeSearchHandlers } = require('./youtubeAddon');

// Initialize the AddonBuilder with your manifest
const builder = new addonBuilder(manifest);

// Apply the handlers for Youtube from our modular file
getTubeSearchHandlers(builder);

// Get the actual interface (handlers) from the builder
const addonInterface = builder.getInterface();

// Create an Express app
const app = express();

// --- Stremio Add-on API Routes ---

// Serve the manifest.json file directly
app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Crucial for Stremio to access
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.json(manifest);
});

// Handle Catalog requests
// Stremio will request /catalog/:type/:id/:extra?
app.get('/catalog/:type/:id/:extra?', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  try {
    const args = {
      type: req.params.type,
      id: req.params.id,
      extra: req.params.extra ? JSON.parse(req.params.extra) : {},
      // No config needed here as API key is now via env var
    };
    const result = await addonInterface.catalog.get(args);
    res.json(result);
  } catch (error) {
    console.error('Catalog handler error:', error);
    res.status(500).json({ err: 'Internal server error processing catalog request.' });
  }
});

// Handle Stream requests
// Stremio will request /stream/:type/:id.json
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  try {
    const args = {
      type: req.params.type,
      id: req.params.id,
    };
    const result = await addonInterface.stream.get(args);
    res.json(result);
  } catch (error) {
    console.error('Stream handler error:', error);
    res.status(500).json({ err: 'Internal server error processing stream request.' });
  }
});

// --- Custom Configuration Page Route ---

// Serve the static configure page
// We will create a 'public' directory and put 'configure.html' inside it
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for any other request not handled by specific routes
app.get('*', (req, res) => {
    // Check if the request path starts with our public directory content,
    // otherwise redirect to configure if it's a root or unknown request.
    // This prevents redirect loops if Stremio tries to fetch other internal resources.
    if (!req.path.startsWith('/public/') && req.path !== '/manifest.json' && !req.path.startsWith('/catalog/') && !req.path.startsWith('/stream/')) {
        return res.redirect('/configure');
    }
    res.status(404).send('Not Found'); // For other unhandled static/resource requests
});


// Start the HTTP server
const PORT = process.env.PORT || 7860; // Hugging Face Spaces typically uses port 7860
app.listen(PORT, () => {
    console.log(`Tube Search add-on running on port ${PORT}`);
    console.log(`Manifest URL: http://localhost:${PORT}/manifest.json`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
