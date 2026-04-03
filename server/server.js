const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(__dirname, '..', 'music');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const VALID_MOODS = ['focus', 'relax', 'sleep'];

// Service worker must be served with Service-Worker-Allowed header
// so it can control requests from the root scope
app.get('/sw.js', (req, res) => {
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(FRONTEND_DIR, 'sw.js'));
});

// Serve static frontend files (HTML, CSS, JS, lofi-track.mp3)
app.use(express.static(FRONTEND_DIR));

// Serve music files with byte-range support (required for Safari audio streaming)
app.use('/music', express.static(MUSIC_DIR));

// API: GET /api/playlist?mood=focus|relax|sleep
app.get('/api/playlist', (req, res) => {
    const mood = req.query.mood;

    if (!mood || !VALID_MOODS.includes(mood)) {
        return res.status(400).json({ error: 'Invalid mood. Must be focus, relax, or sleep.' });
    }

    const moodDir = path.join(MUSIC_DIR, mood);

    if (!fs.existsSync(moodDir)) {
        return res.json({ tracks: [] });
    }

    let files;
    try {
        files = fs.readdirSync(moodDir);
    } catch (e) {
        return res.json({ tracks: [] });
    }

    const tracks = files
        .filter(f => f.toLowerCase().endsWith('.mp3'))
        .map(f => {
            const baseName = f.replace(/\.mp3$/i, '');
            let title = baseName.replace(/[_-]/g, ' ');
            let tags = '';
            let duration = 0;

            // Read optional sidecar .json metadata file (mirrors Rust backend behavior)
            const jsonPath = path.join(moodDir, baseName + '.json');
            if (fs.existsSync(jsonPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    if (meta.title) title = meta.title;
                    if (meta.tags) tags = meta.tags;
                    if (meta.duration) duration = meta.duration;
                } catch (e) { /* ignore malformed JSON */ }
            }

            return {
                url: `/music/${mood}/${encodeURIComponent(f)}`,
                metadata: { id: baseName, title, tags, duration }
            };
        });

    res.json({ tracks });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`NoFee-Music server running on port ${PORT}`);
    console.log(`Music directory: ${MUSIC_DIR}`);
});
