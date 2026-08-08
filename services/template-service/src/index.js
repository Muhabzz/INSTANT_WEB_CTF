require('dotenv').config();
const path = require('path');
const express = require('express');
const ejs = require('ejs');

const PORT = parseInt(process.env.TEMPLATE_SERVICE_PORT || '4002', 10);
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Fixed whitelist of renderable templates - the caller supplies a template
// *name* (looked up here), never a template *path* or template *body*.
// This keeps template selection off of user-controlled input for Phase 1.
const TEMPLATES = {
  invoice: 'invoice.ejs',
  welcome_email: 'welcome_email.ejs',
};

const app = express();
app.use(express.json());

function log(event, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'template-service', event, ...meta }));
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'template-service' });
});

app.post('/render', async (req, res) => {
  const { template, data } = req.body || {};
  const file = TEMPLATES[template];
  if (!file) {
    return res.status(400).json({ error: 'unknown_template', allowed: Object.keys(TEMPLATES) });
  }
  try {
    const html = await ejs.renderFile(path.join(TEMPLATES_DIR, file), data || {});
    res.status(200).send(html);
  } catch (err) {
    log('render_error', { template, message: err.message });
    res.status(500).json({ error: 'render_failed' });
  }
});

app.listen(PORT, () => log('server_started', { port: PORT }));
