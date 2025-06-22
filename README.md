# Tube Search Stremio Add-on

A Stremio add-on to search YouTube videos with advanced filters for duration and resolution.

**Important:** This add-on requires a **YouTube Data API Key** to function. You will be prompted to provide this key during the installation process in Stremio.

## Features

* Search YouTube videos by keywords.
* Filter search results by video duration (short, medium, long).
* Filter search results by video resolution (SD, HD, Full HD).
* Plays videos directly within the Stremio player.

## Installation & Configuration

1.  **Create a Hugging Face Space (if you haven't already):**
    * Go to [Hugging Face Spaces](https://huggingface.co/spaces).
    * Click "Create new Space".
    * Choose "Public" or "Private" (Public is needed if others are to use it easily).
    * Select "Docker" as the Space SDK. **(Correction: Hugging Face automatically detects Node.js. If given a choice, choose `Node` or `Docker` and ensure the `package.json`'s `start` script is honored. For simplicity, just selecting "Node" if available is best. If not, "Docker" is a safe fallback as it runs your `start` script)**.
    * Connect your GitHub repository to the Space.

2.  **Wait for Deployment:** Hugging Face will automatically build and deploy your add-on. This might take a few minutes. Check the "Logs" tab in your Space settings for progress.

3.  **Install in Stremio:**
    * Once your Space is deployed and running, copy its public URL (e.g., `https://your-username-tube-search.hf.space/`).
    * Open Stremio (Desktop App or Web version).
    * Go to the "Add-ons" section.
    * Click "My Add-ons" -> "Add your own".
    * Paste your Hugging Face Space URL into the "Add-on URL" field, followed by `/manifest.json`.
        * **Example URL:** `https://your-username-tube-search.hf.space/manifest.json`
    * Click "Install".

4.  **Provide YouTube Data API Key:**
    * Stremio will redirect you to the add-on's configuration page (e.g., `https://your-username-tube-search.hf.space/configure`).
    * Follow the on-screen instructions to obtain a YouTube Data API Key from the Google Cloud Console.
    * Enter your API key into the provided field and click "Save & Install".

5.  **Enjoy Tube Search!**
    * Navigate to the "Discover" section in Stremio.
    * Select "Tube Search" from the top-left content type dropdown (or the search bar context).
    * Use the search bar to find YouTube videos, and apply duration/resolution filters.

## Development

This add-on is developed using Node.js, Express, and the Stremio Add-on SDK.
The core logic for YouTube API interaction is modularized in `youtubeAddon.js`.

**Local Development (via Codespaces or local setup):**

1.  Clone the repository.
2.  `npm install`
3.  `npm start`
4.  Access the manifest at `http://localhost:80/manifest.json` and the configure page at `http://localhost:80/configure`.

---
