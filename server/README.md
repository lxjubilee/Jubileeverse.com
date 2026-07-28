# JubileeVerse.com

Uplifting Christian news, devotionals, and inspiration portal powered by InspireCodex API.

## Overview

JubileeVerse provides a content portal for Christian news, devotionals, sermon series, and inspirational content. The server acts as an API proxy to InspireCodex and includes RSS feed scanning capabilities for major news sources.

## Features

### Content Portal
- **News Aggregation**: Christian news and articles from InspireCodex
- **Daily Devotionals**: Devotional content with day-by-day reading plans
- **Sermon Series**: Organized sermon content by series
- **Knowledge Base**: Searchable spiritual content database
- **Daily Verse**: Rotating scripture verses

### News Scanner
- **RSS Feed Proxy**: Fetches and parses RSS feeds from major news sources
- **Supported Sources**: CNN, NY Times, Fox News, Yahoo News, MSN
- **AI Analysis**: Integration with prominence scanning for content analysis

### Static Pages
- **Homepage**: Main portal interface (`index.html`)
- **Article View**: Individual article display (`article.html`)
- **Scanner Interface**: News scanning dashboard (`scanner.html`)

## Port

- Default: `3107`
- Configurable via `PORT` environment variable

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Content API (proxied to InspireCodex)
- `GET /api/content` - List content (supports `category_id`, `content_type`, `limit`, `offset`)
- `GET /api/content/:id` - Get single content item
- `GET /api/categories` - List categories
- `GET /api/devotionals` - List devotionals
- `GET /api/devotionals/:id/days` - Get devotional days
- `GET /api/series` - List sermon series
- `GET /api/knowledge` - Search knowledge base (supports `category`, `search`, `limit`)
- `GET /api/daily-verse` - Get daily scripture verse

### Scanner API
- `GET /api/scanner/rss/:source` - Fetch RSS feed (sources: `cnn`, `nytimes`, `foxnews`, `yahoo`, `msn`)

## Directory Structure

```
JubileeVerse.com/
├── docs/               # Project documentation
│   └── SETUP.md        # Setup guide
├── ops/                # Operational tooling
│   ├── services/       # Windows service management
│   │   ├── install-service.js
│   │   └── uninstall-service.js
│   └── scripts/        # Utility scripts
├── daemon/             # Windows service (WinSW)
│   ├── jubileeverse.exe
│   ├── jubileeverse.xml
│   └── *.log           # Service logs
├── deploy/             # Deployment scripts
│   ├── dev-deploy.sh
│   └── prod-deploy.sh
├── public/             # Static files
│   ├── index.html      # Homepage
│   ├── article.html    # Article view
│   ├── scanner.html    # Scanner interface
│   └── images/         # Image assets
├── api/                # API application (subdomain)
├── web/                # Web application (subdomain)
├── shared/             # Shared code
├── server.js           # Main Node.js server
├── web.config          # IIS configuration
├── .env                # Environment variables (not in git)
└── package.json        # Dependencies
```

## Running Locally

```bash
npm install
npm run dev
```

Or directly:
```bash
node server.js
```

## Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=development
PORT=3107

# InspireCodex API
INSPIRE_API_BASE=https://inspirecodex.com/api/v1
```

## Windows Service

The application can run as a Windows service using WinSW:

```bash
# Install service
node ops/services/install-service.js

# Uninstall service
node ops/services/uninstall-service.js
```

Service logs are stored in the `daemon/` directory.

## Environments

| Env  | Web                      | API                         | Branch  |
|------|--------------------------|----------------------------|---------|
| Dev  | dev.jubileeverse.com  | dpi.jubileeverse.com    | develop |
| Prod | jubileeverse.com      | api.jubileeverse.com    | main    |

## CORS

Cross-origin requests are enabled for all origins (`*`) with methods:
- GET
- POST
- OPTIONS

## Technology Stack

- Node.js with Express
- Static file serving
- HTTP/HTTPS proxy to InspireCodex API
- RSS feed parsing
- Morgan logging
- dotenv configuration

## License

Copyright 2024-2026 Jubilee Solutions
