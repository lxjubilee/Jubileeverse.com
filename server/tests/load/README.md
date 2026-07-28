# Artillery Load Test

Run the load test against a locally running JubileeVerse server.

## Prerequisites

```bash
npm install -g artillery
```

## Setup

1. Start the server: `npm start` (or `npm run dev`)
2. Create an API key via the Cockpit admin UI and copy it

## Running

```bash
export JUBILEE_TEST_API_KEY=<your-api-key>
artillery run tests/load/load-test.yml --output report.json
```

## View Results

```bash
artillery report report.json
```

## Acceptance Criteria

- p95 response time < 500ms
- Error rate < 1%
- Scenarios: public content API (60%), search (25%), health check (15%)
