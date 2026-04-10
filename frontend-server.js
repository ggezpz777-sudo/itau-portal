import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const FRONTEND_PORT = 4000;
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'http://localhost:3000';

app.use('/api', express.json({ limit: '1mb' }));

// Proxy simple para API: el frontend consume /api sin exponer host backend.
app.all('/api/*', async (req, res) => {
  const targetUrl = `${BACKEND_ORIGIN}${req.originalUrl}`;
  const hasBody = !['GET', 'HEAD'].includes(req.method);

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: hasBody ? JSON.stringify(req.body || {}) : undefined
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const payload = await upstream.text();

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.send(payload);
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'No se pudo conectar al backend desde el frontend-server',
      detail: error.message
    });
  }
});

// Servir archivos estáticos (portal_2.html y otros)
app.use(express.static(__dirname, {
  dotfiles: 'deny'
}));

// Ruta raíz para servir el portal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal_2.html'));
});

app.listen(FRONTEND_PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         🌐 SERVIDOR FRONTEND CORRIENDO                    ║
╠════════════════════════════════════════════════════════════╣
║  📱 Abre en tu navegador:                                  ║
║     http://localhost:${FRONTEND_PORT}                        ║
║                                                            ║
║  ⚙️  El backend corre en: http://localhost:3000           ║
║                                                            ║
║  💡 Ahora puedes probar el portal sin errores CORS       ║
╚════════════════════════════════════════════════════════════╝
  `);
});
