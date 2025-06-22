const express = require('express');
const { addonBuilder } = require('stremio-addon-sdk');
const path = require('path');
const manifest = require('./manifest.json');

const { getTubeSearchHandlers } = require('./youtubeAddon');

const builder = new addonBuilder(manifest);
getTubeSearchHandlers(builder);
const addonInterface = builder.getInterface();

const app = express();

// --- Stremio Add-on API Routes ---

// Serve the manifest.json file directly
app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.json(manifest);
});

// Handle Catalog requests
app.get('/catalog/:type/:id/:extra?', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  try {
    const args = {
      type: req.params.type,
      id: req.params.id,
      extra: req.params.extra ? JSON.parse(req.params.extra) : {},
    };
    const result = await addonInterface.catalog.get(args);
    res.json(result);
  } catch (error) {
    console.error('Catalog handler error:', error);
    res.status(500).json({ err: 'Internal server error processing catalog request.' });
  }
});

// Handle Stream requests
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

// Explicitly serve configure.html for the /configure path
app.get('/configure', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Needed if configure page is called from Stremio
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

// Serve other static assets from the 'public' directory
// This should be placed after specific routes like /configure
app.use(express.static(path.join(__dirname, 'public')));


// Fallback for any other request not handled by specific routes
// If a request falls through all specific routes and static files, it's a 404
app.get('*', (req, res) => {
    res.status(404).send('Not Found');
});


// Start the HTTP server
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
    console.log(`Tube Search add-on running on port ${PORT}`);
    console.log(`Manifest URL: http://localhost:${PORT}/manifest.json`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
