# dropvlt v2

Minimalist file viewer with secure admin upload page.

---

## Setup (~10 minutes)

### 1. Push to GitHub
- Create a new repo on github.com (e.g. `dropvlt-site`)
- Upload all these files into it

### 2. Connect to Netlify
- netlify.com → Add new site → Import from GitHub → pick your repo
- Build command: `node build.js` (auto-detected from netlify.toml)
- Deploy

### 3. Rename your site
- Site settings → Domain management → Edit site name → `dropvlt`
- Site live at: `https://dropvlt.netlify.app`

### 4. Enable Netlify Identity (for the upload page)
- Netlify dashboard → your site → Identity tab → Enable Identity
- Under Registration: set to **Invite only** (IMPORTANT — no one else can sign up)
- Invite yourself with your email
- Check your email → accept invite → set your password
- That's your one admin account

### 5. Set up GitHub API access (for uploading files)
- Go to github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)
- Generate new token → name it `dropvlt-upload`
- Scope: check `repo` (full repo access)
- Copy the token

### 6. Add environment variables in Netlify
- Netlify dashboard → your site → Site configuration → Environment variables
- Add these 4 variables:

| Key | Value |
|-----|-------|
| `GITHUB_TOKEN` | your GitHub personal access token |
| `GITHUB_OWNER` | your GitHub username (e.g. `dropvlt`) |
| `GITHUB_REPO` | your repo name (e.g. `dropvlt-site`) |
| `NETLIFY_SITE_ID` | found in Site configuration → General → Site ID |

### 7. Trigger a redeploy
- Deploys tab → Trigger deploy → Deploy site
- Done!

---

## Uploading files

1. Go to `https://dropvlt.netlify.app/upload`
2. Log in with your admin account
3. Pick an existing folder or create a new one
4. Drag & drop files
5. Hit Upload
6. Site rebuilds in ~30 seconds — files appear automatically

---

## File types supported

| Extension | Viewer |
|-----------|--------|
| `.pdf` | Embedded PDF viewer |
| `.jpg` `.png` `.webp` etc | Image lightbox |
| `.youtube` | Embedded YouTube (put URL inside file) |
| `.txt` `.md` | Text viewer |
| anything else | Download button |

---

## Security notes

- Upload page protected by Netlify Identity JWT (industry-standard auth)
- Registration locked to invite-only — only you can have an account
- Server function validates the JWT on every request (no client-side bypass)
- File paths are sanitized server-side (no path traversal possible)
- Files only land in `projects/` folder (hardcoded restriction)
- Max file size: 20MB per file
