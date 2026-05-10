const https = require('https');

module.exports = async function handler(req, res) {
  const { f, file } = req.query;
  if (!f || !file) return res.status(400).end('missing params');

  const folder   = f.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
  const filename = file.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
  const apiPath  = `/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/projects/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;

  const result = await new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'User-Agent': 'dropvlt',
        'Accept': 'application/vnd.github.v3+json'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    r.on('error', reject);
    r.end();
  });

  if (result.status !== 200 || !result.body.content) {
    return res.status(404).end('not found');
  }

  const ext = filename.split('.').pop().toLowerCase();
  const mime = {
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml'
  }[ext] || 'application/octet-stream';

  const buffer = Buffer.from(result.body.content.replace(/\n/g, ''), 'base64');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(buffer);
};
