/**
 * =========================================================================
 * DayToDay Wallet App — Node.js Server
 * =========================================================================
 * Lightweight, high-performance static PWA & API server.
 * - Supports dual modes: Express (if installed) or native Node.js HTTP fallback.
 * - Serves PWA assets with correct MIME types and Service Worker cache headers.
 * - Auto-resolves port conflicts (EADDRINUSE) so it never crashes!
 * - Displays local and Wi-Fi network URLs for easy phone testing.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 8085;
const PUBLIC_DIR = __dirname;

// MIME type map for robust static serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

// Helper to find local LAN IP for phone testing
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function printBanner(port) {
  const ip = getLocalIp();
  console.log('\n===========================================================');
  console.log('   🚀 DayToDay Wallet App — Server Active');
  console.log('===========================================================');
  console.log(`   💻 Local Desktop : http://localhost:${port}`);
  console.log(`   📱 Same Wi-Fi    : http://${ip}:${port}`);
  console.log('   📦 Mode          : High-Performance PWA & Offline Sync');
  console.log('===========================================================\n');
}

// -------------------------------------------------------------------------
// Mode 1: Express Server (Preferred if dependencies are installed)
// -------------------------------------------------------------------------
function startExpressServer(startPort) {
  const express = require('express');
  const cors = require('cors');

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // API Health Check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      app: 'DayToDay Wallet App',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  // API Version Info
  app.get('/api/info', (req, res) => {
    res.json({
      name: 'DayToDay Wallet App',
      version: '1.0.0',
      pwa: true,
      features: ['Expense Tracking', 'Goals & Targets', 'Bill Scanner OCR', 'Offline Sync']
    });
  });

  // Service Worker custom cache headers (SW must never be aggressively cached)
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
  });

  // Manifest custom header
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.sendFile(path.join(PUBLIC_DIR, 'manifest.json'));
  });

  // Static files middleware
  app.use(express.static(PUBLIC_DIR, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.html') {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  }));

  // Fallback to index.html for SPA/PWA routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // Auto-resolve port conflicts gracefully
  function tryListen(p, attemptsLeft) {
    const srv = app.listen(p, '0.0.0.0', () => {
      printBanner(p);
    });

    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`ℹ️ Port ${p} busy hai. Agla port ${p + 1} try kiya ja raha hai...`);
        tryListen(p + 1, attemptsLeft - 1);
      } else {
        console.error('Server error:', err.message);
      }
    });
  }

  tryListen(startPort, 10);
}

// -------------------------------------------------------------------------
// Mode 2: Built-in Native HTTP Server Fallback (Runs without npm install)
// -------------------------------------------------------------------------
function startNativeServer(startPort) {
  const http = require('http');

  function createHandler() {
    return (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }

      const cleanUrl = req.url.split('?')[0];

      if (cleanUrl === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', uptime: Math.floor(process.uptime()) }));
      }

      const relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\//, '');
      const safePath = path.normalize(path.join(PUBLIC_DIR, relPath));

      if (!safePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        return res.end('Access Denied');
      }

      fs.stat(safePath, (err, stats) => {
        if (err || !stats.isFile()) {
          const indexPath = path.join(PUBLIC_DIR, 'index.html');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(indexPath).pipe(res);
          return;
        }

        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const headers = { 'Content-Type': contentType };

        if (safePath.endsWith('sw.js')) {
          headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        }

        res.writeHead(200, headers);
        fs.createReadStream(safePath).pipe(res);
      });
    };
  }

  function tryListenNative(p, attemptsLeft) {
    const srv = http.createServer(createHandler());

    srv.listen(p, '0.0.0.0', () => {
      printBanner(p);
    });

    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`ℹ️ Port ${p} busy hai. Agla port ${p + 1} try kiya ja raha hai...`);
        tryListenNative(p + 1, attemptsLeft - 1);
      } else {
        console.error('Server error:', err.message);
      }
    });
  }

  tryListenNative(startPort, 10);
}

// Start with Express if available, else native HTTP
try {
  startExpressServer(DEFAULT_PORT);
} catch (err) {
  console.log('ℹ️ Express not found, using built-in native Node.js HTTP server.');
  startNativeServer(DEFAULT_PORT);
}
