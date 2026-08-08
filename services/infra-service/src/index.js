require('dotenv').config();
const express = require('express');

const PORT = parseInt(process.env.INFRA_SERVICE_PORT || '4003', 10);
const START_TIME = Date.now();

const app = express();

function log(event, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'infra-service', event, ...meta }));
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'infra-service' });
});

// Synthetic internal ops dashboard data - not real infrastructure, just
// enough recon surface for later challenge phases to build on. Not
// reachable from the public internet.
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    environment: 'production',
    services: [
      { name: 'instant-web', status: 'ok' },
      { name: 'internal-api', status: 'ok' },
      { name: 'template-service', status: 'ok' },
      { name: 'postgres', status: 'ok' },
    ],
    version: '1.0.0',
  });
});

app.listen(PORT, () => log('server_started', { port: PORT }));
