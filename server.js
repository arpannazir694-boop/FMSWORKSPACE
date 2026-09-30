import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Serve real static assets from the root directory
app.use(express.static(__dirname));

// Route handlers for direct friendly URLs
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Graceful fallback for missing module scripts or styles to avoid 404 execution blocks
app.use((req, res, next) => {
  if (req.path.endsWith('.js')) {
    res.type('application/javascript');
    return res.send('/* stub module */');
  }
  if (req.path.endsWith('.css')) {
    res.type('text/css');
    return res.send('/* stub css */');
  }
  if (req.path.endsWith('.ttf') || req.path.endsWith('.woff') || req.path.endsWith('.woff2')) {
    return res.status(204).end();
  }
  next();
});

// Default SPA fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`FMS Workspace server running at http://${HOST}:${PORT}`);
});
