# Setup Guide for JubileeVerse.com

## Prerequisites

- Node.js 20+
- npm 10+
- Windows (for service deployment) or WSL2/Linux

## Important: Do NOT Use PM2

**PM2 should never be used for this project.** All services are managed by the Inspire Internet Server (IIS) on WSL. Using PM2 will conflict with the IIS service management and cause issues.

## Quick Start

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create environment file:
   ```bash
   cp .env.example .env
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3107`

## Environment Configuration

Create a `.env` file in the project root:

```env
# Server
NODE_ENV=development
PORT=3107

# InspireCodex API (content backend)
INSPIRE_API_BASE=https://inspirecodex.com/api/v1
```

## Development

### Running the Server

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

### Testing Endpoints

```bash
# Health check
curl http://localhost:3107/health

# Daily verse
curl http://localhost:3107/api/daily-verse

# RSS feed
curl http://localhost:3107/api/scanner/rss/cnn
```

## Production Deployment

### Windows Service Installation

1. Ensure Node.js is installed and in PATH
2. Run the service installer:
   ```bash
   node ops/services/install-service.js
   ```
3. The service will start automatically

To uninstall:
```bash
node ops/services/uninstall-service.js
```

### IIS Deployment

The project includes `web.config` for IIS with iisnode:

1. Install iisnode on the server
2. Point IIS website to the project directory
3. Ensure the application pool has permission to run Node.js

### WSL2 Deployment with Inspire Internet Server (IIS)

The recommended deployment method is using the Inspire Internet Server (IIS) on WSL2:

1. Copy files to `/var/www/apps/JubileeVerse.com/` on WSL
2. The IIS service will automatically manage the Node.js workers
3. Cloudflare tunnel routes traffic to the appropriate ports

To restart the service:
```bash
curl -X POST http://localhost:3900/restart/jubileeverse
```

### Manual Deployment (Development Only)

```bash
# Install production dependencies
npm install --production

# Start directly (do NOT use PM2)
NODE_ENV=production node server.js
```

## Directory Overview

| Directory | Purpose |
|-----------|---------|
| `public/` | Static HTML, CSS, JS, images |
| `api/` | API subdomain application |
| `web/` | Web subdomain application |
| `ops/` | Operational scripts and service management |
| `daemon/` | Windows service binaries and logs |
| `deploy/` | Deployment shell scripts |
| `docs/` | Documentation |

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3107
netstat -ano | findstr :3107

# Kill the process (Windows)
taskkill /PID <pid> /F
```

### Service Not Starting

Check the daemon logs:
- `daemon/jubileeverse.out.log` - stdout
- `daemon/jubileeverse.err.log` - stderr
- `daemon/jubileeverse.wrapper.log` - service wrapper logs

### API Proxy Errors

Verify InspireCodex API is accessible:
```bash
curl https://inspirecodex.com/api/v1/health
```
