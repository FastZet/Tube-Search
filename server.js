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
  console.log(`[Server Log] Received catalog request for Type: ${req.params.type}, ID: ${req.params.id}, Extra: ${req.params.extra}`); // Debugging log
  try {
    const args = {
      type: req.params.type,
      id: req.params.id,
      extra: req.params.extra ? JSON.parse(req.params.extra) : {},
    };
    console.log(`[Server Log] Parsed catalog arguments: ${JSON.stringify(args)}`); // Debugging log
    const result = await addonInterface.catalog.get(args);
    console.log(`[Server Log] Catalog handler returned result: ${JSON.stringify(result.metas ? result.metas.length + ' metas' : result)}`); // Debugging log
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
    console.log(`Manifest URL: http://localhost:${PORT}/manifest.json`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
