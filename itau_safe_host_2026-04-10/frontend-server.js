import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const FRONTEND_PORT = 4000;

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
