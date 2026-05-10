const https  = require('https');
const crypto = require('crypto');

const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
const GITHUB_OWNER    = process.env.GITHUB_OWNER;
const GITHUB_REPO     = process.env.GITHUB_REPO;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD;

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

function gh(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent':    'dropvlt',
        'Accept':        'application/vnd.github.v3+json',
        ...(bodyStr ? {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function repoPath(segments) {
  return `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${segments.map(s => encodeURIComponent(s)).join('/')}`;
}

function sanitizeName(name) {
  return name.replace(/\.\./g, '').replace(/[^a-zA-Z0-9._\-() ]/g, '_').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const provided = (req.headers['x-upload-password'] || '').trim();
  if (!safeEqual(provided, UPLOAD_PASSWORD || '')) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const action = req.query.action || req.body?.action;

  // ── List all folders and files ──────────────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    const top = await gh('GET', repoPath(['projects']));
    if (top.status !== 200) return res.status(top.status).json(top.body);

    const folders = Array.isArray(top.body) ? top.body.filter(i => i.type === 'dir') : [];

    const projects = await Promise.all(folders.map(async folder => {
      const listing = await gh('GET', repoPath(['projects', folder.name]));
      const files = listing.status === 200
        ? listing.body.filter(f => f.type === 'file' && !f.name.startsWith('.')).map(f => ({
            name: f.name,
            sha:  f.sha,
            size: f.size,
            path: f.path
          }))
        : [];
      return { name: folder.name, files };
    }));

    return res.status(200).json({ projects });
  }

  // ── Delete a single file ────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'delete-file') {
    const { path, sha } = req.body;
    if (!path || !sha) return res.status(400).json({ error: 'missing path or sha' });

    // Only allow deleting inside projects/
    if (!path.startsWith('projects/')) return res.status(400).json({ error: 'invalid path' });

    const result = await gh('DELETE', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      message: `delete: ${path}`,
      sha
    });

    return res.status(result.status === 200 ? 200 : result.status).json({ ok: result.status === 200 });
  }

  // ── Delete an entire folder ─────────────────────────────────────────────
  if (req.method === 'POST' && action === 'delete-folder') {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'missing name' });

    const listing = await gh('GET', repoPath(['projects', name]));
    if (listing.status !== 200) return res.status(404).json({ error: 'folder not found' });

    const files = Array.isArray(listing.body) ? listing.body.filter(f => f.type === 'file') : [];

    for (const file of files) {
      await gh('DELETE', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}`, {
        message: `delete folder: ${name}`,
        sha: file.sha
      });
    }

    return res.status(200).json({ ok: true });
  }

  // ── Rename a folder ─────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'rename-folder') {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'missing names' });

    const safeName = sanitizeName(newName);
    if (!safeName) return res.status(400).json({ error: 'invalid name' });

    const listing = await gh('GET', repoPath(['projects', oldName]));
    if (listing.status !== 200) return res.status(404).json({ error: 'folder not found' });

    const files = Array.isArray(listing.body) ? listing.body.filter(f => f.type === 'file') : [];

    for (const file of files) {
      // Fetch full content
      const got = await gh('GET', repoPath(['projects', oldName, file.name]));
      if (got.status !== 200 || !got.body.content) continue;

      const content = got.body.content.replace(/\n/g, '');

      // Create at new path
      await gh('PUT', repoPath(['projects', safeName, file.name]), {
        message: `rename: ${oldName} → ${safeName}`,
        content
      });

      // Delete from old path
      await gh('DELETE', repoPath(['projects', oldName, file.name]), {
        message: `rename cleanup: ${oldName}/${file.name}`,
        sha: file.sha
      });
    }

    return res.status(200).json({ ok: true });
  }

  // ── Create a new folder ─────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'create-folder') {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'missing name' });

    const safeName = sanitizeName(name);
    if (!safeName) return res.status(400).json({ error: 'invalid name' });

    const result = await gh('PUT', repoPath(['projects', safeName, '.gitkeep']), {
      message: `mkdir: ${safeName}`,
      content: ''
    });

    return res.status(result.status === 201 ? 200 : result.status).json({ ok: result.status === 201 });
  }

  return res.status(400).json({ error: 'unknown action' });
};
