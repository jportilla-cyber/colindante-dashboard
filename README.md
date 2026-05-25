# Colindante — Dashboard Gerencial

Dashboard ejecutivo conectado a Google Sheets en vivo.
Versión **A · Sobrio Brand** — paleta verde Colindante con logo corporativo.

---

## Estructura

```
deploy/
├── index.html                    ← App principal
├── dashboard-core.js             ← Lógica de datos + render
├── variant-enhancements.js       ← Hero de Preventa + lecturas de gráficos
├── assets/
│   └── colindante-logo.png       ← Logo de marca
├── server.js                     ← Servidor Node (para Railway)
├── package.json                  ← Config Node
└── README.md                     ← Este archivo
```

---

## Subir a GitHub

```bash
# Desde la carpeta deploy/
git init
git add .
git commit -m "Dashboard Gerencial Colindante · v2"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

---

## Deploy

### Opción 1 · Railway (recomendado, 2 minutos)
1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. Selecciona el repo → Railway detecta Node.js automáticamente
3. Listo: te da una URL `https://tu-proyecto.up.railway.app`

### Opción 2 · GitHub Pages (estático, gratis)
Como el dashboard es HTML + JS puro (los datos vienen de Google Sheets),
**no necesitas el server.js para GitHub Pages**.

1. En tu repo: **Settings → Pages → Source: main / root**
2. Tu dashboard estará en `https://TU_USUARIO.github.io/TU_REPO/`

---

## Configuración del Sheet

El SHEET_ID ya está configurado en `dashboard-core.js` (línea 4):
```js
const SHEET_ID = '1VvhPWG1vByY0cm5NtDnuJZxbUGCSw730XUi5_8RWbgQ';
```

**Requisito:** el Google Sheet debe estar configurado como
**"Cualquiera con el enlace puede ver"** para que el dashboard lo pueda leer.

---

## Características

- ✓ **Modo día/noche** (botón ☽/☀ en la esquina superior derecha)
- ✓ **Responsive** — funciona en escritorio y móvil
- ✓ **Hero de Preventa** con semáforo verde/ámbar/rojo por proyecto
- ✓ **Lecturas ejecutivas** auto-generadas debajo de cada gráfico
- ✓ **Logo Colindante** + paleta de marca (#59AC77)
- ✓ **Datos en vivo** desde Google Sheets (refresco automático)

---

## Páginas del dashboard

| Página | Contenido |
|---|---|
| **Resumen** | Hero de Preventa + KPIs + listado de proyectos |
| **Preventa** | Detalle de unidades válidas por proyecto |
| **Gráficos** | Ventas vs Ingresos · Proyección acumulada · Meta comercial |
| **Cobranza** | Detalle por cliente con cuotas pagadas y por pagar |
| **Cuotas** | Cronograma de cuotas vencidas / por vencer / pendientes |
| **Cartera** | Vista de cartera completa con filtros |
| **Proyecciones** | Flujo futuro proyectado |
