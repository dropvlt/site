const https = require('https');

module.exports = async function handler(req, res) {
  const { f, file } = req.query;

  if (!f || !file) return res.status(400).end('missing params');

  // Basic path sanitization
  const folder = f.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
  const filename = file.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
  const path = `/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/projects/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'User-Agent': 'dropvlt',
        'Accept': 'application/vnd.github.v3+json'
      }
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end();
  });

  if (result.status !== 200 || !result.body.content) {
    return res.status(404).end('not found');
  }

  const buffer = Buffer.from(result.body.content, 'base64');
  res.setHeader('Content-Type', result.body.name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(buffer);
};
