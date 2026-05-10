const https  = require('https');
const crypto = require('crypto');

const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
const GITHUB_REPO     = process.env.GITHUB_REPO;
const GITHUB_OWNER    = process.env.GITHUB_OWNER;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;

// Constant-time comparison to prevent timing-based password leaks.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function sanitizePath(rawPath) {
  const parts = rawPath.split('/');
  const safe  = parts
    .map(p => p.replace(/\.\./g, '').replace(/[^a-zA-Z0-9._\-() ]/g, '_').trim())
    .filter(Boolean);

  if (safe.length < 3)        return null;
  if (safe[0] !== 'projects') return null;
  if (safe.length > 3)        return null;

  return safe.join('/');
}

module.exports = async function handler(req, res) {
  // On Vercel, VERCEL_URL is the deployment URL (without protocol).
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '*';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Upload-Password');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  // ── Password auth ────────────────────────────────────────────────────────
  if (!UPLOAD_PASSWORD) {
    return res.status(500).json({ error: 'UPLOAD_PASSWORD env var not configured' });
  }

  const provided = (req.headers['x-upload-password'] || '').trim();
  if (!safeEqual(provided, UPLOAD_PASSWORD)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  // Vercel automatically parses JSON bodies when Content-Type is application/json.
  const body = req.body;

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid json' });
  }

  // Probe: used by the login flow to confirm the password is correct.
  if (body.probe) {
    return res.status(200).json({ ok: true });
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  if (!GITHUB_TOKEN || !GITHUB_REPO || !GITHUB_OWNER) {
    return res.status(500).json({ error: 'server not configured' });
  }

  const { path: rawPath, content } = body;

  if (!rawPath || !content) {
    return res.status(400).json({ error: 'missing path or content' });
  }

  const safePath = sanitizePath(rawPath);
  if (!safePath) {
    return res.status(400).json({ error: 'invalid file path' });
  }

  if (content.length > 20 * 1024 * 1024) {
    return res.status(413).json({ error: 'file too large (max 20MB)' });
  }

  const apiPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${safePath.split('/').map(p => encodeURIComponent(p)).join('/')}`;

  // Fetch existing file sha (needed for updates, not creates).
  let sha;
  const existing = await httpsRequest({
    hostname: 'api.github.com',
    path: apiPath,
    method: 'GET',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent':    'dropvlt-upload',
      'Accept':        'application/vnd.github.v3+json'
    }
  });

  if (existing.status === 200 && existing.body?.sha) {
    sha = existing.body.sha;
  }

  const payload = {
    message: `upload: ${safePath}`,
    content,
    ...(sha ? { sha } : {})
  };

  const result = await httpsRequest({
    hostname: 'api.github.com',
    path:     apiPath,
    method:   'PUT',
    headers: {
      'Authorization':  `token ${GITHUB_TOKEN}`,
      'User-Agent':     'dropvlt-upload',
      'Accept':         'application/vnd.github.v3+json',
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(payload))
    }
  }, payload);

  if (result.status === 200 || result.status === 201) {
    return res.status(200).json({ ok: true, path: safePath });
  }

  return res.status(result.status).json({ error: result.body?.message || 'github error' });
};
