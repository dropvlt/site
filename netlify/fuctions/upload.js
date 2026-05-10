const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;

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

async function verifyNetlifyJWT(token) {
  if (!token) return null;
  try {
    const res = await httpsRequest({
      hostname: 'api.netlify.com',
      path: `/api/v1/sites/${NETLIFY_SITE_ID}/identity/token`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (res.status === 200 && res.body?.id) return res.body;
    return null;
  } catch {
    return null;
  }
}

function sanitizePath(rawPath) {
  const parts = rawPath.split('/');
  const safe = parts.map(p =>
    p.replace(/\.\./g, '').replace(/[^a-zA-Z0-9._\-() ]/g, '_').trim()
  ).filter(Boolean);

  if (safe.length < 3) return null;
  if (safe[0] !== 'projects') return null;
  if (safe.length > 3) return null;

  return safe.join('/');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const user = await verifyNetlifyJWT(token);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'invalid or expired token' }) };
  }

  if (!GITHUB_TOKEN || !GITHUB_REPO || !GITHUB_OWNER) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'server not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid json' }) };
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

  const apiPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${safePath}`;

  let sha = undefined;
  const existing = await httpsRequest({
    hostname: 'api.github.com',
    path: apiPath,
    method: 'GET',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent': 'dropvlt-upload',
      'Accept': 'application/vnd.github.v3+json'
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
    path: apiPath,
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent': 'dropvlt-upload',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
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
