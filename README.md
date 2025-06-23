# 🎥 Tube Search Stremio Add-on

A Stremio add-on that generates direct Google Search links for movies and series, specifically filtered for "long videos" and "video" results, making it easy to find and access content online.

---

## ✨ Features

* **Intelligent Search Links:** Automatically generates Google search queries based on movie titles or series (including season/episode numbers).
* **Video-Focused Results:** Links are pre-filtered for "long videos" and general video results on Google, helping you find playable content faster.
* **API-Powered Metadata:** Uses TMDb and OMDb to accurately identify content and construct precise search queries.
* **Mobile & AIOStreams Compatible:** Features a unique configuration URL structure that ensures compatibility with Stremio on Android and third-party clients like AIOStreams.

---

## 🛠️ How It Works

This add-on acts as a "search provider" within Stremio. When you select a movie or series:

1.  It uses the provided TMDb/OMDb API keys to fetch accurate title and year information.
2.  It constructs a tailored Google search query for that content, adding filters like "full movie" or "S01E01" and limiting results to videos.
3.  It then provides a `stremio://` link that, when clicked, will open a web browser or YouTube app directly to the Google search results page.

**Note on Configuration:** For broad compatibility, your TMDb and OMDb API keys are embedded directly into the add-on's installation URL path. This allows clients that strictly require URLs to end with `/manifest.json` (like Stremio Android and AIOStreams) to function correctly.

---

## 🚀 Installation

To install and use the Tube Search add-on, you will need API keys from TMDb and OMDb.

### Prerequisites (Get Your API Keys)

* **TMDb API Key:**
    1.  Go to [The Movie Database (TMDb) API Documentation](https://www.themoviedb.org/documentation/api).
    2.  You will need to create a free account and then generate an API key (usually an API Key (v3) is sufficient).
* **OMDb API Key:**
    1.  Go to [OMDb API Key Request](http://www.omdbapi.com/apikey.aspx).
    2.  Register for a free API key.

### Step-by-Step Installation

1.  **Open the Configuration Page:**
    * Navigate to your Hugging Face Space URL where the add-on is hosted (e.g., `https://your-huggingface-space-url.hf.space/configure`).

2.  **Enter Your API Keys:**
    * On the configuration page, enter your TMDb API Key and OMDb API Key into the respective fields.

3.  **Generate Install URL:**
    * Click the "Generate Install URL" button.

4.  **Install in Stremio:**
    * A link and URL will appear.
    * **Option A (Click Link):** If you have Stremio installed on your device, simply click the "Install Tube Search Add-on" link.
    * **Option B (Copy & Paste):** Copy the provided manifest URL (the one that looks like `https://your-huggingface-space-url.hf.space/tmdb=YOUR_TMDB_KEY%7Comdb=YOUR_OMDB_KEY/manifest.json`). Open your Stremio application, go to "Add-ons," click "My Add-ons," then scroll down and click "Install Add-on" (or "Configure" on some clients) and paste the URL.

**Important Note for Updates:**
If you are updating from a previous version of this add-on (especially if the installation URL structure has changed), it is highly recommended to **uninstall the old add-on first** from your Stremio client(s) before installing the new version with the updated URL.

---

## 📺 Usage

Once installed:

1.  Browse for any movie or series in Stremio.
2.  When you select a title and view its details, you will see a new stream option labeled something like "🔎 Google Search: 'Movie Title' (Long Videos)" or similar, depending on the content.
3.  Click this stream link to open the corresponding Google search results in your default web browser or YouTube app.

---

## 🤝 Contribution

Contributions, bug reports, and feature requests are welcome! Please feel free to open an issue or submit a pull request on the project's GitHub repository.

---

## 📄 License

This project is open-source and available under the [MIT License](https://opensource.org/licenses/MIT).
