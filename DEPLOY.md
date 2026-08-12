# ClipAI – Deploy to Render.com (Free)

This guide gets your ClipAI website live online in ~10 minutes for free.

---

## Step 1 — Create a GitHub Account (if you don't have one)
Go to https://github.com and sign up (free).

---

## Step 2 — Create a New GitHub Repository

1. Go to https://github.com/new
2. Repository name: `clipai`
3. Set to **Public**
4. Click **Create repository**

---

## Step 3 — Upload Your Files to GitHub

On the new empty repo page, click **"uploading an existing file"**

Upload ALL these files from your `C:\Users\Dell\Desktop\Videso to shorts\` folder:

```
index.html
styles.css       (if exists)
app.js
clipper.js
renderer.js
exporter.js
server.js
package.json
render.yaml
.gitignore
```

> DO NOT upload: `yt-dlp.exe`, `tmp_videos/`, `node_modules/`, `server.ps1`

Click **Commit changes**.

---

## Step 4 — Deploy on Render.com (Free)

1. Go to https://render.com and sign up with your GitHub account

2. Click **"New +"** → **"Web Service"**

3. Click **"Connect a repository"** → select your `clipai` repo

4. Fill in these settings:
   - **Name:** `clipai` (or anything you like)
   - **Region:** Oregon (US West)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install && pip install yt-dlp`
   - **Start Command:** `node server.js`
   - **Instance Type:** `Free`

5. Click **"Create Web Service"**

6. Wait 3–5 minutes for the build to complete ✅

7. Your site is live at: `https://clipai-xxxx.onrender.com`

---

## That's it! 🎉

Your full ClipAI website with YouTube download is now online for FREE.

- ✅ YouTube link → real video download via yt-dlp
- ✅ AI clip detection (15s/30s/60s)
- ✅ Animated captions
- ✅ Download shorts
- ✅ File upload works

---

## Notes

- **Free tier sleeps after 15 min** of no traffic — first request takes ~30s to wake up
- To keep it always-on: upgrade to Render's $7/mo Starter plan
- **Alternatively** use Railway.app (https://railway.app) — similar process, also free

---

## Alternative: Railway.app

1. Go to https://railway.app → sign up with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `clipai` repo
4. Railway auto-detects Node.js
5. Go to **Settings** → set:
   - Build Command: `npm install && pip install yt-dlp`
   - Start Command: `node server.js`
6. Deploy → get your URL!
