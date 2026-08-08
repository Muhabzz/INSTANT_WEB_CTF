// Minimal structured logger. Writes single-line JSON to stdout so it is
// captured by `docker compose logs`. Never pass passwords or session tokens
// into `meta`.
function log(level, event, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    service: 'instant-web',
    level,
    event,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  info: (event, meta) => log('info', event, meta),
  warn: (event, meta) => log('warn', event, meta),
  error: (event, meta) => log('error', event, meta),
};
