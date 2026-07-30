import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Raw / JSON body parser with high payload limit for upload speed test
  app.use(express.json({ limit: '50mb' }));
  app.use(express.raw({ limit: '50mb', type: 'application/octet-stream' }));

  // Speed test ping endpoint (low latency health check)
  app.get('/api/speedtest/ping', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.json({ timestamp: Date.now() });
  });

  // Speed test download endpoint - streams zero-filled binary data chunks
  app.get('/api/speedtest/download', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');

    let sizeMb = parseFloat(req.query.size as string) || 5;
    if (sizeMb < 0.1) sizeMb = 0.1;
    if (sizeMb > 50) sizeMb = 50;

    const totalBytes = Math.round(sizeMb * 1024 * 1024);
    res.setHeader('Content-Length', totalBytes.toString());

    // 64KB buffer chunk
    const chunkSize = 64 * 1024;
    const chunk = Buffer.alloc(chunkSize);
    let sent = 0;

    function sendNext() {
      while (sent < totalBytes) {
        const remaining = totalBytes - sent;
        const currentChunkSize = Math.min(chunkSize, remaining);
        const toSend = currentChunkSize === chunkSize ? chunk : Buffer.alloc(currentChunkSize);
        const canContinue = res.write(toSend);
        sent += currentChunkSize;
        if (!canContinue) {
          res.once('drain', sendNext);
          return;
        }
      }
      res.end();
    }

    sendNext();
  });

  // Speed test upload endpoint - accepts incoming stream and counts transferred bytes
  app.post('/api/speedtest/upload', (req, res) => {
    const startTime = Date.now();
    let bytesReceived = 0;

    req.on('data', (chunk) => {
      bytesReceived += chunk.length;
    });

    req.on('end', () => {
      const durationMs = Math.max(1, Date.now() - startTime);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json({
        bytesReceived,
        durationMs,
        mbps: parseFloat(((bytesReceived * 8) / (durationMs / 1000 * 1000000)).toFixed(2)),
        status: 'ok',
      });
    });

    req.on('error', () => {
      res.status(500).json({ error: 'Upload stream failed' });
    });
  });

  // OPTIONS handler for CORS preflight
  app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control');
    res.sendStatus(204);
  });

  // Vite middleware for development mode
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NetReady Express Server] Speed test backend listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
