const fs = require('fs');
const path = require('path');

const PROJECTS_DIR = path.join(__dirname, 'projects');
const OUT = path.join(__dirname, 'manifest.json');

const IMAGE_EXTS = ['.jpg','.jpeg','.png','.gif','.webp','.svg','.avif'];

function getType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (['.mp4','.webm','.mov'].includes(ext)) return 'video';
  if (ext === '.youtube') return 'youtube';
  if (['.txt','.md'].includes(ext)) return 'doc';
  return 'file';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const projects = [];

if (fs.existsSync(PROJECTS_DIR)) {
  fs.readdirSync(PROJECTS_DIR)
    .filter(f => fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory())
    .forEach(folder => {
      const folderPath = path.join(PROJECTS_DIR, folder);
      const files = fs.readdirSync(folderPath)
        .filter(f => !f.startsWith('.'))
        .map(filename => {
          const stat = fs.statSync(path.join(folderPath, filename));
          return {
            name: filename,
            type: getType(filename),
            size: formatSize(stat.size),
            modified: stat.mtime.toISOString().split('T')[0]
          };
        });

      projects.push({
        name: folder,
        count: files.length,
        updated: fs.statSync(folderPath).mtime.toISOString().split('T')[0],
        files
      });
    });
}

fs.writeFileSync(OUT, JSON.stringify({ projects }, null, 2));
console.log(`manifest.json built — ${projects.length} project(s)`);
