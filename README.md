# Colindante — Dashboard Gerencial

## Setup rápido

1. Abre `index.html` y reemplaza `TU_SHEET_ID_AQUI` con el ID de tu Google Sheet
2. El ID está en la URL de tu Sheet: `docs.google.com/spreadsheets/d/[ESTE_ES_EL_ID]/edit`

## Deploy en Railway (5 minutos)

1. Sube esta carpeta a un repositorio en GitHub
2. Ve a railway.app → New Project → Deploy from GitHub
3. Selecciona el repositorio → Railway detecta Node.js automáticamente → Deploy
4. En 2 minutos tienes tu URL: `https://tu-proyecto.up.railway.app`

## Estructura
- `index.html` — toda la app (HTML + CSS + JS en un solo archivo)
- `server.js` — servidor Node.js minimalista para Railway
- `package.json` — configuración para Railway

## Datos
Lee directamente de Google Sheets via gviz API (sin autenticación requerida).
El Sheet debe ser público ("Cualquiera con el enlace puede ver").
