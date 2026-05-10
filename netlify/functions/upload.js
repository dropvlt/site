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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Password',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  // ── Password auth ────────────────────────────────────────────────────────
  if (!UPLOAD_PASSWORD) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'UPLOAD_PASSWORD env var not configured' }) };
  }

  const provided = (event.headers['x-upload-password'] || '').trim();
  if (!safeEqual(provided, UPLOAD_PASSWORD)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid json' }) };
  }

  // Probe: used by the login flow to confirm the password is correct.
  if (body.probe) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  if (!GITHUB_TOKEN || !GITHUB_REPO || !GITHUB_OWNER) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'server not configured' }) };
  }

  const { path: rawPath, content } = body;

  if (!rawPath || !content) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing path or content' }) };
  }

  const safePath = sanitizePath(rawPath);
  if (!safePath) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid file path' }) };
  }

  if (content.length > 20 * 1024 * 1024) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: 'file too large (max 20MB)' }) };
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
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, path: safePath }) };
  }

  return {
    statusCode: result.status,
    headers,
    body: JSON.stringify({ error: result.body?.message || 'github error' })
  };
};
