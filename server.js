const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const path = require('path');
const manifest = require('./manifest.json'); // Import your manifest

// Import the modular YouTube add-on logic
// We will create this file next: youtubeAddon.js
const { getTubeSearchHandlers } = require('./youtubeAddon');

// Initialize the AddonBuilder with your manifest
const builder = new addonBuilder(manifest);

// Get the handlers for Youtube from our modular file
// The manifest's "extra" fields (search, duration, resolution)
// and the "config" object (for API key) will be passed to these handlers.
getTubeSearchHandlers(builder);

// Create an Express app
const app = express();

// Serve the Stremio add-on API
// This middleware converts Stremio requests into calls to your handlers
app.use('/stremio', serveHTTP(builder.getInterface()));

// Serve the manifest.json file
app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Crucial for Stremio to access
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.json(manifest);
});

// Serve the static configure page
// We will create a 'public' directory and put 'configure.html' inside it
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for any other request not handled
app.get('*', (req, res) => {
    res.redirect('/configure'); // Redirect all other requests to the configure page
});


// Start the HTTP server
const PORT = process.env.PORT || 80; // Hugging Face Spaces often uses port 80 or 8080
app.listen(PORT, () => {
    console.log(`Tube Search add-on running on port ${PORT}`);
    console.log(`Manifest URL: http://localhost:${PORT}/manifest.json`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
