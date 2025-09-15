# Tube Search — Stremio Add-on 🚀

A self-hosted Stremio add-on that finds playable links by leveraging TMDb/OMDb for metadata and searching multiple video platforms. It builds context-aware queries, scrapes Google for results, ranks them with an intelligent scoring algorithm, and presents safe, external links inside Stremio.

This addon is designed for security and robustness, using server-side environment variables to protect your API keys and a hardened error-handling pipeline.

---

## ✨ Features

*   **Secure Configuration:** API keys are managed on the server via environment variables, never exposed in client-facing URLs.
*   **Accurate Metadata:** Uses TMDb and OMDb APIs for reliable movie and series metadata.
*   **Intelligent Scoring:** Ranks results using a flexible algorithm that considers:
    *   **Google's Own Ranking:** Gives a bonus to the top results from Google.
    *   **Word-based Title Matching:** Smartly compares titles by word overlap.
    *   **Duration Matching:** Prioritizes videos with a runtime close to the official one.
*   **Multi-source Discovery:** Scrapes Google's video search, which indexes YouTube, Dailymotion, Vimeo, Archive.org, and more.
*   **Resilient Fallbacks:** If no high-scoring results are found, the add-on provides direct Google search links so you are never left with a dead end.
*   **Easy Install UI:** A simple `/configure` page generates the exact Stremio install URL based on your addon password.
*   **Advanced Logging:** Built-in support for detailed request and HTTP debugging logs for easy troubleshooting.

---

## 🧩 How it Works

1.  **Request:** Stremio requests streams from the addon at `/:password/stream/:type/:id`.
2.  **Authentication:** The server validates the `:password` from the URL against the `ADDON_PASSWORD` environment variable.
3.  **Fetch Metadata:** The **API Service** fetches metadata (title, year, runtime) from TMDb/OMDb using the secure server-side API keys.
4.  **Enrich Data (Series):** For TV shows, the **Scraper Service** scrapes IMDb for the specific episode title to improve search accuracy.
5.  **Scrape Google:** The **Scraper Service** builds precise search queries and scrapes Google's video search for potential streams.
6.  **Score and Rank:** The **Scoring Service** calculates a confidence score for each result based on title match, duration, and other factors.
7.  **Respond:** The handler selects the top two highest-scoring results, formats them for Stremio, and always includes fallback Google search links.
8.  **Playback:** The user clicks a link in Stremio, which opens externally in a browser or native app.

---

## 🛠️ Deployment & Installation

### Step 1: Deploy the Add-on

Deploy the addon using Docker or another Node.js hosting method. You **must** configure the following environment variables.

#### **Environment Variables**

| Variable | Required | Description | Example |
| :--- | :--- | :--- | :--- |
| `PORT` | Optional | The port the addon server will run on. | `7810` |
| `ADDON_PASSWORD` | **Yes** | A secret password you create. This protects your addon and is used in the installation URL. | `my_super_secret_password` |
| `TMDB_API_KEY` | **Yes** | Your API key from [The Movie Database (TMDb)](https://www.themoviedb.org/documentation/api). | `a1b2c3d4e5f6g7h8i9j0` |
| `OMDB_API_KEY` | Optional | Your API key from [OMDb API](http://www.omdbapi.com/apikey.aspx). Improves metadata matching. | `12345678` |
| `HTTP_DEBUG` | Optional | Set to `true` to enable verbose logging of all outbound API and scraper requests for troubleshooting. | `true` |
| `ADDON_PROXY` | Optional | A proxy URL for all outbound traffic (e.g., for routing through a VPN). | `http://user:pass@host:port` |

### Step 2: Install in Stremio

1.  Once your addon is running, open a browser and navigate to its address (e.g., `http://your-server-ip:7810`). You will be redirected to the configuration page.
2.  Enter the same `ADDON_PASSWORD` you set as an environment variable.
3.  Click **Generate Install URL**.
4.  Click the **Install Tube Search Add-on** link, and Stremio will open and prompt you to install it.

---

## 🧭 End-to-End Flow Diagram

```mermaid
sequenceDiagram
  autonumber
  participant U as User (in Stremio)
  participant S as Stremio Client
  participant Server as Addon Server (server.js)
  participant Handler as Stream Handler
  participant API as API Service
  participant Scraper as Scraper Service
  participant Scorer as Scoring Service

  U->>S: Opens a movie/episode
  S->>Server: GET /:password/stream/:type/:id
  Server->>Handler: getStreams(type, id)
  Handler->>API: getMetadata() (uses server-side keys)
  API-->>Handler: Returns base metadata (title, year)
  Handler->>Scraper: scrapeImdbForEpisodeTitle()
  Scraper-->>Handler: Returns enriched episode title
  Handler->>Scraper: scrapeGoogleForStreams(queries)
  Scraper-->>Handler: Returns list of video results
  Handler->>Scorer: calculateScore(results, metadata)
  Scorer-->>Handler: Returns scored & sorted results
  Handler-->>Server: Final stream list (top 2 + fallbacks)
  Server-->>S: Sends { streams: [...] } JSON
  S-->>U: Displays stream options
  U->>S: Clicks a stream link
  S-->>U: Opens link in external browser/app
```

---

## 📁 Project Structure

```
.
└── ./
    ├── src/
    │   ├── api-service.js        # Handles TMDb/OMDb API calls
    │   ├── config.js             # Central app configuration (ports, timeouts, weights)
    │   ├── http-client.js        # Centralized Axios client with proxy support
    │   ├── http-debug.js         # Axios interceptors for verbose logging
    │   ├── scraper-service.js    # Handles all IMDb and Google scraping
    │   ├── scoring-service.js    # Contains the intelligent scoring logic
    │   └── stream-handler.js     # Orchestrates services to produce streams
    ├── public/
    │   └── configure.html        # Simple UI to generate install URL
    ├── .github/                  # CI/CD workflows for Docker publishing
    ├── server.js                 # Lean Express server (routes, auth, error handling)
    ├── manifest.json
    ├── package.json
    └── Dockerfile
```

---

## 🤝 Contributing

Issues and PRs are welcome—improvements to scraping robustness, scoring logic, and provider coverage are especially valuable.

---

## 📜 License

MIT
