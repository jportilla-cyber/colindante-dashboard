// ════════════════════════════════════════════════════════════
// CONFIGURACIÓN — reemplaza con tu ID real de Google Sheets
// ════════════════════════════════════════════════════════════
const SHEET_ID = '1VvhPWG1vByY0cm5NtDnuJZxbUGCSw730XUi5_8RWbgQ';
const SHEET_MC = 'Master_Clientes';
const SHEET_AB = 'Abonos';
const SHEET_CRON = 'Cronograma';
const SHEET_PROY = 'Proy_Flujo';
const SHEET_META = 'Meta';
const SHEET_CMETA = 'Comercial_Meta';
const SHEET_PREV_META = 'Preventa_Meta';
const TC = 3.477;

// ── Tema claro/oscuro ────────────────────────────────────────
function toggleTheme(){
  const isLight = document.body.classList.toggle('light');
  const btn = document.getElementById('btn-theme');
  if(btn) btn.textContent = isLight ? '☀' : '☽';
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  applyChartDefaults();
  if(typeof renderGraficos === 'function') renderGraficos();
  if(typeof renderResumen === 'function') renderResumen();
}

// Aplicar tema guardado al cargar
(function(){
  if(localStorage.getItem('theme') === 'light'){
    document.body.classList.add('light');
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('btn-theme');
      if(btn) btn.textContent = '☀';
    });
  }
})();

// ── Estado global ────────────────────────────────────────────
function applyChartDefaults(){
  const isLight = document.body.classList.contains('light');
  const cs = getComputedStyle(document.body);
  Chart.defaults.color       = isLight ? (cs.getPropertyValue('--text2').trim() || '#6B7280') : (cs.getPropertyValue('--text2').trim() || '#A0A8C0');
  Chart.defaults.borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)';
  Chart.defaults.font.family = cs.getPropertyValue('--font-sans').trim() || "'Inter', 'DM Sans', sans-serif";
  Chart.defaults.font.size   = 11;
}
applyChartDefaults();

let rawMC = [], rawAB = [], rawCron = [], rawProy = [], rawMeta = [], rawCMeta = [], rawPrevMeta = [], filtrado = [], filtradoCron = [];
let filCuota = '';
let filTipoCredito = '';
let chartsCreados = {};
let _caidasData = null;
let _stockDetalle = {};
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];

// ── Utilidades ───────────────────────────────────────────────
/**
 * Cuenta los desestimientos únicos basándose en Proyecto, Cliente y la unidad (DPTO, EST, DEP).
 * @param {Array<Object>} data - Los datos de la hoja de Abonos (rawAB).
 * @param {string} projectFilter - Filtro opcional por nombre de proyecto.
 * @returns {number} El número de desestimientos únicos.
 */
function getUniqueDesestimientosCount(data, projectFilter = '') {
  const uniqueDesestimientos = new Set();
  data.forEach(r => {
    const proyecto = str(r['PROYECTO']);
    if (projectFilter && proyecto !== projectFilter) return;

    const detalle = str(r['DETALLE']).toLowerCase();
    if (!detalle.includes('desestimiento')) return;

    const cliente = str(r['Nombre del Cliente']) || str(r['CLIENTE']);

    let unitIdentifier = '';
    if (str(r['DPTO']) !== '') unitIdentifier = `DPTO-${str(r['DPTO'])}`;
    else if (str(r['EST']) !== '') unitIdentifier = `EST-${str(r['EST'])}`;
    else if (str(r['DEP']) !== '') unitIdentifier = `DEP-${str(r['DEP'])}`;

    if (unitIdentifier !== '') {
      uniqueDesestimientos.add(`${proyecto}-${cliente}-${unitIdentifier}`);
    }
  });
  return uniqueDesestimientos.size;
}

const fmt = n => {
  if(!n && n!==0) return '—';
  const abs = Math.abs(n);
  if(abs>=1e6) return 'S/ '+(n/1e6).toFixed(2)+'M';
  if(abs>=1e3) return 'S/ '+Math.round(n).toLocaleString('es-PE');
  return 'S/ '+Math.round(n);
};
const num = v => parseFloat(String(v).replace(/,/g,''))||0;
const str = v => v ? String(v).trim() : '';

function pillHtml(s){
  const m={'VENDIDO':'pill-v','SEPARADO':'pill-s','BLOQUEADO':'pill-b','POR VENDER':'pill-p'};
  return `<span class="pill ${m[s]||'pill-p'}">${s}</span>`;
}

// ── Fetch Google Sheets ──────────────────────────────────────
async function fetchSheet(sheetName){
  const headersParam = (sheetName === 'Proy_Flujo' || sheetName === 'Meta' || sheetName === 'Comercial_Meta') ? '&headers=1' : '';
  const url=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}${headersParam}`;
  console.log(`⏳ Cargando hoja: ${sheetName}`);
  try {
    const res = await fetch(url);
    const text = await res.text();
    
    // Verificar si es una respuesta válida
    if (!text.includes('google.visualization.Query.setResponse')) {
      console.error(`❌ Hoja "${sheetName}" no encontrada o Sheet no es público. Respuesta:`, text.substring(0, 200));
      return [];
    }
    
    const json = JSON.parse(text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)[1]);
    
    if(!json.table||!json.table.rows) {
      console.warn(`⚠️ La hoja "${sheetName}" está vacía`);
      return [];
    }
    
    const cols = json.table.cols.map(c=>c.label||'');
    console.log(`✅ Hoja "${sheetName}": ${json.table.rows.length} filas, columnas: ${cols.join(', ')}`);
    
    return json.table.rows.map(r=>{
      const obj={};
      r.c.forEach((cell,i)=>{ obj[cols[i]] = cell ? (cell.v!==null&&cell.v!==undefined ? cell.v : '') : ''; });
      return obj;
    });
  } catch(e) {
    console.error(`❌ Error al cargar hoja "${sheetName}":`, e);
    return [];
  }
}

// ── Cargar datos ─────────────────────────────────────────────
async function cargarDatos(){
  const _spin = document.getElementById('spin-icon');
  if(_spin) _spin.classList.add('spinning');
  try{
    [rawMC, rawAB, rawCron, rawProy, rawMeta, rawCMeta, rawPrevMeta] = await Promise.all([
      fetchSheet(SHEET_MC), 
      fetchSheet(SHEET_AB), 
      fetchSheet(SHEET_CRON),
      fetchSheet(SHEET_PROY),
      fetchSheet(SHEET_META),
      fetchSheet(SHEET_CMETA),
      fetchSheet(SHEET_PREV_META)
    ]);
    
    // Poblar filtros
    const proyectos=[...new Set(rawMC.map(r=>str(r['PROYECTO'])).filter(Boolean))].sort();
    const selProy=document.getElementById('fil-proyecto');
    selProy.innerHTML='<option value="">Todos los proyectos</option>'+
      proyectos.map(p=>`<option value="${p}">${p}</option>`).join('');

    aplicarFiltros();
    const ahora=new Date();
    const _elFecha = document.getElementById('hdr-fecha');
    if(_elFecha) _elFecha.textContent =
      'Actualizado '+ahora.toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'})+
      ' '+ahora.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
    const _elFooter = document.getElementById('footer-ts');
    if(_elFooter) _elFooter.textContent =
      '◆ Colindante · Última actualización: '+ahora.toLocaleString('es-PE');
  }catch(e){
    console.error(e);
    ['resumen','proyectos','graficos','cobranza','cronograma','cartera','proyecciones','preventa'].forEach(p=>{
      const _el = document.getElementById(p+'-content');
      if(_el) _el.innerHTML =
        `<div class="estado"><div class="estado-icon">⚠️</div><div class="estado-msg">Error al cargar datos.<br>Verifica que el SHEET_ID sea correcto y el Sheet sea público.</div></div>`;
    });
  }
  if(_spin) _spin.classList.remove('spinning');
}

function aplicarFiltros(){
  const fp=document.getElementById('fil-proyecto').value;
  const fs=document.getElementById('fil-situacion').value;
  // filtrado: solo Departamentos (excluye Estacionamiento y Deposito)
  filtrado=rawMC.filter(r=>{
    if(str(r['INMUEBLE']) !== 'Departamento') return false;
    if(fp && str(r['PROYECTO'])!==fp) return false;
    if(fs && str(r['SITUACION'])!==fs) return false;
    return true;
  });
  // filtradoCron: solo Departamentos
  filtradoCron = rawCron.filter(r=>{
    if(str(r['INMUEBLE']) !== 'Departamento') return false;
    if(fp && str(r['PROYECTO'])!==fp) return false;
    if(fs && str(r['ESTADO VENTA'])!==fs) return false;
    return true;
  });
  // Resetear filtros especiales
  filCuota = '';
  window.filTipoCredito = '';
  renderResumen();
  renderProyectos();
  renderGraficos();
  renderCobranzaNueva();
  renderCronograma();
  renderCartera();
  renderProyecciones();
  renderPreventa();
  renderStock();
}

function setCuotaFiltro(valor, btn){
  filCuota = valor;
  document.querySelectorAll('.btn-cuota').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderCronograma();
}

function setTipoCredFiltro(valor, btn){
  window.filTipoCredito = valor;
  const todosLosBotones = btn.parentElement.querySelectorAll('button');
  todosLosBotones.forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderCobranzaNueva();
}

// ════════════════════════════════════════════════════════════
// PÁGINA 1: RESUMEN
// ════════════════════════════════════════════════════════════
function renderResumen(){
  // Destruir chart previo si existe
  if(chartsCreados['ch-situacion']){
    chartsCreados['ch-situacion'].destroy();
    delete chartsCreados['ch-situacion'];
  }
  const fp = document.getElementById('fil-proyecto').value;
  const inmuebles = filtrado;
  const total   = inmuebles.length;
  const vendido = inmuebles.filter(r=>str(r['SITUACION'])==='VENDIDO').length;
  const separado= inmuebles.filter(r=>str(r['SITUACION'])==='SEPARADO').length;
  const bloq    = inmuebles.filter(r=>str(r['SITUACION'])==='BLOQUEADO').length;
  const xvender = inmuebles.filter(r=>str(r['SITUACION'])==='POR VENDER').length;
  const pct     = total>0?Math.round(vendido/total*1000)/10:0;

  const activos = inmuebles.filter(r=>['VENDIDO','SEPARADO'].includes(str(r['SITUACION'])));
  const ingresos= activos.reduce((a,r)=>a+num(r['Ingresos  S/.']),0);
  const xCobrar = activos.reduce((a,r)=>a+num(r['Por Pagar  S/.']),0);
  const valVend = inmuebles.filter(r=>['VENDIDO','SEPARADO'].includes(str(r['SITUACION']))).reduce((a,r)=>a+num(r['VALOR S/']),0);
  const valVendidoSolo = inmuebles.filter(r=>str(r['SITUACION'])==='VENDIDO').reduce((a,r)=>a+num(r['VALOR S/']),0);
  const valPresupuestado = inmuebles.reduce((a,r)=>a+num(r['Presupuestado S/']),0);
  const pctValor = valPresupuestado > 0 ? Math.round(valVendidoSolo / valPresupuestado * 1000) / 10 : 0;

  const desestimientos = getUniqueDesestimientosCount(rawAB, fp);

  document.getElementById('resumen-content').innerHTML=`
    <div class="hero-banner">
      <div class="hero-banner-label">Portafolio Total</div>
      <div class="hero-banner-value">${total} <span style="font-size:16px;font-weight:400;color:var(--text2)">inmuebles</span></div>
      <div class="hero-banner-sub">
        <span>✅ Vendidos: <strong style="color:var(--verde)">${vendido}</strong></span>
        <span>🔶 Separados: <strong style="color:var(--amber)">${separado}</strong></span>
        <span>🔷 Por vender: <strong style="color:var(--text2)">${xvender}</strong></span>
      </div>
    </div>

    <div class="sec-label">Situación Comercial</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:10px; align-items:center;">
      <div class="prog-wrap" style="height:100%">
        <div class="prog-row">
          <span class="prog-label">% Comercializado</span>
          <span class="prog-pct">${pct}%</span>
        </div>
        <div class="prog-bg"><div class="prog-fill" style="width:${Math.max(pct,1)}%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:var(--text3)">
          <span>Bloqueados: ${bloq}</span><span>Activos: ${vendido+separado}</span>
        </div>
      </div>
      <div class="chart-card" style="padding:12px 16px; margin:0; display:flex; align-items:center; justify-content:center; gap:24px;">
        <div class="ch" style="height:90px; width:90px; flex-shrink:0;"><canvas id="ch-situacion"></canvas></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; font-size:11px;">
          <div class="legend-item" style="color:var(--text2)"><span class="legend-dot" style="background:var(--verde)"></span>Vendido<br><strong style="font-size:13px;color:var(--text);font-family:'Inter',sans-serif;">${vendido}</strong></div>
          <div class="legend-item" style="color:var(--text2)"><span class="legend-dot" style="background:var(--amber)"></span>Separado<br><strong style="font-size:13px;color:var(--text);font-family:'Inter',sans-serif;">${separado}</strong></div>
          <div class="legend-item" style="color:var(--text2)"><span class="legend-dot" style="background:var(--rojo)"></span>Bloqueado<br><strong style="font-size:13px;color:var(--text);font-family:'Inter',sans-serif;">${bloq}</strong></div>
          <div class="legend-item" style="color:var(--text2)"><span class="legend-dot" style="background:var(--text3)"></span>Por Vender<br><strong style="font-size:13px;color:var(--text);font-family:'Inter',sans-serif;">${xvender}</strong></div>
        </div>
      </div>
    </div>

    <div class="sec-label">Financiero</div>
    <div class="prog-wrap">
      <div class="prog-row">
        <span class="prog-label">Avance sobre Presupuesto</span>
        <span class="prog-pct">${pctValor}%</span>
      </div>
      <div class="prog-bg"><div class="prog-fill" style="width:${Math.max(pctValor,1)}%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:var(--text3)">
        <span>Vendido: <strong style="color:var(--verde)">${fmt(valVendidoSolo)}</strong></span><span>Presupuestado: <strong style="color:var(--text2)">${fmt(valPresupuestado)}</strong></span>
      </div>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
      <div class="kpi accent-blue"><div class="kpi-l">Valor negociado</div><div class="kpi-v money" style="color:var(--accent)">${fmt(valVend)}</div><div class="kpi-s">vendidos + separados</div></div>
      <div class="kpi accent-gold"><div class="kpi-l">Ingresos recibidos</div><div class="kpi-v money" style="color:var(--gold)">${fmt(ingresos)}</div></div>
      <div class="kpi accent-amber"><div class="kpi-l">Por cobrar</div><div class="kpi-v warn money">${fmt(xCobrar)}</div></div>
    </div>
    <div class="kpi-grid" style="margin-top:0">
      <div class="kpi accent-blue"><div class="kpi-l">Unidades activas</div><div class="kpi-v">${activos.length}</div><div class="kpi-s">vendidos + separados</div></div>
      <div class="kpi accent-rojo"><div class="kpi-l">Desestimientos</div><div class="kpi-v danger">${desestimientos}</div><div class="kpi-s">registros en abonos</div></div>
    </div>
  `;
  renderProyectos();

  // --- Renderizar el nuevo Doughnut Chart ---
  const isLight = document.body.classList.contains('light');
  const C = {
    vendido:   isLight ? '#1A7A48' : '#34C77B',
    separado:  isLight ? '#B45309' : '#F59E0B',
    porVender: isLight ? '#9CA3AF' : '#606880',
    bloqueado: isLight ? '#C0392B' : '#F05252',
  };

  chartsCreados['ch-situacion'] = new Chart(document.getElementById('ch-situacion'), {
    type: 'doughnut',
    data: {
      labels: ['Vendido', 'Separado', 'Por Vender', 'Bloqueado'],
      datasets: [{
        data: [vendido, separado, xvender, bloq],
        backgroundColor: [C.vendido, C.separado, C.porVender, C.bloqueado],
        borderWidth: 2,
        borderColor: isLight ? '#F4F6FA' : '#0C0E14',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} unidades` } }
      }
    }
  });
}

// ════════════════════════════════════════════════════════════
// PÁGINA 2: PROYECTOS
// ════════════════════════════════════════════════════════════
function renderProyectos(){
  const proyectos=[...new Set(rawMC.map(r=>str(r['PROYECTO'])).filter(Boolean))].sort();
  const fp=document.getElementById('fil-proyecto').value;
  const lista=fp?[fp]:proyectos;

  let html='<div class="sec-label" style="margin-top:24px">Detalle por Proyecto</div>';
  lista.forEach(p=>{
    const dptos=filtrado.filter(r=>str(r['PROYECTO'])===p);
    if(!dptos.length) return;
    const v=dptos.filter(r=>str(r['SITUACION'])==='VENDIDO').length;
    const s=dptos.filter(r=>str(r['SITUACION'])==='SEPARADO').length;
    const b=dptos.filter(r=>str(r['SITUACION'])==='BLOQUEADO').length;
    const pv=dptos.filter(r=>str(r['SITUACION'])==='POR VENDER').length;
    const t=dptos.length;
    const pct=t>0?Math.round(v/t*1000)/10:0;
    const ingresos=filtrado.filter(r=>str(r['PROYECTO'])===p&&['VENDIDO','SEPARADO'].includes(str(r['SITUACION']))).reduce((a,r)=>a+num(r['Ingresos  S/.']),0);
    const xCobrar=filtrado.filter(r=>str(r['PROYECTO'])===p&&['VENDIDO','SEPARADO'].includes(str(r['SITUACION']))).reduce((a,r)=>a+num(r['Por Pagar  S/.']),0);
    const valVendidoProyecto=filtrado.filter(r=>str(r['PROYECTO'])===p&&str(r['SITUACION'])==='VENDIDO').reduce((a,r)=>a+num(r['VALOR S/']),0);
    const valVendProyecto = dptos.filter(r=>['VENDIDO','SEPARADO'].includes(str(r['SITUACION']))).reduce((a,r)=>a+num(r['VALOR S/']),0);
    const valPresupuestadoProy = dptos.reduce((a,r)=>a+num(r['Presupuestado S/']),0);
    const desest = getUniqueDesestimientosCount(rawAB, p);
    const vendidosDptos = dptos.filter(r=>str(r['SITUACION'])==='VENDIDO');
    const totalAreaVendida = vendidosDptos.reduce((a,r)=>a+num(r['Area  Ocupada']),0);
    const precioM2 = totalAreaVendida>0 ? Math.round(valVendidoProyecto/totalAreaVendida) : null;
    const metaPrevProy = rawPrevMeta.find(m=>str(m['PROYECTO'])===p);
    const fechaInicioVenta = metaPrevProy ? parseFechaExcel(metaPrevProy['INICIO DE VENTA']) : null;
    const ahora = new Date();
    const mesesVenta = fechaInicioVenta
      ? Math.max(1, (ahora.getFullYear()-fechaInicioVenta.getFullYear())*12 + (ahora.getMonth()-fechaInicioVenta.getMonth()))
      : null;
    const velocidadVentas = (mesesVenta!==null && v>0) ? (v/mesesVenta).toFixed(1) : null;

    const accentColor = pct>=10 ? 'accent-verde' : pct>=5 ? 'accent-amber' : 'accent-rojo';

    html+=`
    <div style="margin-bottom:14px">
      <!-- Header del proyecto -->
      <div style="background:var(--surface2);border-radius:var(--radius) var(--radius) 0 0;padding:12px 14px;border:1px solid var(--border);border-bottom:none;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:700;color:var(--text);letter-spacing:-.01em">${p}</span>
        <span style="font-size:11px;font-weight:700;color:${pct>=10?'var(--verde)':pct>=5?'var(--amber)':'var(--rojo)'}">
          ${pct}% comercializado
        </span>
      </div>

      <!-- Barra de avance -->
      <div style="background:var(--surface);border:1px solid var(--border);border-top:none;padding:8px 14px 12px">
        <div class="prog-bg"><div class="prog-fill" style="width:${Math.max(pct,0.5)}%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--text3)">
          <span>Vendidos: <strong style="color:var(--verde)">${v}</strong></span>
          <span>Separados: <strong style="color:var(--amber)">${s}</strong></span>
          <span>Por vender: <strong style="color:var(--text2)">${pv}</strong></span>
          <span>Bloqueados: <strong style="color:${b>0?'var(--rojo)':'var(--text3)'}">${b}</strong></span>
        </div>
      </div>

      <!-- Barra de avance financiero por proyecto -->
      <div class="prog-wrap" style="border-radius:0;border-top:none;border-bottom:none;">
        <div class="prog-row">
          <span class="prog-label">Avance sobre Presupuesto</span>
          <span class="prog-pct">${valPresupuestadoProy > 0 ? Math.round(valVendidoProyecto / valPresupuestadoProy * 1000) / 10 : 0}%</span>
        </div>
        <div class="prog-bg"><div class="prog-fill" style="width:${Math.max(valPresupuestadoProy > 0 ? (valVendidoProyecto / valPresupuestadoProy * 100) : 0, 1)}%"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:var(--text3)">
          <span>Vendido: <strong style="color:var(--verde)">${fmt(valVendidoProyecto)}</strong></span><span>Presupuestado: <strong style="color:var(--text2)">${fmt(valPresupuestadoProy)}</strong></span>
        </div>
      </div>

      <!-- KPIs financieros -->
      <div class="kpi-grid" style="margin-top:0;border-radius:0;gap:1px">
        <div class="kpi ${accentColor}" style="border-radius:0;border-top:none"><div class="kpi-l">Total inmuebles</div><div class="kpi-v">${t}</div></div>
        <div class="kpi accent-blue" style="border-radius:0;border-top:none"><div class="kpi-l">Valor Negociado</div><div class="kpi-v money" style="color:var(--accent)">${fmt(valVendProyecto)}</div></div>
        <div class="kpi accent-gold" style="border-radius:0;border-top:none"><div class="kpi-l">Ingresos recibidos</div><div class="kpi-v money" style="color:var(--gold)">${fmt(ingresos)}</div></div>
        <div class="kpi accent-amber" style="border-radius:0;border-top:none"><div class="kpi-l">Por cobrar</div><div class="kpi-v warn money">${fmt(xCobrar)}</div></div>
      </div>

      <!-- Precio por m² y velocidad de ventas -->
      <div style="background:var(--surface);border:1px solid var(--border);border-top:none;padding:10px 14px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:10px;color:var(--text3);font-weight:500">Precio promedio/m² vendido</span>
          <span style="font-size:15px;font-weight:700;font-family:var(--font-mono);color:var(--accent)">
            ${precioM2!==null ? 'S/ '+precioM2.toLocaleString('es-PE') : '—'}
          </span>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;border-left:1px solid var(--border);padding-left:12px">
          <span style="font-size:10px;color:var(--text3);font-weight:500">Velocidad de ventas</span>
          <span style="font-size:15px;font-weight:700;font-family:var(--font-mono);color:var(--gold)">
            ${velocidadVentas!==null ? velocidadVentas+' <span style="font-size:11px;font-weight:400;color:var(--text3)">dpto/mes</span>' : '—'}
          </span>
        </div>
      </div>

      <!-- Desestimientos -->
      <div style="background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius) var(--radius);padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:var(--text3)">Desestimientos</span>
        <span style="font-size:16px;font-weight:700;color:${desest>0?'var(--rojo)':'var(--verde)'}">
          ${desest} ${desest>0?'⚠️':'✓'}
        </span>
      </div>
    </div>`;
  });

  document.getElementById('proyectos-content').innerHTML = lista.length ? html : '';
}

// ════════════════════════════════════════════════════════════
// CAÍDAS / DESISTIMIENTOS — datos y modal
// ════════════════════════════════════════════════════════════
function buildCaidasMensualesData() {
  const fp = document.getElementById('fil-proyecto').value;
  const uniqueMap = {};

  rawAB.forEach(r => {
    const proyecto = str(r['PROYECTO']);
    if (fp && proyecto !== fp) return;

    const detalle = str(r['DETALLE']).toLowerCase();
    if (!detalle.includes('desestimiento')) return;

    const cliente = str(r['Nombre del Cliente']) || str(r['CLIENTE']);

    let unitStr = '', unitType = '';
    if (str(r['DPTO']) !== '') { unitStr = str(r['DPTO']); unitType = 'Dpto'; }
    else if (str(r['EST']) !== '') { unitStr = str(r['EST']); unitType = 'Est'; }
    else if (str(r['DEP']) !== '') { unitStr = str(r['DEP']); unitType = 'Dep'; }
    if (!unitStr) return;

    const key = `${proyecto}|${cliente}|${unitType}-${unitStr}`;
    if (uniqueMap[key]) return; // ya registrado

    const rawFecha = r['FECHA DE CAIDA'] || r['FECHA  DE CAIDA'] || r['Fecha de Caida'] ||
                     r['FECHA_DE_CAIDA'] || r['Fecha De Caida'];
    let fecha = rawFecha ? parseFechaExcel(rawFecha) : null;

    // Fallback a columnas Mes / Año si no hay fecha de caída
    if (!fecha) {
      const m = num(r['Mes']), y = num(r['Año']);
      if (m >= 1 && m <= 12 && y > 2000) fecha = new Date(y, m - 1, 1);
    }

    uniqueMap[key] = { proyecto, cliente, unidad: `${unitType} ${unitStr}`, fecha, tieneFechaCaida: !!rawFecha };
  });

  const meses = {};
  let sinFecha = 0;

  Object.values(uniqueMap).forEach(d => {
    if (!d.fecha) { sinFecha++; return; }
    const mKey = `${d.fecha.getFullYear()}-${String(d.fecha.getMonth() + 1).padStart(2, '0')}`;
    if (!meses[mKey]) meses[mKey] = { count: 0, items: [] };
    meses[mKey].count++;
    meses[mKey].items.push(d);
  });

  return { meses, sinFecha, total: Object.values(uniqueMap).length };
}

function abrirModalCaidas(key, label) {
  if (!_caidasData || !_caidasData.meses[key]) return;
  const mes = _caidasData.meses[key];
  document.getElementById('modal-caidas-title').textContent = `Desistimientos · ${label}`;

  const items = [...mes.items].sort((a, b) => a.proyecto.localeCompare(b.proyecto));

  let bodyHtml = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div class="ck" style="flex:1;min-width:130px">
        <div class="ck-l">Caídas en este mes</div>
        <div class="ck-v" style="color:var(--rojo);font-size:24px">${mes.count}</div>
      </div>
    </div>
    <div class="tbl-wrap">
      <div class="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th>Proyecto</th>
              <th>Cliente</th>
              <th>Unidad</th>
              <th>Fecha de caída</th>
            </tr>
          </thead>
          <tbody>`;

  items.forEach(d => {
    const fStr = d.fecha
      ? d.fecha.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
    const fColor = d.tieneFechaCaida ? 'var(--rojo)' : 'var(--text3)';
    bodyHtml += `
      <tr>
        <td style="font-weight:600;color:var(--text)">${d.proyecto}</td>
        <td>${d.cliente}</td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--text3)">${d.unidad}</td>
        <td style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:${fColor}">${fStr}${!d.tieneFechaCaida ? ' <span style="opacity:.6;font-weight:400">(estimada)</span>' : ''}</td>
      </tr>`;
  });

  bodyHtml += `</tbody></table></div></div>`;
  document.getElementById('modal-caidas-body').innerHTML = bodyHtml;
  document.getElementById('modal-caidas').classList.add('visible');
}

function cerrarModalCaidas(event) {
  if (!event || event.target.id === 'modal-caidas' || event.target.classList.contains('modal-close')) {
    document.getElementById('modal-caidas').classList.remove('visible');
  }
}

// ════════════════════════════════════════════════════════════
// PÁGINA 3: GRÁFICOS
// ════════════════════════════════════════════════════════════
function renderGraficos(){
  const fp = document.getElementById('fil-proyecto').value;

  // ── Paleta de colores ─────────────────────────────────────
  const isLight = document.body.classList.contains('light');
  const C = {
    ventas:    '#34C77B',
    verde:     '#34C77B',
    ingresos:  '#C9A84C',
    proyVentas:'#4A90D9',
    proyIngr:  '#A78BFA',
    acumReal:  '#F05252',
    acumProy:  '#4A90D9',
    acumMeta:  '#C9A84C',
    grid: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,.06)',
    tick: isLight ? '#9CA3AF' : '#606880'
  };

  // ── Helpers de fecha ─────────────────────────────────────
  // Genera array de claves "YYYY-MM" desde la primera fecha de rawAB/rawMC hasta 12 meses adelante
  function buildMesKeys() {
    const all = [];
    rawMC.forEach(r => {
      const m = num(r['MES DE VENTA']), y = num(r['AÑO DE VENTA']);
      if(m>=1&&m<=12&&y>2000) all.push(`${y}-${String(m).padStart(2,'0')}`);
    });
    rawAB.forEach(r => {
      const m = num(r['Mes']), y = num(r['Año']);
      if(m>=1&&m<=12&&y>2000) all.push(`${y}-${String(m).padStart(2,'0')}`);
    });
    rawProy.forEach(r => {
      Object.keys(r).forEach(col => {
        const match = col.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if(match) {
          let m = parseInt(match[2]), y = parseInt(match[3]);
          if(y<100) y+=2000;
          if(num(r[col])>0) all.push(`${y}-${String(m).padStart(2,'0')}`);
        }
      });
    });
    // Incluir fechas de rawCMeta (proyectos nuevos sin ventas aún tienen meta comercial)
    if(rawCMeta.length > 0) {
      const _fc = Object.keys(rawCMeta[0])[0];
      const _bm = {ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12};
      rawCMeta.forEach(r => {
        const v = r[_fc];
        let m = null, y = null;
        if(typeof v === 'string' && v.startsWith('Date(')) {
          const p = v.substring(5, v.length-1).split(',');
          y = parseInt(p[0]); m = parseInt(p[1])+1;
        } else if(typeof v === 'string' && v.trim()) {
          const pts = v.trim().toLowerCase().split('-');
          m = _bm[pts[0]]; y = parseInt(pts[1]);
          if(y && y < 100) y += 2000;
        } else if(typeof v === 'number' && v > 0) {
          const d = new Date((v - 25569) * 86400 * 1000);
          y = d.getUTCFullYear(); m = d.getUTCMonth()+1;
        }
        if(m>=1&&m<=12&&y>2000) all.push(`${y}-${String(m).padStart(2,'0')}`);
      });
    }
    if(!all.length) return [];
    all.sort();
    const minKey = all[0];
    // Extender hasta 12 meses desde hoy
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth()+1;
    const maxKey = `${y+1}-${String(m).padStart(2,'0')}`;
    const keys = [];
    let [cy,cm] = minKey.split('-').map(Number);
    const [ey,em] = maxKey.split('-').map(Number);
    while(cy<ey || (cy===ey&&cm<=em)) {
      keys.push(`${cy}-${String(cm).padStart(2,'0')}`);
      cm++; if(cm>12){cm=1;cy++;}
    }
    return keys;
  }

  const mesKeys = buildMesKeys();
  const mesLabels = mesKeys.map(k => {
    const [y,m] = k.split('-');
    return MESES[parseInt(m)-1]+'-'+String(y).slice(-2);
  });

  // ── 1. Ventas Reales mensuales (de filtrado — respeta todos los filtros globales) ─
  const ventasRealesU = {}, ventasRealesS = {};
  filtrado.filter(r => str(r['SITUACION'])==='VENDIDO').forEach(r => {
    const m = num(r['MES DE VENTA']), y = num(r['AÑO DE VENTA']);
    if(m>=1&&m<=12&&y>2000) {
      const k = `${y}-${String(m).padStart(2,'0')}`;
      ventasRealesU[k] = (ventasRealesU[k]||0) + 1;
      ventasRealesS[k] = (ventasRealesS[k]||0) + num(r['VALOR S/']);
    }
  });

  // ── 2. Ingresos Reales mensuales (de rawAB — solo Departamentos) ──
  const ingresosRealesS = {};
  rawAB.filter(r => str(r['DPTO']) !== '').forEach(r => {
    if(fp && str(r['PROYECTO'])!==fp) return;
    const m = num(r['Mes']), y = num(r['Año']);
    const monto = (num(r['INGRESO S/'])||0) + (num(r['INGRESO US$'])||0)*(num(r['TC'])||TC);
    if(m>=1&&m<=12&&y>2000&&monto>0) {
      const k = `${y}-${String(m).padStart(2,'0')}`;
      ingresosRealesS[k] = (ingresosRealesS[k]||0) + monto;
    }
  });

  // ── 3. Ventas Proyectadas mensuales (de rawProy - no vendidos) ─
  const ventasProyU = {}, ventasProyS = {};
  rawProy.forEach(r => {
    if(fp && str(r['PROYECTO']||r['Proyecto'])!==fp) return;
    if(str(r['Estatus']).toUpperCase()==='VENDIDO') return;
    const inicio = r['Inicio de Venta Proy.'];
    let k = null;
    if(typeof inicio==='string'&&inicio.startsWith('Date(')) {
      const p=inicio.substring(5,inicio.length-1).split(',');
      k=`${p[0]}-${String(parseInt(p[1])+1).padStart(2,'0')}`;
    } else if(inicio) {
      const d=new Date(inicio);
      if(!isNaN(d)) k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    if(k) {
      ventasProyU[k] = (ventasProyU[k]||0)+1;
      ventasProyS[k] = (ventasProyS[k]||0)+num(r['Precio Real']);
    }
  });

  // ── 4. Ingresos Proyectados mensuales (columnas fecha de rawProy no vendidos + rawCron POR PAGAR) ─
  const ingresosProyS = {};
  rawProy.forEach(r => {
    if(fp && str(r['PROYECTO']||r['Proyecto'])!==fp) return;
    if(str(r['Estatus']).toUpperCase()==='VENDIDO') return;
    Object.keys(r).forEach(col => {
      const match = col.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if(match) {
        let m=parseInt(match[2]), y=parseInt(match[3]);
        if(y<100) y+=2000;
        const monto=num(r[col]);
        if(monto>0) {
          const k=`${y}-${String(m).padStart(2,'0')}`;
          ingresosProyS[k]=(ingresosProyS[k]||0)+monto;
        }
      }
    });
  });
  rawCron.forEach(r => {
    if(fp && str(r['PROYECTO']||r['Proyecto'])!==fp) return;
    if(str(r['ESTADO VENTA'])!=='VENDIDO') return;
    if(str(r['ESTADO'])!=='Por Pagar') return;
    const fecha = parseFechaExcel(r['Fecha Cuota']);
    if(fecha) {
      const k=`${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}`;
      ingresosProyS[k]=(ingresosProyS[k]||0)+num(r['Monto Cuota']);
    }
  });

  // ── Meta Comercial — calculada antes de activeKeys para incluir sus meses ──
  const metaComercialU = {};
  if(rawCMeta.length > 0) {
    const _cFechaCol = Object.keys(rawCMeta[0])[0];
    const _cProjCols = Object.keys(rawCMeta[0]).slice(1);
    const _cMeses = {ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12};
    rawCMeta.forEach(r => {
      let k = null;
      const v = r[_cFechaCol];
      if(typeof v === 'string' && v.startsWith('Date(')) {
        const p = v.substring(5, v.length-1).split(',');
        k = `${p[0]}-${String(parseInt(p[1])+1).padStart(2,'0')}`;
      } else if(typeof v === 'string' && v.trim()) {
        const parts = v.trim().toLowerCase().split('-');
        const mesNum = _cMeses[parts[0]];
        let anio = parseInt(parts[1]);
        if(mesNum && !isNaN(anio)) {
          if(anio < 100) anio += 2000;
          k = `${anio}-${String(mesNum).padStart(2,'0')}`;
        }
      } else if(typeof v === 'number') {
        const d = new Date((v - 25569) * 86400 * 1000);
        k = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      }
      if(!k) return;
      let total = 0;
      _cProjCols.forEach(col => {
        if(fp && col.trim() !== fp) return;
        total += num(r[col]);
      });
      metaComercialU[k] = (metaComercialU[k] || 0) + total;
    });
  }

  // ── Filtrar keys con algún dato (incluye meses de meta comercial) ──
  const activeKeys = mesKeys.filter(k =>
    ventasRealesU[k]||ventasRealesS[k]||ingresosRealesS[k]||
    ventasProyU[k]||ventasProyS[k]||ingresosProyS[k]||metaComercialU[k]
  );
  const activeLabels = activeKeys.map(k => {
    const [y,m] = k.split('-');
    return MESES[parseInt(m)-1]+'-'+String(y).slice(-2);
  });

  // ── Acumulados desde rawMeta (para gráficos 3 y 4) ───────
  const metaVentasProyU = {}, metaVentasProyS = {}, metaIngresosProyS = {};

  // Detectar dinámicamente la columna de proyecto en rawMeta
  let metaProyCol = null;
  if(rawMeta.length > 0) {
    const metaKeys = Object.keys(rawMeta[0]);
    const proyKnown = new Set(rawMC.map(r=>str(r['PROYECTO'])).filter(Boolean));
    // Primero intentar nombres comunes
    for(const c of ['PROYECTO','Proyecto','proyecto','PROYECTO ','Proyecto ']) {
      if(metaKeys.includes(c) && rawMeta.slice(0,15).some(r=>proyKnown.has(str(r[c])))) {
        metaProyCol = c; break;
      }
    }
    // Si no, escanear todas las columnas buscando valores que coincidan con proyectos conocidos
    if(!metaProyCol) {
      for(const k of metaKeys) {
        if(rawMeta.slice(0,15).some(r=>proyKnown.has(str(r[k])))) {
          metaProyCol = k; break;
        }
      }
    }
    console.log('rawMeta: columna proyecto →', metaProyCol, '| columnas:', metaKeys.join(', '));
  }

  rawMeta.forEach(r => {
    if(fp) {
      const proyMeta = metaProyCol ? str(r[metaProyCol]) : '';
      if(metaProyCol && proyMeta !== fp) return;
    }
    // Ventas proyectadas por mes de inicio
    const inicio = r['Inicio de Venta Proy.'];
    let k = null;
    if(typeof inicio==='string'&&inicio.startsWith('Date(')) {
      const p=inicio.substring(5,inicio.length-1).split(',');
      k=`${p[0]}-${String(parseInt(p[1])+1).padStart(2,'0')}`;
    } else if(typeof inicio==='number') {
      const d = parseFechaExcel(inicio);
      if(d) k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    } else if(inicio) {
      const d=new Date(inicio);
      if(!isNaN(d)) k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    if(k) {
      metaVentasProyU[k] = (metaVentasProyU[k]||0)+1;
      metaVentasProyS[k] = (metaVentasProyS[k]||0)+num(r['Precio Real']);
    }
    // Ingresos proyectados por columnas de fecha
    Object.keys(r).forEach(col => {
      const match = col.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if(match) {
        let m=parseInt(match[2]), y=parseInt(match[3]);
        if(y<100) y+=2000;
        const monto=num(r[col]);
        if(monto>0) {
          const mk=`${y}-${String(m).padStart(2,'0')}`;
          metaIngresosProyS[mk]=(metaIngresosProyS[mk]||0)+monto;
        }
      }
    });
  });

  // Acumulados Meta
  let acMetaVU=0, acMetaIS=0;
  const acMetaVUArr=[], acMetaISArr=[];
  activeKeys.forEach(k => {
    acMetaVU  += metaVentasProyU[k]||0;  acMetaVUArr.push(acMetaVU);
    acMetaIS  += metaIngresosProyS[k]||0; acMetaISArr.push(Math.round(acMetaIS));
  });

  // ── Acumulados ────────────────────────────────────────────
  const mesActualKey = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  let acVRU=0,acVRealS=0,acVProyU=0,acVProyS=0,acIRealS=0,acIProyS=0;
  const acVRealUArr=[],acVProyUArr=[],acVRealSArr=[],acVProySArr=[],acIRealArr=[],acIProyArr=[];
  activeKeys.forEach(k => {
    acVRU  += ventasRealesU[k]||0;  acVRealUArr.push(k <= mesActualKey ? acVRU : null);
    acVProyU += ventasProyU[k]||0;  acVProyUArr.push(acVProyU);
    acVRealS += ventasRealesS[k]||0; acVRealSArr.push(k <= mesActualKey ? Math.round(acVRealS) : null);
    acVProyS += ventasProyS[k]||0;  acVProySArr.push(Math.round(acVProyS));
    acIRealS += ingresosRealesS[k]||0; acIRealArr.push(k <= mesActualKey ? Math.round(acIRealS) : null);
    acIProyS += ingresosProyS[k]||0;  acIProyArr.push(Math.round(acIProyS));
  });

  // ── Lectura: valores de mes actual y mes anterior ─────────
  const _dp = new Date(); _dp.setMonth(_dp.getMonth()-1);
  const mesPasadoKey = `${_dp.getFullYear()}-${String(_dp.getMonth()+1).padStart(2,'0')}`;
  const idxActual = activeKeys.indexOf(mesActualKey);
  const idxPasado = activeKeys.indexOf(mesPasadoKey);
  const mesActualLabel = idxActual>=0 ? activeLabels[idxActual] : '';
  const mesPasadoLabel = idxPasado>=0 ? activeLabels[idxPasado] : '';
  const lU = {
    metaHoy:    idxActual>=0 && acMetaVUArr[idxActual]!=null ? acMetaVUArr[idxActual] : null,
    metaPasado: idxPasado>=0 && acMetaVUArr[idxPasado]!=null ? acMetaVUArr[idxPasado] : null,
    realHoy:    idxActual>=0 && acVRealUArr[idxActual]!=null  ? acVRealUArr[idxActual]  : null,
    realPasado: idxPasado>=0 && acVRealUArr[idxPasado]!=null  ? acVRealUArr[idxPasado]  : null,
  };
  const lI = {
    metaHoy:    idxActual>=0 && acMetaISArr[idxActual]!=null ? acMetaISArr[idxActual] : null,
    metaPasado: idxPasado>=0 && acMetaISArr[idxPasado]!=null ? acMetaISArr[idxPasado] : null,
    realHoy:    idxActual>=0 && acIRealArr[idxActual]!=null  ? acIRealArr[idxActual]  : null,
    realPasado: idxPasado>=0 && acIRealArr[idxPasado]!=null  ? acIRealArr[idxPasado]  : null,
  };

  // ── Textos de interpretación para gráficos 3 y 4 ─────────
  const _pctLec = (r,m) => (r!=null&&m!=null&&m>0) ? Math.round(Math.abs(r/m-1)*1000)/10 : null;
  const _colLec = (r,m) => (r!=null&&m!=null&&r>=m) ? 'var(--verde)' : 'var(--rojo)';
  const _dirLec = (r,m) => (r!=null&&m!=null&&r>=m) ? 'por encima' : 'por debajo';

  let interp3 = '';
  if(lU.realHoy!=null && lU.metaHoy!=null) {
    const p = _pctLec(lU.realHoy, lU.metaHoy);
    interp3 += `A día de hoy se tienen <strong style="color:${C.acumReal}">${lU.realHoy} unidades</strong> vendidas acumuladas, la proyección para ${mesActualLabel||'este mes'} es de <strong style="color:${C.acumMeta}">${lU.metaHoy} unidades</strong>, por lo que se encuentra <strong style="color:${_colLec(lU.realHoy,lU.metaHoy)}">${p!=null?p+'%':'—'} ${_dirLec(lU.realHoy,lU.metaHoy)} de la meta</strong>.`;
  }
  if(lU.realPasado!=null && lU.metaPasado!=null) {
    const p = _pctLec(lU.realPasado, lU.metaPasado);
    interp3 += ` El mes pasado${mesPasadoLabel?' ('+mesPasadoLabel+')':''} se tenían <strong style="color:${C.acumReal}">${lU.realPasado} ventas</strong> acumuladas y la proyección era de <strong style="color:${C.acumMeta}">${lU.metaPasado} unidades</strong>, cerrando el mes <strong style="color:${_colLec(lU.realPasado,lU.metaPasado)}">${p!=null?p+'%':'—'} ${_dirLec(lU.realPasado,lU.metaPasado)} de la meta</strong>.`;
  }
  if(!interp3) interp3 = 'Sin datos suficientes para la interpretación.';

  let interp4 = '';
  if(lI.realHoy!=null && lI.metaHoy!=null) {
    const diff4 = lI.realHoy - lI.metaHoy;
    const col4  = diff4>=0 ? 'var(--verde)' : 'var(--rojo)';
    const dir4  = diff4>=0 ? 'por encima' : 'por debajo';
    interp4 = `Se tienen ingresos acumulados de <strong style="color:${C.acumReal}">${fmt(lI.realHoy)}</strong> y la meta acumulada es de <strong style="color:${C.acumMeta}">${fmt(lI.metaHoy)}</strong>, estando <strong style="color:${col4}">${fmt(Math.abs(diff4))} ${dir4} de la meta</strong>.`;
  }
  if(!interp4) interp4 = 'Sin datos suficientes para la interpretación.';

  // acMCUArr: acumulado de meta comercial usando activeKeys ya expandido
  let acMCU = 0;
  const acMCUArr = [];
  activeKeys.forEach(k => {
    acMCU += metaComercialU[k] || 0;
    acMCUArr.push(acMCU);
  });

  // ── Interpretación: Ventas Mensuales Comercial vs Real ────
  let interpMensual = '';
  {
    const realMes = ventasRealesU[mesActualKey] || 0;
    const metaMes = metaComercialU[mesActualKey] || 0;
    const realPas = ventasRealesU[mesPasadoKey] || 0;
    const metaPas = metaComercialU[mesPasadoKey] || 0;
    if(metaMes > 0 || realMes > 0) {
      const p = metaMes > 0 ? _pctLec(realMes, metaMes) : null;
      interpMensual += `Este mes${mesActualLabel?' ('+mesActualLabel+')':''} se han vendido <strong style="color:${C.ventas}">${realMes} unidad${realMes!==1?'es':''}</strong>, la meta mensual es de <strong style="color:#A78BFA">${metaMes} unidad${metaMes!==1?'es':''}</strong>${p!=null?', estando <strong style="color:'+_colLec(realMes,metaMes)+'">'+p+'% '+_dirLec(realMes,metaMes)+' de la meta</strong>':''}.`;
    }
    if(metaPas > 0 || realPas > 0) {
      const p = metaPas > 0 ? _pctLec(realPas, metaPas) : null;
      interpMensual += ` El mes pasado${mesPasadoLabel?' ('+mesPasadoLabel+')':''} se vendieron <strong style="color:${C.ventas}">${realPas} unidad${realPas!==1?'es':''}</strong>, la meta era de <strong style="color:#A78BFA">${metaPas} unidad${metaPas!==1?'es':''}</strong>${p!=null?', cerrando <strong style="color:'+_colLec(realPas,metaPas)+'">'+p+'% '+_dirLec(realPas,metaPas)+' de la meta</strong>':''}.`;
    }
    if(!interpMensual) interpMensual = 'Sin datos suficientes para la interpretación.';
  }

  // ── Interpretación: Unidades Acumuladas Comercial vs Real ─
  let interpComAcum = '';
  {
    const acRealH = idxActual>=0 && acVRealUArr[idxActual]!=null ? acVRealUArr[idxActual] : null;
    const acMetaH = idxActual>=0 ? acMCUArr[idxActual] : null;
    const acRealP = idxPasado>=0 && acVRealUArr[idxPasado]!=null ? acVRealUArr[idxPasado] : null;
    const acMetaP = idxPasado>=0 ? acMCUArr[idxPasado] : null;
    if(acRealH!=null && acMetaH!=null) {
      const p = _pctLec(acRealH, acMetaH);
      interpComAcum += `A día de hoy se tienen <strong style="color:${C.verde}">${acRealH} unidades</strong> vendidas acumuladas, la proyección comercial acumulada para ${mesActualLabel||'este mes'} es de <strong style="color:#A78BFA">${acMetaH} unidades</strong>, por lo que se encuentra <strong style="color:${_colLec(acRealH,acMetaH)}">${p!=null?p+'%':'—'} ${_dirLec(acRealH,acMetaH)} de la meta</strong>.`;
    }
    if(acRealP!=null && acMetaP!=null) {
      const p = _pctLec(acRealP, acMetaP);
      interpComAcum += ` El mes pasado${mesPasadoLabel?' ('+mesPasadoLabel+')':''} se tenían <strong style="color:${C.verde}">${acRealP} ventas</strong> acumuladas y la proyección era de <strong style="color:#A78BFA">${acMetaP} unidades</strong>, cerrando el mes <strong style="color:${_colLec(acRealP,acMetaP)}">${p!=null?p+'%':'—'} ${_dirLec(acRealP,acMetaP)} de la meta</strong>.`;
    }
    if(!interpComAcum) interpComAcum = 'Sin datos suficientes para la interpretación.';
  }

  // ── KPIs resumen ──────────────────────────────────────────
  const totalVR = Object.values(ventasRealesS).reduce((a,b)=>a+b,0);
  const totalVP = Object.values(ventasProyS).reduce((a,b)=>a+b,0);
  const totalIR = Object.values(ingresosRealesS).reduce((a,b)=>a+b,0);
  const totalIP = Object.values(ingresosProyS).reduce((a,b)=>a+b,0);
  const totalUVR = Object.values(ventasRealesU).reduce((a,b)=>a+b,0);
  const totalUVP = Object.values(ventasProyU).reduce((a,b)=>a+b,0);

  // ── Destruir charts previos ───────────────────────────────
  ['ch-vr-ingr','ch-proy-ingr','ch-comercial-meta-mensual','ch-comercial-meta','ch-acum-unid','ch-acum-s','ch-caidas'].forEach(id=>{
    if(chartsCreados[id]){chartsCreados[id].destroy();delete chartsCreados[id];}
  });

  document.getElementById('graficos-content').innerHTML = `
    <!-- KPIs -->
    <div class="kpi-grid" style="margin-bottom:16px">
      <div class="kpi"><div class="kpi-l">Unid. Vendidas (Real)</div><div class="kpi-v ok">${totalUVR}</div></div>
      <div class="kpi"><div class="kpi-l">Unid. Proy. (No Vendidas)</div><div class="kpi-v">${totalUVP}</div></div>
      <div class="kpi"><div class="kpi-l">Ventas Reales S/</div><div class="kpi-v ok">${fmt(totalVR)}</div></div>
      <div class="kpi"><div class="kpi-l">Ventas Proyectadas S/</div><div class="kpi-v">${fmt(totalVP)}</div></div>
      <div class="kpi"><div class="kpi-l">Ingresos Realizados S/</div><div class="kpi-v ok">${fmt(totalIR)}</div></div>
      <div class="kpi"><div class="kpi-l">Ingresos Proyectados S/</div><div class="kpi-v">${fmt(totalIP)}</div></div>
    </div>

    <!-- Avance Comercial vs Meta — vista principal para inversionistas -->
    <div class="sec-label">Avance Comercial vs Meta</div>

    <!-- Ventas mensuales vs meta -->
    <div class="chart-card">
      <div class="chart-title">Proyección Comercial vs Real — Ventas Mensuales</div>
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:#A78BFA;border-radius:2px"></span>Meta Mensual</span>
        <span class="legend-item"><span class="legend-dot" style="background:${C.ventas};border-radius:2px"></span>Real Mensual</span>
      </div>
      <div class="ch" style="height:220px"><canvas id="ch-comercial-meta-mensual"></canvas></div>
      <p style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:0">${interpMensual}</p>
    </div>

    <!-- Unidades acumuladas vs meta comercial -->
    <div class="chart-card" style="margin-top:8px">
      <div class="chart-title">Proyección Comercial vs Real — Unidades Acumuladas</div>
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:#A78BFA"></span>Meta Comercial Acum.</span>
        <span class="legend-item"><span class="legend-dot" style="background:${C.verde}"></span>Real Acum.</span>
      </div>
      <div class="ch" style="height:220px"><canvas id="ch-comercial-meta"></canvas></div>
      <p style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:0">${interpComAcum}</p>
    </div>

    <!-- Avance vs Proyección Original -->
    <div class="sec-label" style="margin-top:20px">Avance vs Proyección Original</div>

    <!-- Unidades acumuladas vs proyección original -->
    <div class="chart-card">
      <div class="chart-title">Ventas Acumuladas: Meta vs Real (Unidades)</div>
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:${C.acumMeta}"></span>Meta Acum.</span>
        <span class="legend-item"><span class="legend-dot" style="background:${C.acumReal}"></span>Real Acum.</span>
      </div>
      <div class="ch" style="height:220px"><canvas id="ch-acum-unid"></canvas></div>
      <p style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:0">${interp3}</p>
    </div>

    <!-- Ingresos acumulados vs proyección original -->
    <div class="chart-card" style="margin-top:8px">
      <div class="chart-title">Ingresos Acumulados: Meta vs Real (S/)</div>
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:${C.acumMeta}"></span>Ingresos Meta Acum.</span>
        <span class="legend-item"><span class="legend-dot" style="background:${C.acumReal}"></span>Ingresos Real Acum.</span>
      </div>
      <div class="ch" style="height:220px"><canvas id="ch-acum-s"></canvas></div>
      <p style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:0">${interp4}</p>
    </div>

    <!-- Detalle Histórico -->
    <div class="sec-label" style="margin-top:20px">Detalle Histórico</div>

    <!-- Ventas reales vs ingresos reales -->
    <div class="chart-card">
      <div class="chart-title">Ventas Reales vs Ingresos Reales (S/)</div>
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:${C.ventas}"></span>Ventas Reales</span>
        <span class="legend-item"><span class="legend-dot" style="background:${C.ingresos}"></span>Ingresos Reales</span>
      </div>
      <div class="ch" style="height:220px"><canvas id="ch-vr-ingr"></canvas></div>
    </div>

    <!-- Proyección de flujo acumulado -->
    <div class="chart-card" style="margin-top:8px">
      <div class="chart-title">Proyección de Flujo Acumulado (S/)</div>
      <div class="chart-sub">Meses pasados: real · Mes actual: real + proyectado · Meses futuros: proyectado</div>
      <div class="legend">
        <span class="legend-item"><span class="legend-dot" style="background:${C.proyVentas}"></span>Ventas Acum.</span>
        <span class="legend-item"><span class="legend-dot" style="background:${C.proyIngr}"></span>Ingresos Acum.</span>
      </div>
      <div class="ch" style="height:220px"><canvas id="ch-proy-ingr"></canvas></div>
    </div>

    <!-- Seguimiento de Caídas / Desistimientos -->
    <div class="sec-label" style="margin-top:24px">Seguimiento de Caídas</div>
    <div id="caidas-kpis" class="kpi-grid" style="margin-bottom:10px"></div>
    <div class="chart-card" id="caidas-chart-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:4px">
        <div>
          <div class="chart-title">Desistimientos por Mes</div>
          <div class="chart-sub">Basado en Fecha de Caída registrada · Haz clic en una barra para ver el detalle</div>
        </div>
      </div>
      <div class="legend" style="margin-bottom:10px">
        <span class="legend-item"><span class="legend-dot" style="background:#F87171;border-radius:3px"></span>Caídas del mes</span>
        <span class="legend-item"><span class="legend-dot" style="background:#FBBF24"></span>Acumulado (eje dcho.)</span>
      </div>
      <div class="ch" style="height:260px"><canvas id="ch-caidas" style="cursor:pointer"></canvas></div>
      <div id="caidas-insight" class="chart-insight" style="margin-top:12px;display:none"></div>
    </div>
  `;

  const baseOpts = (yFmt) => ({
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{display:false},
      tooltip:{
        backgroundColor: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(12,14,20,0.92)',
        borderColor:     isLight ? 'rgba(138,106,31,0.3)'   : 'rgba(201,168,76,0.3)',
        borderWidth:1,
        titleColor: isLight ? '#8A6A1F' : '#C9A84C',
        bodyColor:  isLight ? '#374151' : '#A0A8C0',
        padding:10,
        callbacks:{label: c => {
          const v = c.parsed.y;
          return c.dataset.label+': '+(yFmt==='s'?'S/ '+Math.round(v).toLocaleString('es-PE'):v);
        }}
      }
    },
    scales:{
      x:{grid:{display:false}, ticks:{color:C.tick,font:{size:10},autoSkip:true,maxRotation:45}},
      y:{grid:{color:C.grid}, ticks:{color:C.tick,font:{size:10},
        callback: v => yFmt==='s'?'S/'+(v>=1000000?(v/1000000).toFixed(1)+'M':v>=1000?(v/1000).toFixed(0)+'k':v):v
      }}
    }
  });

  // Chart 1 – Ventas Reales vs Ingresos Reales (barras)
  chartsCreados['ch-vr-ingr'] = new Chart(document.getElementById('ch-vr-ingr'),{
    type:'bar',
    data:{
      labels: activeLabels,
      datasets:[
        {label:'Ventas Reales', data:activeKeys.map(k=>Math.round(ventasRealesS[k]||0)), backgroundColor:C.ventas, borderRadius:3, borderSkipped:false},
        {label:'Ingresos Reales', data:activeKeys.map(k=>Math.round(ingresosRealesS[k]||0)), backgroundColor:C.ingresos, borderRadius:3, borderSkipped:false},
      ]
    },
    options: baseOpts('s')
  });

  // Chart 2 – Proyección Mensual Acumulada (línea mixta: real pasado + híbrido actual + proy futuro)
  {
    const now = new Date();
    const mesActual = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    // Construir serie acumulada de Ventas (S/)
    let acVenta = 0, acIngreso = 0;
    const dataVentas = [], dataIngresos = [];

    activeKeys.forEach(k => {
      const esPasado  = k < mesActual;
      const esActual  = k === mesActual;
      // const esFuturo  = k > mesActual;  // implícito

      if(esPasado) {
        // Solo real
        acVenta   += ventasRealesS[k]||0;
        acIngreso += ingresosRealesS[k]||0;
      } else if(esActual) {
        // Real + proyectado combinados
        acVenta   += (ventasRealesS[k]||0) + (ventasProyS[k]||0);
        acIngreso += (ingresosRealesS[k]||0) + (ingresosProyS[k]||0);
      } else {
        // Solo proyectado (ventas proy + ingresos proy + cuotas vendidos ya incluidas en ingresosProyS)
        acVenta   += ventasProyS[k]||0;
        acIngreso += ingresosProyS[k]||0;
      }
      dataVentas.push(Math.round(acVenta));
      dataIngresos.push(Math.round(acIngreso));
    });

    chartsCreados['ch-proy-ingr'] = new Chart(document.getElementById('ch-proy-ingr'),{
      type:'line',
      data:{
        labels: activeLabels,
        datasets:[
          {
            label:'Ventas Acum.',
            data: dataVentas,
            borderColor: C.proyVentas,
            backgroundColor: C.proyVentas+'22',
            fill: true, tension: 0.3, pointRadius: 3,
            pointBackgroundColor: activeKeys.map(k => k <= mesActual ? C.proyVentas : C.proyVentas+'99'),
            borderDash: activeKeys.map((k,i) => k > mesActual ? [5,3] : [0,0])[0] // no funciona por dataset, usamos segment
          },
          {
            label:'Ingresos Acum.',
            data: dataIngresos,
            borderColor: C.proyIngr,
            backgroundColor: C.proyIngr+'22',
            fill: true, tension: 0.3, pointRadius: 3,
            pointBackgroundColor: activeKeys.map(k => k <= mesActual ? C.proyIngr : C.proyIngr+'99'),
          },
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{
            callbacks:{
              label: c => {
                const k = activeKeys[c.dataIndex];
                const tag = k < mesActual ? ' (real)' : k === mesActual ? ' (real+proy)' : ' (proy)';
                return c.dataset.label+tag+': S/ '+c.parsed.y.toLocaleString('es-PE');
              }
            }
          },
          annotation: {}
        },
        scales:{
          x:{grid:{display:false}, ticks:{color:C.tick,font:{size:10},autoSkip:true,maxRotation:45}},
          y:{grid:{color:C.grid}, ticks:{color:C.tick,font:{size:10},
            callback: v => 'S/'+(v>=1000000?(v/1000000).toFixed(1)+'M':v>=1000?(v/1000).toFixed(0)+'k':v)
          }}
        }
      }
    });
  }

  // Chart Meta Comercial vs Real — MENSUAL (barras)
  // Real mensual: cortar meses futuros al mes actual
  const ventasRealesUMensual = activeKeys.map(k => k <= mesActualKey ? (ventasRealesU[k] || 0) : null);
  const metaComercialUMensual = activeKeys.map(k => metaComercialU[k] || 0);

  chartsCreados['ch-comercial-meta-mensual'] = new Chart(document.getElementById('ch-comercial-meta-mensual'),{
    type:'bar',
    data:{
      labels: activeLabels,
      datasets:[
        {
          label:'Meta Mensual',
          data: metaComercialUMensual,
          backgroundColor:'#A78BFA55',
          borderColor:'#A78BFA',
          borderWidth:1.5,
          borderRadius:4,
          order:2
        },
        {
          label:'Real Mensual',
          data: ventasRealesUMensual,
          backgroundColor: C.ventas+'99',
          borderColor: C.ventas,
          borderWidth:1.5,
          borderRadius:4,
          order:1
        },
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(12,14,20,0.92)',
          borderColor:     isLight ? 'rgba(138,106,31,0.3)'   : 'rgba(201,168,76,0.3)',
          borderWidth:1,
          titleColor: isLight ? '#8A6A1F' : '#C9A84C',
          bodyColor:  isLight ? '#374151' : '#A0A8C0',
          padding:10,
          callbacks:{label: c => c.dataset.label+': '+c.parsed.y+' unid.'}
        }
      },
      scales:{
        x:{grid:{display:false}, ticks:{color:C.tick, font:{size:10}, autoSkip:true, maxRotation:45}},
        y:{
          grid:{color:C.grid},
          ticks:{color:C.tick, font:{size:10}, stepSize:1},
          beginAtZero:true
        }
      }
    }
  });

  // Chart Meta Comercial vs Real — ACUMULADO
  chartsCreados['ch-comercial-meta'] = new Chart(document.getElementById('ch-comercial-meta'),{
    type:'line',
    data:{
      labels: activeLabels,
      datasets:[
        {
          label:'Meta Comercial Acum.',
          data: acMCUArr,
          borderColor:'#A78BFA',
          backgroundColor:'#A78BFA22',
          fill:true, tension:0.3, pointRadius:3,
          borderDash:[5,3]
        },
        {
          label:'Real Acum.',
          data: acVRealUArr,
          borderColor:C.ventas,
          backgroundColor:C.ventas+'22',
          fill:true, tension:0.3, pointRadius:3,
          spanGaps:false
        },
      ]
    },
    options: baseOpts('u')
  });

  // Plugin inline: mes actual destacado, todos los pasados tenues, posición bajo el punto
  const ptLabelsPlugin = (iA, fmtFn) => ({
    id: 'ptLabels',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const nPts = chart.data.labels.length;
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if(meta.hidden) return;
        for(let idx = 0; idx < nPts; idx++) {
          // Solo meses actuales y pasados
          if(iA >= 0 && idx > iA) continue;
          const val = ds.data[idx];
          if(val == null) continue;
          const pt = meta.data[idx];
          if(!pt) continue;
          const isCurrent = idx === iA;
          ctx.save();
          ctx.globalAlpha = isCurrent ? 0.9 : 0.28;
          ctx.font = (isCurrent ? 'bold 10' : '9') + 'px ' + (Chart.defaults.font.family || 'sans-serif');
          ctx.fillStyle = String(ds.borderColor);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(fmtFn(val), pt.x, pt.y + 4);
          ctx.restore();
        }
      });
    }
  });
  const ptRadii = (len, iA, iP) => Array.from({length: len}, (_, i) => i===iA ? 5 : i===iP ? 4 : 2);
  const _len = activeLabels.length;

  // Chart 3 – Acumulado Unidades (línea) — Meta vs Real
  chartsCreados['ch-acum-unid'] = new Chart(document.getElementById('ch-acum-unid'),{
    type:'line',
    data:{
      labels: activeLabels,
      datasets:[
        {label:'Meta Acum.',  data:acMetaVUArr,  borderColor:C.acumMeta, backgroundColor:C.acumMeta+'22', fill:true, tension:0.3, pointRadius:ptRadii(_len,idxActual,idxPasado), spanGaps:false},
        {label:'Real Acum.',  data:acVRealUArr,  borderColor:C.acumReal,  backgroundColor:C.acumReal+'22',  fill:true, tension:0.3, pointRadius:ptRadii(_len,idxActual,idxPasado), spanGaps:false},
      ]
    },
    options: baseOpts('u'),
    plugins: [ptLabelsPlugin(idxActual, v => String(v)+' ud.')]
  });

  // Chart 4 – Acumulado Ingresos S/ (línea) — Meta vs Real
  const _fmtSc = v => v>=1e6?'S/'+(v/1e6).toFixed(1)+'M':v>=1e3?'S/'+(v/1e3).toFixed(0)+'k':'S/'+v;
  chartsCreados['ch-acum-s'] = new Chart(document.getElementById('ch-acum-s'),{
    type:'line',
    data:{
      labels: activeLabels,
      datasets:[
        {label:'Ingresos Meta Acum.', data:acMetaISArr, borderColor:C.acumMeta, backgroundColor:C.acumMeta+'22', fill:true, tension:0.3, pointRadius:ptRadii(_len,idxActual,idxPasado), spanGaps:false},
        {label:'Ingresos Real Acum.',  data:acIRealArr,  borderColor:C.acumReal,  backgroundColor:C.acumReal+'22',  fill:true, tension:0.3, pointRadius:ptRadii(_len,idxActual,idxPasado), spanGaps:false},
      ]
    },
    options: baseOpts('s'),
    plugins: [ptLabelsPlugin(idxActual, _fmtSc)]
  });

  // ── Gráfico de Caídas / Desistimientos ───────────────────
  {
    const result = buildCaidasMensualesData();
    _caidasData = result;
    const { meses, sinFecha, total } = result;
    const keys = Object.keys(meses).sort();

    const kpisEl = document.getElementById('caidas-kpis');
    const insightEl = document.getElementById('caidas-insight');
    const cardEl = document.getElementById('caidas-chart-card');

    if (!keys.length) {
      if (kpisEl) kpisEl.innerHTML = '';
      if (cardEl) cardEl.innerHTML = '<div class="empty" style="padding:32px 20px">No hay desistimientos registrados con fecha de caída.</div>';
    } else {
      const labels = keys.map(k => {
        const [y, m] = k.split('-');
        return MESES[parseInt(m) - 1] + '-' + String(y).slice(-2);
      });
      const counts = keys.map(k => meses[k].count);
      let acum = 0;
      const acums = keys.map(k => { acum += meses[k].count; return acum; });

      const ahora = new Date();
      const mKeyAct = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
      const _dp2 = new Date(); _dp2.setMonth(_dp2.getMonth() - 1);
      const mKeyPas = `${_dp2.getFullYear()}-${String(_dp2.getMonth() + 1).padStart(2, '0')}`;

      const peorCount = Math.max(...counts);
      const peorIdx = counts.indexOf(peorCount);
      const peorLabel = labels[peorIdx] || '—';
      const estesMes = meses[mKeyAct] ? meses[mKeyAct].count : 0;
      const mesPas   = meses[mKeyPas] ? meses[mKeyPas].count : 0;
      const tendDir  = estesMes < mesPas ? '↓ Mejorando' : estesMes > mesPas ? '↑ En aumento' : '→ Estable';
      const tendCol  = estesMes < mesPas ? 'var(--verde)' : estesMes > mesPas ? 'var(--rojo)' : 'var(--text2)';
      const anioAct  = ahora.getFullYear();
      const totalAnio = Object.entries(meses)
        .filter(([k]) => k.startsWith(String(anioAct)))
        .reduce((a, [, v]) => a + v.count, 0);

      if (kpisEl) kpisEl.innerHTML = `
        <div class="kpi accent-rojo">
          <div class="kpi-l">Total desistimientos</div>
          <div class="kpi-v danger">${total}</div>
          ${sinFecha > 0 ? `<div class="kpi-s">${sinFecha} sin fecha registrada</div>` : ''}
        </div>
        <div class="kpi accent-amber">
          <div class="kpi-l">En ${anioAct}</div>
          <div class="kpi-v warn">${totalAnio}</div>
          <div class="kpi-s">del año en curso</div>
        </div>
        <div class="kpi">
          <div class="kpi-l">Peor mes</div>
          <div class="kpi-v danger">${peorCount}</div>
          <div class="kpi-s">${peorLabel}</div>
        </div>
        <div class="kpi">
          <div class="kpi-l">Tendencia</div>
          <div class="kpi-v" style="font-size:15px;color:${tendCol}">${tendDir}</div>
          <div class="kpi-s">este mes ${estesMes} vs anterior ${mesPas}</div>
        </div>
      `;

      const rojo  = isLight ? '#B91C1C' : '#F87171';
      const amber = isLight ? '#B45309' : '#FBBF24';
      const grid2 = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,.06)';
      const tick2 = isLight ? '#9CA3AF' : '#606880';

      chartsCreados['ch-caidas'] = new Chart(document.getElementById('ch-caidas'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Caídas del mes',
              data: counts,
              backgroundColor: keys.map(k =>
                k === mKeyAct ? rojo : rojo + (isLight ? '99' : 'AA')
              ),
              borderColor: rojo,
              borderWidth: 1.5,
              borderRadius: 5,
              order: 2,
              yAxisID: 'y'
            },
            {
              label: 'Acumulado',
              data: acums,
              type: 'line',
              borderColor: amber,
              backgroundColor: 'transparent',
              borderWidth: 2.5,
              pointRadius: keys.map(k => k === mKeyAct ? 6 : 3),
              pointBackgroundColor: amber,
              pointBorderColor: isLight ? '#fff' : '#0A1410',
              pointBorderWidth: 2,
              tension: 0.35,
              order: 1,
              yAxisID: 'yAcum'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (evt, elements) => {
            if (elements.length > 0) {
              const idx = elements[0].index;
              abrirModalCaidas(keys[idx], labels[idx]);
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: isLight ? 'rgba(255,255,255,0.97)' : 'rgba(12,14,20,0.95)',
              borderColor:     isLight ? 'rgba(185,28,28,0.3)' : 'rgba(248,113,113,0.35)',
              borderWidth: 1,
              titleColor: isLight ? '#B91C1C' : '#F87171',
              bodyColor:  isLight ? '#374151' : '#A0A8C0',
              padding: 12,
              callbacks: {
                title: items => labels[items[0].dataIndex],
                label: c => {
                  if (c.datasetIndex === 0) {
                    const k = keys[c.dataIndex];
                    const proyectos = [...new Set(meses[k].items.map(i => i.proyecto))];
                    return [
                      ` Caídas: ${c.parsed.y}`,
                      ` Proyectos: ${proyectos.join(', ')}`,
                      ` ↩ Clic para ver detalle`
                    ];
                  }
                  return ` Acumulado: ${c.parsed.y}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: tick2, font: { size: 10 }, autoSkip: true, maxRotation: 45 }
            },
            y: {
              position: 'left',
              beginAtZero: true,
              grid: { color: grid2 },
              title: { display: true, text: 'Caídas / mes', color: tick2, font: { size: 10 } },
              ticks: {
                color: tick2, font: { size: 10 }, stepSize: 1,
                callback: v => Number.isInteger(v) ? v : null
              }
            },
            yAcum: {
              position: 'right',
              beginAtZero: true,
              grid: { display: false },
              title: { display: true, text: 'Acumulado', color: amber, font: { size: 10 } },
              ticks: {
                color: amber, font: { size: 10 }, stepSize: 1,
                callback: v => Number.isInteger(v) ? v : null
              }
            }
          }
        }
      });

      if (insightEl) {
        insightEl.style.display = '';
        insightEl.innerHTML =
          `<strong>${total} desistimiento${total !== 1 ? 's' : ''} en total</strong>, ` +
          `${totalAnio} en lo que va de ${anioAct}. ` +
          `El mes con más caídas fue <strong>${peorLabel}</strong> con <strong>${peorCount}</strong>. ` +
          (sinFecha > 0 ? `<span style="color:var(--amber)">⚠ ${sinFecha} sin "Fecha de Caída" registrada (se usa Mes/Año como referencia).</span>` : '');
      }
    }
  }
}

// ════════════════════════════════════════════════════════════
// PÁGINA 4: COBRANZA (NUEVA)
// ════════════════════════════════════════════════════════════
function renderCobranzaNueva(){
  const activos = filtrado.filter(r =>
    ['VENDIDO','SEPARADO'].includes(str(r['SITUACION'])) &&
    str(r['Nombre del Cliente'])
  );

  // Totales de cobranza desde Master
  const totalCobrado = activos.reduce((a,r)=>a+num(r['Ingresos  S/.']),0);
  const totalPorCobrar = activos.reduce((a,r)=>a+num(r['Por Pagar  S/.']),0);
  const totalValor = activos.reduce((a,r)=>a+num(r['VALOR S/']),0);
  const pctCobrado = totalValor > 0 ? Math.round((totalCobrado / totalValor) * 1000) / 10 : 0;
  const pctPendiente = 100 - pctCobrado;

  // Gráfico mensual — preparar antes de construir html
  const _cuotasGrafDataCob = renderGraficoCuotasMensuales('ch-cuotas-cob');

  let html = `
    <div class="sec-label">Resumen de cobranza</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-l">Total cobrado</div><div class="kpi-v ok money">${fmt(totalCobrado)}</div></div>
      <div class="kpi"><div class="kpi-l">Total por cobrar</div><div class="kpi-v warn money">${fmt(totalPorCobrar)}</div></div>
    </div>

    <div class="prog-wrap" style="margin-top:9px">
      <div class="prog-row">
        <span class="prog-label">Progreso de cobranza</span>
        <span class="prog-pct">${pctCobrado}%</span>
      </div>
      <div class="prog-bg"><div class="prog-fill" style="width:${Math.max(pctCobrado,1)}%; background: linear-gradient(90deg, #3B6D11 0%, #1D9E75 100%);"></div></div>
    </div>

    ${_cuotasGrafDataCob ? _cuotasGrafDataCob.html : ''}

    <div class="sec-label" style="margin-top:14px">Tipo de crédito</div>
  `;

  // Agrupar por tipo de crédito (5 tipos principales)
  const tiposCredito = {
    'Hipotecario': { cobrado: 0, porCobrar: 0, contar: 0 },
    'Directo': { cobrado: 0, porCobrar: 0, contar: 0 },
    'Contado': { cobrado: 0, porCobrar: 0, contar: 0 },
    'Hipotecario Postergado': { cobrado: 0, porCobrar: 0, contar: 0 },
    'Ahorro Casa': { cobrado: 0, porCobrar: 0, contar: 0 },
    'Por Confirmar': { cobrado: 0, porCobrar: 0, contar: 0 }
  };

  activos.forEach(r => {
    let tipo = str(r['Tipo de  Credito']).trim();
    // Si está vacío, clasificar como "Por Confirmar"
    if (!tipo) {
      tipo = 'Por Confirmar';
    }
    // Asegurar que solo use uno de los 5 tipos
    if (!tiposCredito[tipo]) {
      tipo = 'Por Confirmar';
    }
    
    tiposCredito[tipo].cobrado += num(r['Ingresos  S/.']);
    tiposCredito[tipo].porCobrar += num(r['Por Pagar  S/.']);
    tiposCredito[tipo].contar += 1;
  });

  Object.entries(tiposCredito).forEach(([tipo, datos]) => {
    if (datos.contar === 0) return; // No mostrar tipos sin clientes
    
    const total = datos.cobrado + datos.porCobrar;
    const pct = total > 0 ? Math.round((datos.cobrado / total) * 1000) / 10 : 0;
    html += `
      <div class="cliente-card">
        <div style="margin-bottom:8px">
          <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px">${tipo}</div>
          <div style="font-size:11px;color:var(--gris-text);margin-bottom:8px">${datos.contar} cliente${datos.contar!==1?'s':''}</div>
          <div class="prog-bg"><div class="prog-fill" style="width:${Math.max(pct,0.5)}%; background:#2F5496;"></div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div class="ck"><div class="ck-l">Cobrado</div><div class="ck-v ok">${fmt(datos.cobrado)}</div></div>
          <div class="ck"><div class="ck-l">Por cobrar</div><div class="ck-v warn">${fmt(datos.porCobrar)}</div></div>
        </div>
      </div>
    `;
  });

  // Listado de clientes por pagar
  html += `<div class="sec-label" style="margin-top:14px">Clientes por pagar</div>`;
  
  // Obtener tipos de crédito únicos de los clientes activos
  const tiposParaFiltrar = [...new Set(
    activos.map(r => {
      let tipo = str(r['Tipo de  Credito']).trim();
      if (!tipo || !tiposCredito[tipo]) tipo = 'Por Confirmar';
      return tipo;
    })
  )].sort();

  // Agregar selector de filtro por tipo de crédito
  html += `
    <div style="display:flex;gap:6px;overflow-x:auto;padding:8px 0 4px;scrollbar-width:none;margin-bottom:8px">
      <button class="btn-cuota all ${!window.filTipoCredito ? 'active' : ''}" onclick="setTipoCredFiltro('',this)">Todos</button>
  `;
  
  tiposParaFiltrar.forEach(tipo => {
    const esActivo = window.filTipoCredito === tipo ? 'active' : '';
    html += `<button class="btn-cuota pendiente ${esActivo}" onclick="setTipoCredFiltro('${tipo}',this)">${tipo}</button>`;
  });
  
  html += `</div>`;

  // Agrupar por cliente + tipo de crédito (para separar unidades por tipo)
  const clientes = {};
  activos.forEach(r => {
    const nombre = str(r['Nombre del Cliente']);
    let tipoCredito = str(r['Tipo de  Credito']).trim();
    if (!tipoCredito) {
      tipoCredito = 'Por Confirmar';
    }
    // Clave única: nombre + tipo de crédito
    const key = nombre + '|' + tipoCredito;
    
    if (!clientes[key]) {
      clientes[key] = {
        nombre,
        proyecto: str(r['PROYECTO']),
        tipoCredito: tipoCredito,
        dptos: new Set(),
        ests: new Set(),
        deps: new Set(),
        cobrado: 0,
        porCobrar: 0
      };
    }
    if(str(r['DPTO'])) clientes[key].dptos.add(str(r['DPTO']));
    if(str(r['EST'])) clientes[key].ests.add(str(r['EST']));
    if(str(r['DEP'])) clientes[key].deps.add(str(r['DEP']));
    clientes[key].cobrado += num(r['Ingresos  S/.']);
    clientes[key].porCobrar += num(r['Por Pagar  S/.']);
  });

  const listaClientes = Object.values(clientes)
    .filter(c => c.porCobrar > 0 || c.ests.size > 0)
    .filter(c => window.filTipoCredito ? c.tipoCredito === window.filTipoCredito : true)
    .sort((a,b) => b.porCobrar - a.porCobrar);

  if(listaClientes.length === 0){
    html += `<div class="empty">Todos los clientes están al día</div>`;
  } else {
    listaClientes.forEach(c => {
      const unidades = [];
      if(c.dptos.size) unidades.push(`Dpto ${[...c.dptos].join(', ')}`);
      if(c.ests.size) unidades.push(`Est ${[...c.ests].join(', ')}`);
      if(c.deps.size) unidades.push(`Dep ${[...c.deps].join(', ')}`);
      const textUnidades = unidades.join(' · ');

      html += `
        <div class="cliente-card por-pagar">
          <div class="cliente-nombre">${c.nombre}</div>
          <div style="font-size:11px;color:var(--gris-text);margin-bottom:8px">
            <strong>${c.tipoCredito}</strong><br>
            ${c.proyecto}${textUnidades ? ' · ' + textUnidades : ''}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="ck"><div class="ck-l">Pagado</div><div class="ck-v ok">${fmt(c.cobrado)}</div></div>
            <div class="ck"><div class="ck-l">Por pagar</div><div class="ck-v warn">${fmt(c.porCobrar)}</div></div>
          </div>
        </div>
      `;
    });
  }

  document.getElementById('cobranza-content').innerHTML = html;
  initGraficoCuotas('ch-cuotas-cob', _cuotasGrafDataCob);
}

// ════════════════════════════════════════════════════════════
// GRÁFICO MENSUAL DE CUOTAS — compartido entre Cuotas y Cobranza
// Reglas de ajuste: VENDIDO +3 días · SEPARADO +14 días
// ════════════════════════════════════════════════════════════
let _cuotasMensualesData = null;

function buildCuotasMensualesData() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fp = document.getElementById('fil-proyecto').value;
  const fs = document.getElementById('fil-situacion').value;

  const meses = {};

  rawCron.forEach(r => {
    if (str(r['INMUEBLE']) !== 'Departamento') return;
    if (fp && str(r['PROYECTO']) !== fp) return;
    if (fs && str(r['ESTADO VENTA']) !== fs) return;
    if (str(r['ESTADO']) !== 'Por Pagar') return;

    const estadoVenta = str(r['ESTADO VENTA']);
    const fechaOriginal = parseFechaExcel(r['Fecha Cuota']);
    if (!fechaOriginal) return;

    const fechaEsperada = new Date(fechaOriginal.getTime());
    if (estadoVenta === 'SEPARADO') {
      fechaEsperada.setDate(fechaEsperada.getDate() + 14);
    } else if (estadoVenta === 'VENDIDO') {
      fechaEsperada.setDate(fechaEsperada.getDate() + 3);
    }

    const mKey = `${fechaEsperada.getFullYear()}-${String(fechaEsperada.getMonth() + 1).padStart(2, '0')}`;
    const monto = num(r['Monto Cuota']);
    if (monto <= 0) return;

    const diffDias = Math.round((fechaOriginal - hoy) / (1000 * 60 * 60 * 24));
    let situacion = 'Pendiente';
    if (diffDias < 0) situacion = 'Vencida';
    else if (diffDias <= 7) situacion = 'Por Vencer';

    if (!meses[mKey]) {
      meses[mKey] = { vencidas: 0, porVencer: 0, pendientes: 0, total: 0, clientes: [] };
    }
    meses[mKey].total += monto;
    if (situacion === 'Vencida') meses[mKey].vencidas += monto;
    else if (situacion === 'Por Vencer') meses[mKey].porVencer += monto;
    else meses[mKey].pendientes += monto;

    meses[mKey].clientes.push({
      nombre: str(r['Nombre del Cliente']) || 'Sin nombre',
      proyecto: str(r['PROYECTO']),
      dpto: str(r['DPTO']),
      tipo: str(r['Tipo de Credito']),
      concepto: str(r['Concepto']) || str(r['concepto']),
      monto,
      situacion,
      estadoVenta,
      fechaOriginal,
      fechaEsperada
    });
  });

  return meses;
}

function renderGraficoCuotasMensuales(chartId) {
  const data = buildCuotasMensualesData();
  _cuotasMensualesData = data;

  const keys = Object.keys(data).sort();
  if (!keys.length) return null;

  const isLight = document.body.classList.contains('light');
  const labels = keys.map(k => {
    const [y, m] = k.split('-');
    return MESES[parseInt(m) - 1] + '-' + String(y).slice(-2);
  });

  const mesActual = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const mesActualIdx = keys.indexOf(mesActual);
  const totalEsperado = keys.reduce((a, k) => a + data[k].total, 0);
  const totalEsteMes = mesActual && data[mesActual] ? data[mesActual].total : 0;

  const html = `
    <div class="sec-label">Flujo Mensual de Cuotas Esperadas</div>
    <div class="chart-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:4px">
        <div>
          <div class="chart-title">Cuotas por cobrar · mes a mes</div>
          <div class="chart-sub">Fechas ajustadas: Vendido +3 días · Separado +2 semanas · Haz clic en una barra para ver clientes</div>
        </div>
        <div style="display:flex;gap:16px;flex-shrink:0">
          <div style="text-align:right">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em">Total esperado</div>
            <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--text)">${fmt(totalEsperado)}</div>
          </div>
          ${totalEsteMes > 0 ? `<div style="text-align:right">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em">Este mes</div>
            <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--gold)">${fmt(totalEsteMes)}</div>
          </div>` : ''}
        </div>
      </div>
      <div class="legend" style="margin-bottom:10px">
        <span class="legend-item"><span class="legend-dot" style="background:#F87171;border-radius:2px"></span>Vencidas</span>
        <span class="legend-item"><span class="legend-dot" style="background:#FBBF24;border-radius:2px"></span>Por vencer</span>
        <span class="legend-item"><span class="legend-dot" style="background:#88BAE0;border-radius:2px"></span>Pendientes</span>
      </div>
      <div class="ch" style="height:260px"><canvas id="${chartId}" style="cursor:pointer"></canvas></div>
    </div>
  `;

  return { html, keys, labels, data, isLight, mesActualIdx };
}

function initGraficoCuotas(chartId, chartData) {
  if (!chartData) return;
  const { keys, labels, data, isLight, mesActualIdx } = chartData;

  if (chartsCreados[chartId]) { chartsCreados[chartId].destroy(); delete chartsCreados[chartId]; }

  const canvas = document.getElementById(chartId);
  if (!canvas) return;

  const isLightNow = document.body.classList.contains('light');
  const C = {
    grid: isLightNow ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,.06)',
    tick: isLightNow ? '#9CA3AF' : '#606880',
    rojo:  isLightNow ? '#B91C1C' : '#F87171',
    amber: isLightNow ? '#B45309' : '#FBBF24',
    azul:  isLightNow ? '#1E4A99' : '#88BAE0'
  };

  chartsCreados[chartId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Vencidas',
          data: keys.map(k => Math.round(data[k].vencidas)),
          backgroundColor: C.rojo + 'BB',
          borderColor: C.rojo,
          borderWidth: 1,
          stack: 'cuotas'
        },
        {
          label: 'Por vencer',
          data: keys.map(k => Math.round(data[k].porVencer)),
          backgroundColor: C.amber + 'BB',
          borderColor: C.amber,
          borderWidth: 1,
          stack: 'cuotas'
        },
        {
          label: 'Pendientes',
          data: keys.map(k => Math.round(data[k].pendientes)),
          backgroundColor: C.azul + 'BB',
          borderColor: C.azul,
          borderWidth: 1,
          stack: 'cuotas'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          abrirModalCuotaMes(keys[idx], labels[idx]);
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isLightNow ? 'rgba(255,255,255,0.97)' : 'rgba(12,14,20,0.92)',
          borderColor:     isLightNow ? 'rgba(138,106,31,0.3)' : 'rgba(201,168,76,0.3)',
          borderWidth: 1,
          titleColor: isLightNow ? '#8A6A1F' : '#C9A84C',
          bodyColor:  isLightNow ? '#374151' : '#A0A8C0',
          padding: 10,
          callbacks: {
            label: c => {
              if (!c.parsed.y) return null;
              return ` ${c.dataset.label}: S/ ${Math.round(c.parsed.y).toLocaleString('es-PE')}`;
            },
            footer: items => {
              const k = keys[items[0].dataIndex];
              const d = data[k];
              const n = d.clientes.length;
              return `Total: S/ ${Math.round(d.total).toLocaleString('es-PE')} · ${n} cuota${n !== 1 ? 's' : ''} — clic para ver clientes`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: C.tick, font: { size: 10 }, autoSkip: true, maxRotation: 45 }
        },
        y: {
          stacked: true,
          grid: { color: C.grid },
          ticks: {
            color: C.tick, font: { size: 10 },
            callback: v => v >= 1e6 ? 'S/' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? 'S/' + (v / 1e3).toFixed(0) + 'k' : 'S/' + v
          }
        }
      }
    }
  });
}

function abrirModalCuotaMes(key, label) {
  if (!_cuotasMensualesData || !_cuotasMensualesData[key]) return;
  const mes = _cuotasMensualesData[key];
  document.getElementById('modal-cuotas-title').textContent = `Cuotas esperadas · ${label}`;

  const orden = { 'Vencida': 0, 'Por Vencer': 1, 'Pendiente': 2 };
  const clientes = [...mes.clientes].sort((a, b) => {
    if (orden[a.situacion] !== orden[b.situacion]) return orden[a.situacion] - orden[b.situacion];
    return b.monto - a.monto;
  });

  const fmtFecha = d => d ? d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  let bodyHtml = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div class="ck" style="flex:1;min-width:130px"><div class="ck-l">Total mes</div><div class="ck-v" style="color:var(--text)">${fmt(mes.total)}</div></div>
      ${mes.vencidas > 0 ? `<div class="ck" style="flex:1;min-width:130px"><div class="ck-l">Vencidas</div><div class="ck-v" style="color:var(--rojo)">${fmt(mes.vencidas)}</div></div>` : ''}
      ${mes.porVencer > 0 ? `<div class="ck" style="flex:1;min-width:130px"><div class="ck-l">Por vencer</div><div class="ck-v" style="color:var(--amber)">${fmt(mes.porVencer)}</div></div>` : ''}
      ${mes.pendientes > 0 ? `<div class="ck" style="flex:1;min-width:130px"><div class="ck-l">Pendientes</div><div class="ck-v" style="color:var(--accent)">${fmt(mes.pendientes)}</div></div>` : ''}
      <div class="ck" style="flex:1;min-width:130px"><div class="ck-l">Cuotas</div><div class="ck-v">${clientes.length}</div></div>
    </div>
    <div class="tbl-wrap">
      <div class="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Proyecto · Dpto</th>
              <th>Concepto</th>
              <th style="text-align:right">Monto</th>
              <th>Vencimiento original</th>
              <th>Fecha esperada cobro</th>
              <th>Estado venta</th>
              <th>Estado cuota</th>
            </tr>
          </thead>
          <tbody>`;

  const colMap = { 'Vencida': 'var(--rojo)', 'Por Vencer': 'var(--amber)', 'Pendiente': 'var(--accent)' };
  clientes.forEach(c => {
    const origStr = fmtFecha(c.fechaOriginal);
    const espStr  = fmtFecha(c.fechaEsperada);
    const ajustado = origStr !== espStr;
    bodyHtml += `
      <tr>
        <td style="font-weight:600;color:var(--text);white-space:nowrap">${c.nombre}</td>
        <td style="color:var(--text3);font-size:11px;white-space:nowrap">${c.proyecto}${c.dpto ? ' · Dpto ' + c.dpto : ''}${c.tipo ? '<br><span style="opacity:.7">' + c.tipo + '</span>' : ''}</td>
        <td style="font-size:11px;color:var(--text2);white-space:nowrap">${c.concepto || '—'}</td>
        <td style="text-align:right;font-family:var(--font-mono);font-weight:700;color:var(--text);white-space:nowrap">${fmt(c.monto)}</td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--text3);white-space:nowrap">${origStr}</td>
        <td style="font-family:var(--font-mono);font-size:11px;white-space:nowrap;${ajustado ? 'color:var(--gold);font-weight:600' : 'color:var(--text3)'}">${espStr}${ajustado ? ' <span style="font-size:9px;opacity:.7">(ajust.)</span>' : ''}</td>
        <td style="font-size:11px;white-space:nowrap">${c.estadoVenta}</td>
        <td style="font-weight:600;color:${colMap[c.situacion] || 'var(--text2)'};white-space:nowrap">${c.situacion}</td>
      </tr>`;
  });

  bodyHtml += `</tbody></table></div></div>`;
  document.getElementById('modal-cuotas-body').innerHTML = bodyHtml;
  document.getElementById('modal-cuotas').classList.add('visible');
}

function cerrarModalCuotas(event) {
  if (!event || event.target.id === 'modal-cuotas' || event.target.classList.contains('modal-close')) {
    document.getElementById('modal-cuotas').classList.remove('visible');
  }
}

// ════════════════════════════════════════════════════════════
// PÁGINA 4b: CRONOGRAMA DE CUOTAS
// ════════════════════════════════════════════════════════════
function renderCronograma(){
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  const fp = document.getElementById('fil-proyecto').value;
  const fs = document.getElementById('fil-situacion').value;

  // Usar cronograma si está disponible
  let cuotas = [];
  if(filtradoCron && filtradoCron.length > 0){
    cuotas = filtradoCron.filter(r => str(r['ESTADO'])==='Por Pagar');
  }

  // Aplicar filtro de situación
  let cuotasConFiltroSituacion = cuotas;
  if(fs){
    cuotasConFiltroSituacion = cuotas.filter(r => {
      const estadoVenta = str(r['ESTADO VENTA']);
      return estadoVenta === fs;
    });
  }

  const cuotasFiltradas = filCuota
    ? cuotasConFiltroSituacion.filter(r => str(r['SITUACION'])===filCuota)
    : cuotasConFiltroSituacion;

  const nVencidas   = cuotasConFiltroSituacion.filter(r=>str(r['SITUACION'])==='Vencida').length;
  const nPorVencer  = cuotasConFiltroSituacion.filter(r=>str(r['SITUACION'])==='Por Vencer').length;
  const nPendientes = cuotasConFiltroSituacion.filter(r=>str(r['SITUACION'])==='Pendiente').length;
  const montoVencido= cuotasConFiltroSituacion.filter(r=>str(r['SITUACION'])==='Vencida').reduce((a,r)=>a+num(r['Monto Cuota']),0);

  const activos    = filtrado.filter(r=>['VENDIDO','SEPARADO'].includes(str(r['SITUACION'])));
  const totalIngr  = activos.reduce((a,r)=>a+num(r['Ingresos  S/.']),0);
  const totalCobr  = activos.reduce((a,r)=>a+num(r['Por Pagar  S/.']),0);

  const grupos = [
    { key:'Vencida',    label:'Vencidas',       cls:'vencida',    icono:'Atrasadas' },
    { key:'Por Vencer', label:'Por vencer',      cls:'por-vencer', icono:'Próximos 7 días' },
    { key:'Pendiente',  label:'Pendientes',      cls:'pendiente',  icono:'A tiempo' },
  ];

  // Gráfico mensual — preparar antes de construir html
  const _cuotasGrafData = renderGraficoCuotasMensuales('ch-cuotas-cron');

  let html = `
    <div class="kpi-grid" style="margin-top:4px">
      <div class="kpi"><div class="kpi-l">Total ingresos</div><div class="kpi-v ok money">${fmt(totalIngr)}</div></div>
      <div class="kpi"><div class="kpi-l">Total por cobrar</div><div class="kpi-v warn money">${fmt(totalCobr)}</div></div>
    </div>
    <div class="kpi-grid" style="margin-top:0">
      <div class="kpi">
        <div class="kpi-l">Cuotas vencidas</div>
        <div class="kpi-v danger">${nVencidas}</div>
        <div class="kpi-s">${fmt(montoVencido)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-l">Por vencer (7 días)</div>
        <div class="kpi-v warn">${nPorVencer}</div>
        <div class="kpi-s">${nPendientes} pendientes</div>
      </div>
    </div>`;

  if (_cuotasGrafData) html += _cuotasGrafData.html;

  if(cuotasConFiltroSituacion.length === 0){
    html += `<div class="empty">Sin datos de cronograma.<br>Asegúrate de haber exportado la hoja "Proy. Ingresos" desde el VBA.</div>`;
    document.getElementById('cronograma-content').innerHTML = html;
    initGraficoCuotas('ch-cuotas-cron', _cuotasGrafData);
    return;
  }

  const gruposAMostrar = filCuota
    ? grupos.filter(g => g.key === filCuota)
    : grupos;

  gruposAMostrar.forEach(grupo => {
    const items = cuotasFiltradas
      .filter(r => str(r['SITUACION']) === grupo.key)
      .sort((a,b) => {
        const fa = parseFechaCron(str(a['Fecha Cuota']));
        const fb = parseFechaCron(str(b['Fecha Cuota']));
        return grupo.key==='Vencida' ? fa-fb : fa-fb;
      });

    if(!items.length) return;

    html += `<div class="sec-label" style="margin-top:14px"></div>
    <div class="cron-grupo">
      <div class="cron-hdr ${grupo.cls}">
        <span>${grupo.label}</span>
        <span style="font-size:10px;opacity:.8">${grupo.icono}</span>
        <span class="cron-hdr-badge">${items.length} cuota${items.length!==1?'s':''}</span>
      </div>
      <div class="cron-body">`;

    items.forEach(r => {
      const cliente  = str(r['Nombre del Cliente'])||'Sin nombre';
      const proy     = str(r['PROYECTO']);
      const dpto     = str(r['DPTO']);
      const torre    = str(r['TORRE']);
      const tipo     = str(r['Tipo de Credito']);
      const concepto = str(r['Concepto']) || str(r['concepto']);
      const monto    = num(r['Monto Cuota']);
      const fechaStr = str(r['Fecha Cuota']);
      const fecha    = parseFechaCron(fechaStr);
      const diffDias = fecha ? Math.round((fecha - hoy)/(1000*60*60*24)) : null;

      let diasTxt = '';
      if(diffDias !== null){
        if(diffDias < 0)       diasTxt = `${Math.abs(diffDias)} días de atraso`;
        else if(diffDias === 0) diasTxt = 'Vence hoy';
        else if(diffDias === 1) diasTxt = 'Vence mañana';
        else                   diasTxt = `Vence en ${diffDias} días`;
      }

      const fechaFmt = fecha
        ? fecha.toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'})
        : fechaStr;

      const nombreCorto = cliente.length>38 ? cliente.slice(0,38)+'…' : cliente;

      html += `<div class="cron-row ${grupo.cls}">
        <div>
          <div class="cron-cliente">${nombreCorto}</div>
          <div class="cron-meta">
            ${proy}${dpto?' · Dpto '+dpto:''}${torre?' T'+torre:''}
            ${concepto ? '<br><span style="color:var(--gold);font-weight:500">'+concepto+'</span>' : ''}
            ${tipo ? '<br>'+tipo : ''}
            <br>${fechaFmt}
          </div>
        </div>
        <div class="cron-right">
          <div class="cron-monto ${grupo.cls}">${fmt(monto)}</div>
          ${diasTxt ? `<div class="cron-dias ${grupo.cls}">${diasTxt}</div>` : ''}
        </div>
      </div>`;
    });

    html += `</div></div>`;
  });

  document.getElementById('cronograma-content').innerHTML = html;
  initGraficoCuotas('ch-cuotas-cron', _cuotasGrafData);
}

function parseFechaCron(s){
  if(!s) return null;
  const strVal = String(s).trim();
  
  // 1. Formato de Google Viz si llegara a ocurrir (ej. Date(2026, 5, 30))
  if (strVal.startsWith('Date(')) {
    const p = strVal.substring(5, strVal.length - 1).split(',');
    const d = new Date(parseInt(p[0]), parseInt(p[1]), parseInt(p[2] || 1));
    return isNaN(d.getTime()) ? null : d;
  }
  
  // 2. Aquí leemos TU FORMATO: DD/MM/YYYY o D/M/YYYY (ej. 30/6/2026)
  if (strVal.includes('/')) {
    const partes = strVal.split('/'); // partes[0]=Día, partes[1]=Mes, partes[2]=Año
    if (partes.length === 3) {
      let y = parseInt(partes[2]);
      if (y < 100) y += 2000; // Por si algún año viene como "26" en lugar de "2026"
      // En JS los meses van de 0 a 11, por eso restamos 1 al mes
      const d = new Date(y, parseInt(partes[1]) - 1, parseInt(partes[0]));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  
  // 3. Fallback a YYYY-MM-DD
  try{
    const d = new Date(strVal.slice(0,10));
    return isNaN(d.getTime()) ? null : d;
  }catch(e){ return null; }
}

function parseFechaExcel(val){
  if(!val && val !== 0) return null;
  const strVal = String(val).trim();
  
  // Si contiene "/" o "-" o es "Date", sabemos que NO es un número de serie de Excel
  if(strVal.includes('/') || strVal.includes('-') || strVal.startsWith('Date(')){
    return parseFechaCron(strVal);
  }
  
  try{
    // Usamos Number() en vez de parseFloat() para que NO convierta "30/6" en "30"
    const numVal = Number(strVal);
    if(!isNaN(numVal) && numVal > 0 && numVal < 100000){
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + numVal * 24 * 60 * 60 * 1000);
      return (!isNaN(date.getTime())) ? date : null;
    }
    return parseFechaCron(strVal);
  }catch(e){ return null; }
}

// ════════════════════════════════════════════════════════════
// PÁGINA 5: CARTERA
// ════════════════════════════════════════════════════════════
function renderCartera(){
  const activos = filtrado.filter(r =>
    ['VENDIDO','SEPARADO'].includes(str(r['SITUACION'])) &&
    str(r['Nombre del Cliente'])
  );

  if(!activos.length){
    document.getElementById('cartera-content').innerHTML =
      '<div class="empty">Sin clientes activos para los filtros seleccionados</div>';
    return;
  }

  const clientes = {};

  activos.forEach(r => {
    const nombre = str(r['Nombre del Cliente']);

    if(!clientes[nombre]){
      clientes[nombre] = {
        nombre,
        proyecto: str(r['PROYECTO']),
        situacion: str(r['SITUACION']),
        vendedor: str(r['VENDEDOR']),
        dptos: new Set(),
        ests: new Set(),
        deps: new Set(),
        valor: 0,
        ingresos: 0,
        porCobrar: 0,
        cuotaInicialPend: 0
      };
    }

    if(str(r['DPTO'])) clientes[nombre].dptos.add(str(r['DPTO']));
    if(str(r['EST'])) clientes[nombre].ests.add(str(r['EST']));
    if(str(r['DEP'])) clientes[nombre].deps.add(str(r['DEP']));

    clientes[nombre].valor += num(r['VALOR S/']);
    clientes[nombre].ingresos += num(r['Ingresos  S/.']);
    clientes[nombre].porCobrar += num(r['Por Pagar  S/.']);
  });

  filtradoCron.forEach(r => {
    const nombre = str(r['Nombre del Cliente']);
    if (clientes[nombre]) {
      const tipoConcepto = str(r['Concepto']) || str(r['concepto']);
      const estado = str(r['ESTADO']);
      
      if (tipoConcepto.trim().toLowerCase() === 'cuota inicial' && estado.trim().toLowerCase() === 'por pagar') {
        clientes[nombre].cuotaInicialPend += num(r['Monto Cuota']);
      }
    }
  });

  const listaClientes = Object.values(clientes)
    .sort((a,b)=>b.valor - a.valor);

  const vendidos = listaClientes.filter(c=>c.situacion==='VENDIDO').length;
  const separados = listaClientes.filter(c=>c.situacion==='SEPARADO').length;

  let html = `
    <div class="kpi-grid" style="margin-top:4px">
      <div class="kpi"><div class="kpi-l">Contratos firmados</div><div class="kpi-v ok">${vendidos}</div></div>
      <div class="kpi"><div class="kpi-l">En proceso</div><div class="kpi-v warn">${separados}</div></div>
    </div>
    <div class="sec-label" style="margin-top:14px">Clientes activos (${listaClientes.length})</div>
  `;

  function formatearUnidades(c){
    const partes = [];
    if(c.dptos.size) partes.push(`Dpto ${[...c.dptos].join(', ')}`);
    if(c.ests.size){
      const arr = [...c.ests];
      partes.push(`Est ${arr.length>1 ? arr.slice(0,-1).join(', ') + ' y ' + arr.slice(-1) : arr[0]}`);
    }
    if(c.deps.size){
      const arr = [...c.deps];
      partes.push(`Dep ${arr.length>1 ? arr.slice(0,-1).join(', ') + ' y ' + arr.slice(-1) : arr[0]}`);
    }
    return partes.join(' · ');
  }

  listaClientes.forEach(c=>{
    html += `
      <div class="cliente-card">
        <div class="cliente-nombre">${c.nombre}</div>
        <div class="cliente-meta">
          ${pillHtml(c.situacion)}
          <span style="font-size:11px;color:var(--gris-text)">${c.proyecto}</span>
          ${formatearUnidades(c) ? `<span style="font-size:11px;color:var(--gris-text)">${formatearUnidades(c)}</span>` : ''}
          ${c.vendedor ? `<span style="font-size:11px;color:var(--gris-text)">${c.vendedor}</span>` : ''}
        </div>
        <div class="cliente-kpis">
          <div class="ck"><div class="ck-l">Valor</div><div class="ck-v">${fmt(c.valor)}</div></div>
          <div class="ck"><div class="ck-l">Cobrado</div><div class="ck-v ok">${fmt(c.ingresos)}</div></div>
          <div class="ck"><div class="ck-l">Pendiente</div><div class="ck-v warn">${fmt(c.porCobrar)}</div></div>
          <div class="ck"><div class="ck-l">C.I. Pendiente</div><div class="ck-v warn">${fmt(c.cuotaInicialPend)}</div></div>
        </div>
      </div>
    `;
  });

  document.getElementById('cartera-content').innerHTML = html;
}
// ════════════════════════════════════════════════════════════
// PÁGINA 6: PROYECCIONES
// ════════════════════════════════════════════════════════════
function renderProyecciones(){
  const fp = document.getElementById('fil-proyecto').value;

  const proyecciones = {};
  const initMes = (k) => {
    if(!proyecciones[k]) {
      proyecciones[k] = { vUnid: 0, vMonto: 0, iProy: 0, iCuotas: 0, iRealizado: 0 };
    }
  };

  // --- NUEVO: Obtener valor de unidades vendidas/separadas ---
  const activosVendidos = filtrado.filter(r=>['VENDIDO'].includes(str(r['SITUACION'])));
  const valorVendidos = activosVendidos.reduce((a,r)=>a+num(r['VALOR S/']),0);

  // --- Procesar Hoja Abonos para Ingresos Realizados (solo Departamentos) ---
  rawAB.filter(r => str(r['DPTO']) !== '').forEach(r => {
    const proy = str(r['PROYECTO']);
    if(fp && proy !== fp) return;
    
    // 1. Validar que esté "Vendido" usando FECHA FIRMA CV > 1/1/2024
    // Nos aseguramos de cubrir ligeras variaciones de nombre en la columna por si hay espacios extra
    const valFechaFirma = r['FECHA FIRMA CV'] || r['FECHA FIRMA  CV'] || r['Fecha Firma CV'] || r['FECHA_FIRMA_CV'];
    const fechaFirma = valFechaFirma ? parseFechaExcel(valFechaFirma) : null;
    
    // Si no hay fecha de firma, o es anterior al 2024, lo ignoramos
    if(!fechaFirma || fechaFirma.getTime() < new Date(2024, 0, 1).getTime()){
      return; 
    }

    // 2. Extraer Año y Mes desde FECHA ABONO
    // Buscar en múltiples variaciones posibles de la columna
    let valFechaAbono = r['FECHA ABONO'] || r['FECHA  ABONO'] || r['Fecha Abono'] || 
                        r['FECHA_ABONO'] || r['Fecha_Abono'] || r['fecha abono'];
    
    // Si no encontró, intentar con "Mes" y "Año" como fallback
    if(!valFechaAbono && r['Mes'] && r['Año']){
      const mes = num(r['Mes']);
      const anio = num(r['Año']);
      if(mes >= 1 && mes <= 12 && anio > 2000){
        valFechaAbono = new Date(anio, mes-1, 1);
      }
    }
    
    const fechaAbono = valFechaAbono ? parseFechaExcel(valFechaAbono) : null;
    
    if(!fechaAbono) return;

    // Validar montos desde múltiples nombres de columna posibles
    const ingresoSol = num(r['INGRESO S/']) || num(r['Ingreso S/.']) || num(r['INGRESO_S/']) || num(r['Ingreso Sol']);
    const ingresoUsd = num(r['INGRESO US$']) || num(r['Ingreso US$']) || num(r['INGRESO_US$']) || num(r['Ingreso USD']);
    const tipoCambio = num(r['TC']) || num(r['Tipo Cambio']) || TC;
    const monto = (ingresoSol || 0) + (ingresoUsd || 0) * tipoCambio;
    
    if(monto > 0){
      const anio = fechaAbono.getFullYear();
      const mes = fechaAbono.getMonth() + 1; // getMonth es 0-11
      const mKey = `${anio}-${String(mes).padStart(2,'0')}`;
      
      initMes(mKey);
      proyecciones[mKey].iRealizado += monto;
    }
  });

  // 1. Procesar rawProy para unidades no vendidas
  rawProy.forEach(r => {
    const nombreProy = str(r['Proyecto']) || str(r['PROYECTO']);
    if(fp && nombreProy !== fp) return; 
    
    const estatus = str(r['Estatus']).toUpperCase();
    if(estatus === 'VENDIDO') return; 

    const inicio = r['Inicio de Venta Proy.'];
    let mesVenta = null;
    
    if(typeof inicio === 'string' && inicio.startsWith('Date(')){
      const p = inicio.substring(5, inicio.length-1).split(',');
      mesVenta = `${p[0]}-${String(parseInt(p[1])+1).padStart(2,'0')}`;
    } else if (inicio) {
      const d = new Date(inicio);
      if(!isNaN(d)) mesVenta = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }

    if(mesVenta) {
      initMes(mesVenta);
      proyecciones[mesVenta].vUnid += 1;
      proyecciones[mesVenta].vMonto += num(r['Precio Real']);
    }

    // B. Proyección de Ingresos (Columnas de Fechas como 1/6/2025)
    Object.keys(r).forEach(col => {
      const match = col.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if(match) {
        let m = parseInt(match[2]); 
        let y = parseInt(match[3]);
        if(y < 100) y += 2000;
        const mKey = `${y}-${String(m).padStart(2,'0')}`;
        const monto = num(r[col]);
        
        if(monto > 0) {
          initMes(mKey);
          proyecciones[mKey].iProy += monto;
        }
      }
    });
  });

  // 2. Procesar rawCron (Hoja Cronograma) para cuotas en estado "Por Pagar"
  rawCron.forEach(r => {
    const nombreProy = str(r['PROYECTO']) || str(r['Proyecto']);
    if(fp && nombreProy !== fp) return;

    const estadoVenta = str(r['ESTADO VENTA']);       
    const estadoCuota = str(r['ESTADO']);             

    const inmuebleActivo = estadoVenta === 'VENDIDO';
    const cuotaPendiente = estadoCuota === 'Por Pagar';

    if(inmuebleActivo && cuotaPendiente) {
      const fecha = parseFechaExcel(r['Fecha Cuota']);
      if(fecha) {
        const mKey = `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}`;
        initMes(mKey);
        proyecciones[mKey].iCuotas += num(r['Monto Cuota']);
      }
    }
  });

  const keys = Object.keys(proyecciones).sort();

  if(keys.length === 0) {
    document.getElementById('proyecciones-content').innerHTML = '<div class="empty">No hay datos de proyecciones para mostrar.</div>';
    return;
  }

  let totalVU=0, totalVM=0, totalIP=0, totalIC=0, totalIR=0;

  let rowsHtml = keys.map(k => {
    const d = proyecciones[k];
    totalVU += d.vUnid;
    totalVM += d.vMonto;
    totalIP += d.iProy;
    totalIC += d.iCuotas;
    totalIR += d.iRealizado; 
    const totalIngreso = d.iProy + d.iCuotas; // Flujo Proyectado (No incluye realizado)
    
    // Formatear mes (ej. "2025-06" -> "Jun 2025")
    const [y, m] = k.split('-');
    const nombreMes = MESES[parseInt(m)-1] + ' ' + y;

    return `<tr>
      <td class="proy-name font-mono">${nombreMes}</td>
      <td class="font-mono" style="text-align:center">${d.vUnid}</td>
      <td class="font-mono" style="text-align:right">${fmt(d.vMonto)}</td>
      <td class="font-mono" style="text-align:right;color:var(--verde);font-weight:600">${fmt(d.iRealizado)}</td>
      <td class="font-mono" style="text-align:right">${fmt(d.iProy)}</td>
      <td class="font-mono" style="text-align:right">${fmt(d.iCuotas)}</td>
      <td class="font-mono" style="text-align:right;font-weight:600;color:var(--azul-med)">${fmt(totalIngreso)}</td>
    </tr>`;
  }).join('');

  // --- NUEVO: Cálculo de Venta Total Revisado ---
  const ventaTotalRevisado = valorVendidos + totalVM;

  // Calcular porcentaje para la barra de Venta Total Revisado
  const pctVentaReal = (valorVendidos + totalVM) > 0
    ? Math.min(Math.round(valorVendidos / (valorVendidos + totalVM) * 1000) / 10, 100)
    : 0;

  let html = `
    <div class="sec-label">Resumen Comercial</div>

    <!-- Venta Total Revisado con barra de progreso -->
    <div class="prog-wrap" style="margin-bottom:14px;">
      <div class="prog-row">
        <span class="prog-label">Venta Total Revisado</span>
        <span class="prog-pct">${fmt(ventaTotalRevisado)}</span>
      </div>
      <div class="prog-bg"><div class="prog-fill" style="width:${Math.max(pctVentaReal,1)}%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:var(--text3)">
        <span>Vendidos (Activos): <strong style="color:var(--verde)">${fmt(valorVendidos)}</strong></span>
        <span>Proyectados: <strong style="color:var(--text2)">${fmt(totalVM)}</strong></span>
      </div>
    </div>

    <div class="sec-label">Totales de Flujo y Proyección</div>
    <div class="kpi-grid">
      <div class="kpi accent-verde"><div class="kpi-l">Total Unidades Vendidas</div><div class="kpi-v ok">${activosVendidos.length}</div></div>
      <div class="kpi accent-blue"><div class="kpi-l">Valor Vendido S/</div><div class="kpi-v ok money">${fmt(valorVendidos)}</div></div>
      <div class="kpi"><div class="kpi-l">Total Unid. Proyectadas</div><div class="kpi-v">${totalVU}</div></div>
      <div class="kpi"><div class="kpi-l">Valor Ventas Proyectadas</div><div class="kpi-v money">${fmt(totalVM)}</div></div>
      <div class="kpi accent-gold"><div class="kpi-l">Ingresos Realizados</div><div class="kpi-v money" style="color:var(--gold)">${fmt(totalIR)}</div></div>
      <div class="kpi"><div class="kpi-l">Ingresos Proy. (No Vendidos)</div><div class="kpi-v money">${fmt(totalIP)}</div></div>
      <div class="kpi accent-verde" style="grid-column:span 2"><div class="kpi-l">Cuotas por Cobrar (Vendidos)</div><div class="kpi-v ok money">${fmt(totalIC)}</div></div>
    </div>
    <div class="kpi-grid" style="margin-top:0">
      <div class="kpi accent-amber" style="grid-column:span 2"><div class="kpi-l">Flujo de Ingreso Total Proyectado</div><div class="kpi-v warn money">${fmt(totalIP + totalIC)}</div></div>
    </div>
    <div class="tbl-wrap">
      <div class="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th>Mes</th>
              <th style="text-align:center">Unid.<br>a Vender</th>
              <th style="text-align:right">Valor de<br>Venta</th>
              <th style="text-align:right">Ingresos<br>Realizados</th>
              <th style="text-align:right">Ingresos Proy.<br>(No Vend)</th>
              <th style="text-align:right">Cuotas<br>(Vendidos)</th>
              <th style="text-align:right">Flujo Proy.<br>Total</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById('proyecciones-content').innerHTML = html;
}

// ════════════════════════════════════════════════════════════
// PÁGINA 7: PREVENTA
// ════════════════════════════════════════════════════════════
function renderPreventa() {
  const fp = document.getElementById('fil-proyecto').value;
  const proyectos = [...new Set(rawMC.map(r => str(r['PROYECTO'])).filter(Boolean))].sort();
  const listaProyectos = fp ? [fp] : proyectos;

  let html = `
    <div class="sec-label">Avance de Preventa por Proyecto</div>
    <div style="display:flex;gap:15px;margin-bottom:15px;font-size:11px;color:var(--text2)">
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;border-radius:3px;background:var(--verde)"></span>Válido (Califica)</span>
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;border-radius:3px;background:var(--accent)"></span>Proyectado (No califica aún)</span>
    </div>`;

  if (listaProyectos.length === 0) {
    html += '<div class="empty">No hay proyectos para mostrar.</div>';
    document.getElementById('preventa-content').innerHTML = html;
    return;
  }

  listaProyectos.forEach(p => {
    const metaPreventa = rawPrevMeta.find(m => str(m['PROYECTO']) === p);
    const metaMonto = metaPreventa ? num(metaPreventa['META PREVENTA S/']) : 0;

    let montoPreventa = 0;
    let unidadesPreventa = 0;
    let montoProyeccion = 0;
    let unidadesProyeccion = 0;

    const unidadesVendidas = rawMC.filter(r => 
      str(r['PROYECTO']) === p && 
      ['VENDIDO', 'SEPARADO'].includes(str(r['SITUACION'])) &&
      str(r['INMUEBLE']) === 'Departamento' // Solo dptos cuentan para preventa
    );

    unidadesVendidas.forEach(u => {
      const tipoCredito = str(u['Tipo de  Credito']).toLowerCase();
      const valorUnidad = num(u['VALOR S/']);
      const ingresos = num(u['Ingresos  S/.']);
      const pctPagado = valorUnidad > 0 ? (ingresos / valorUnidad) * 100 : 0;
      const tieneCarta = str(u['CARTA APROB.']).toLowerCase() === 'si';

      let califica = false;

      if (tipoCredito.includes('directo')) {
        if (pctPagado >= 30) {
          califica = true;
        }
      } else if (tipoCredito.includes('hipotecario') || tipoCredito.includes('ahorro casa')) {
        if (tieneCarta && pctPagado >= 10) {
          califica = true;
        }
      } else if (tipoCredito.includes('contado')) {
        // Para 'Contado', asumimos que califica si está vendido.
        califica = true;
      }

      if (califica) {
        montoPreventa += valorUnidad;
        unidadesPreventa++;
      } else {
        montoProyeccion += valorUnidad;
        unidadesProyeccion++;
      }
    });

    const pctPreventa = metaMonto > 0 ? Math.min((montoPreventa / metaMonto) * 100, 100) : 0;
    const pctProyeccion = metaMonto > 0 ? Math.min((montoProyeccion / metaMonto) * 100, 100 - pctPreventa) : 0;
    const pctTotal = pctPreventa + pctProyeccion;

    html += `
      <div class="prog-kpi" style="margin-bottom:12px; cursor:pointer;" onclick="mostrarDetallePreventa('${p}')">
        <div class="prog-kpi-header">
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">${p}</div>
            <div class="prog-kpi-label">Meta de Preventa: ${metaMonto > 0 ? fmt(metaMonto) : 'No definida'}</div>
          </div>
          <div class="prog-kpi-pct" style="color:${pctTotal >= 100 ? 'var(--verde)' : 'var(--gold)'}">${pctTotal.toFixed(1)}%</div>
        </div>
        
        <div class="prog-bg" style="height:6px;margin-bottom:8px;">
          <div style="display:flex; height:100%;">
            <div class="prog-fill" style="width:${pctPreventa}%; background:var(--verde); box-shadow:0 0 8px var(--verde-dim);"></div>
            <div class="prog-fill" style="width:${pctProyeccion}%; background:var(--accent); box-shadow:0 0 8px var(--accent-dim);"></div>
          </div>
        </div>

        <div class="prog-kpi-values">
          <span class="prog-kpi-real">Alcanzado: ${fmt(montoPreventa)} (${unidadesPreventa} unid.)</span>
          <span class="prog-kpi-meta">Unidades que califican: ${unidadesPreventa}</span>
        </div>
      </div>
    `;
  });

  if (listaProyectos.length > 1) {
     html += `<div class="empty" style="padding: 20px 0;">Fin de la lista de proyectos.</div>`;
  }

  document.getElementById('preventa-content').innerHTML = html;

  // --- Cuadro resumen por estado y proyecto ---
  const summaryData = {};
  const allStates = [
    'Válido',
    'Pend. Carta de Aprobación',
    'Pend. Cuota Inicial',
    'Pend. Cuota Inicial + CA',
    'Proyección'
  ];

  // Initialize summaryData structure
  allStates.forEach(state => {
    summaryData[state] = {};
    listaProyectos.forEach(p => {
      summaryData[state][p] = 0;
    });
  });

  // Aggregate data for the summary table
  const allUnitsForSummary = rawMC.filter(r =>
    ['VENDIDO', 'SEPARADO'].includes(str(r['SITUACION'])) &&
    str(r['INMUEBLE']) === 'Departamento' &&
    (fp ? str(r['PROYECTO']) === fp : true) // Apply global project filter if any
  );

  allUnitsForSummary.forEach(u => {
    const proyecto = str(u['PROYECTO']);
    const valorUnidad = num(u['VALOR S/']);
    const { status } = getEstadoPreventa(u); // Reuse the existing logic

    if (summaryData[status] && summaryData[status][proyecto] !== undefined) {
      summaryData[status][proyecto] += valorUnidad;
    }
  });

  // Generate HTML for the summary table
  let summaryTableHtml = `
    <div class="sec-label" style="margin-top:24px">Resumen por Estado y Proyecto</div>
    <div class="tbl-wrap">
      <div class="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th>Estado</th>
              ${listaProyectos.map(p => `<th style="text-align:right; font-size: 11px;">${p}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
  `;

  allStates.forEach(state => {
    summaryTableHtml += `<tr><td>${state}</td>`;
    listaProyectos.forEach(p => {
      summaryTableHtml += `<td style="text-align:right">${fmt(summaryData[state][p])}</td>`;
    });
    summaryTableHtml += `</tr>`;
  });

  summaryTableHtml += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  html += summaryTableHtml; // Append to the existing HTML for the preventa page
  document.getElementById('preventa-content').innerHTML = html;
}

// ── MODAL DETALLE PREVENTA ───────────────────────────────────
function mostrarDetallePreventa(proyecto) {
  document.getElementById('modal-preventa-title').textContent = `Detalle de Preventa: ${proyecto}`;
  
  const unidades = rawMC.filter(r => 
    str(r['PROYECTO']) === proyecto && 
    ['VENDIDO', 'SEPARADO'].includes(str(r['SITUACION'])) &&
    str(r['INMUEBLE']) === 'Departamento'
  ).sort((a, b) => {
    // Ordenar por Válido > Pendiente > No Califica
    return (getEstadoPreventa(a).sortOrder || 9) - (getEstadoPreventa(b).sortOrder || 9);
  });

  let bodyHtml = `
    <div class="tbl-wrap">
      <div class="tbl-scroll">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th style="text-align:right">Valor S/</th>
              <th style="text-align:right">Pagado</th>
              <th>Tipo Crédito</th>
              <th>Carta Aprob.</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (unidades.length === 0) {
    bodyHtml += '<tr><td colspan="6" class="empty">No hay unidades vendidas o separadas para este proyecto.</td></tr>';
  } else {
    unidades.forEach(u => {
      const { status, color } = getEstadoPreventa(u);
      bodyHtml += `
        <tr>
          <td>${str(u['Nombre del Cliente'])}<br><small style="color:var(--text3)">Dpto ${str(u['DPTO'])}</small></td>
          <td style="text-align:right">${fmt(num(u['VALOR S/']))}</td>
          <td style="text-align:right">${fmt(num(u['Ingresos  S/.']))}</td>
          <td>${str(u['Tipo de  Credito'])}</td>
          <td>${str(u['CARTA APROB.']) || 'No Req.'}</td>
          <td style="font-weight:600; color:${color}">${status}</td>
        </tr>
      `;
    });
  }

  bodyHtml += `</tbody></table></div></div>`;
  document.getElementById('modal-preventa-body').innerHTML = bodyHtml;
  document.getElementById('modal-preventa').classList.add('visible');
}

function getEstadoPreventa(unidad) {
  const tipoCredito = str(unidad['Tipo de  Credito']).toLowerCase();
  const valorUnidad = num(unidad['VALOR S/']);
  const ingresos = num(unidad['Ingresos  S/.']);
  const pctPagado = valorUnidad > 0 ? (ingresos / valorUnidad) * 100 : 0;
  const tieneCarta = str(unidad['CARTA APROB.']).toLowerCase() === 'si';

  let faltaCI = false, faltaCA = false;

  if (tipoCredito.includes('directo')) {
    if (pctPagado < 30) faltaCI = true;
  } else if (tipoCredito.includes('hipotecario') || tipoCredito.includes('ahorro casa')) {
    if (pctPagado < 10) faltaCI = true;
    if (!tieneCarta) faltaCA = true;
  } else if (tipoCredito.includes('contado')) {
    // Contado siempre es válido si está vendido/separado
    return { status: 'Válido', color: 'var(--verde)', sortOrder: 1 };
  }

  if (!faltaCI && !faltaCA) {
    return { status: 'Válido', color: 'var(--verde)', sortOrder: 1 };
  }
  if (faltaCI && faltaCA) {
    return { status: 'Pend. Cuota Inicial + CA', color: 'var(--rojo)', sortOrder: 4 };
  }
  if (faltaCI) {
    return { status: 'Pend. Cuota Inicial', color: 'var(--amber)', sortOrder: 3 };
  }
  if (faltaCA) {
    return { status: 'Pend. Carta de Aprobación', color: 'var(--amber)', sortOrder: 2 };
  }
  return { status: 'Proyección', color: 'var(--text3)', sortOrder: 5 }; // Fallback
}

function cerrarModalPreventa(event) {
  if(event.target.id === 'modal-preventa' || event.target.classList.contains('modal-close')) {
    document.getElementById('modal-preventa').classList.remove('visible');
  }
}

// ════════════════════════════════════════════════════════════
// STOCK — distribución de unidades por piso (tipo Evolta)
// ════════════════════════════════════════════════════════════
function renderStock() {
  const fp = document.getElementById('fil-proyecto').value;
  const el = document.getElementById('stock-content');
  if (!el) return;

  if (!fp) {
    el.innerHTML = `
      <div class="stock-empty">
        <div class="stock-empty-icon">🏢</div>
        <div class="stock-empty-title">Selecciona un proyecto para mostrar el stock</div>
        <div class="stock-empty-sub">Usa el filtro de proyecto del panel superior para ver la distribución de unidades por piso</div>
      </div>`;
    return;
  }

  _stockDetalle = {};
  let _stockIdx = 0;

  const allUnits = rawMC.filter(r => str(r['PROYECTO']) === fp);
  const dptos = allUnits.filter(r => str(r['INMUEBLE']) === 'Departamento');
  const ests  = allUnits.filter(r => str(r['INMUEBLE']) === 'Estacionamiento');
  const deps  = allUnits.filter(r => {
    const t = str(r['INMUEBLE']).toLowerCase();
    return t === 'deposito' || t === 'depósito';
  });

  function getPiso(r) {
    for (const col of ['PISO', 'Piso', 'piso']) {
      const v = num(r[col]);
      if (v > 0) return v;
    }
    const digits = str(r['DPTO']).replace(/\D/g, '');
    if (!digits) return 1;
    const n = parseInt(digits);
    return n >= 100 ? Math.floor(n / 100) : 1;
  }

  function floorLabel(p) {
    if (p <= 0) return 'SS';
    return 'P' + p;
  }

  const tileClass = {
    'VENDIDO':   'tile-v', 'SEPARADO':  'tile-s',
    'BLOQUEADO': 'tile-b', 'POR VENDER':'tile-d'
  };

  // KPIs
  const total = dptos.length;
  const v = dptos.filter(r => str(r['SITUACION']) === 'VENDIDO').length;
  const s = dptos.filter(r => str(r['SITUACION']) === 'SEPARADO').length;
  const b = dptos.filter(r => str(r['SITUACION']) === 'BLOQUEADO').length;
  const d = total - v - s - b;
  const pct = total > 0 ? (v / total * 100).toFixed(1) : '—';

  // Group dptos by torre → piso
  const byTorre = {};
  dptos.forEach(r => {
    const torre   = str(r['TORRE']) || '';
    const piso    = getPiso(r);
    const dptoId  = str(r['DPTO']);
    const idx     = _stockIdx++;
    _stockDetalle[idx] = r;
    if (!byTorre[torre]) byTorre[torre] = {};
    if (!byTorre[torre][piso]) byTorre[torre][piso] = [];
    byTorre[torre][piso].push({ r, idx, dptoId });
  });

  ests.forEach(r => { _stockDetalle[_stockIdx++] = r; });
  deps.forEach(r => { _stockDetalle[_stockIdx++] = r; });

  const torreNames = Object.keys(byTorre).sort();
  const multiTorre = torreNames.some(t => t !== '');

  function buildFloorPlan(torreName) {
    const pisoMap = byTorre[torreName] || {};
    const pisos   = Object.keys(pisoMap).map(Number).sort((a, b) => b - a);

    const floorsHtml = pisos.map(p => {
      const units = [...pisoMap[p]].sort((a, b) => {
        const na = parseInt(a.dptoId.replace(/\D/g, '') || '0');
        const nb = parseInt(b.dptoId.replace(/\D/g, '') || '0');
        return na - nb;
      });
      const tilesHtml = units.map(({ r, idx, dptoId }) => {
        const sit     = str(r['SITUACION']);
        const cls     = tileClass[sit] || 'tile-d';
        const areaV   = num(r['Area  Ocupada']);
        const cliente = str(r['Nombre del Cliente']);
        const tip     = (cliente ? dptoId + ' — ' + cliente : dptoId).replace(/"/g, '');
        return `<div class="stock-tile ${cls}" onclick="mostrarDetalleStock(${idx})" title="${tip}">
          <div class="stock-tile-num">${dptoId}</div>
          ${areaV > 0 ? `<div class="stock-tile-area">${Math.round(areaV)}m²</div>` : ''}
        </div>`;
      }).join('');

      return `<div class="stock-floor">
        <div class="stock-floor-label">${floorLabel(p)}</div>
        <div class="stock-units-row">${tilesHtml}</div>
      </div>`;
    }).join('');

    const header = torreName
      ? `<div class="stock-torre-name">Torre ${torreName}</div>`
      : '';
    return `<div class="stock-torre-wrap">${header}${floorsHtml}</div>`;
  }

  let planHtml;
  if (!multiTorre) {
    planHtml = `<div class="stock-plan">${buildFloorPlan(torreNames[0] || '')}</div>`;
  } else {
    planHtml = `<div class="stock-plan"><div class="stock-torres-grid">${torreNames.map(t => buildFloorPlan(t)).join('')}</div></div>`;
  }

  // Estacionamientos y depósitos (mini tiles, reutilizamos índices ya asignados)
  const estStartIdx = total;
  const depStartIdx = estStartIdx + ests.length;
  let extrasHtml = '';
  if (ests.length > 0 || deps.length > 0) {
    extrasHtml += `<div class="sec-label" style="margin-top:24px">Unidades complementarias</div>`;
    if (ests.length > 0) {
      const tiles = ests.map((r, i) => {
        const idx = estStartIdx + i;
        const sit = str(r['SITUACION']);
        const cls = tileClass[sit] || 'tile-d';
        const n   = str(r['EST']);
        return `<div class="stock-mini-tile ${cls}" onclick="mostrarDetalleStock(${idx})" title="${n}">${n}</div>`;
      }).join('');
      extrasHtml += `<div style="margin-bottom:14px"><div class="stock-extras-label">Estacionamientos &middot; ${ests.length}</div><div class="stock-mini-row">${tiles}</div></div>`;
    }
    if (deps.length > 0) {
      const tiles = deps.map((r, i) => {
        const idx = depStartIdx + i;
        const sit = str(r['SITUACION']);
        const cls = tileClass[sit] || 'tile-d';
        const n   = str(r['DEP']);
        return `<div class="stock-mini-tile ${cls}" onclick="mostrarDetalleStock(${idx})" title="${n}">${n}</div>`;
      }).join('');
      extrasHtml += `<div><div class="stock-extras-label">Depósitos &middot; ${deps.length}</div><div class="stock-mini-row">${tiles}</div></div>`;
    }
  }

  el.innerHTML = `
    <div class="sec-label">Stock · ${fp}</div>
    <div class="kpi-grid" style="margin-bottom:14px">
      <div class="kpi accent-verde"><div class="kpi-l">Vendidos</div><div class="kpi-v ok">${v}</div><div class="kpi-s">de ${total} dptos</div></div>
      <div class="kpi accent-amber"><div class="kpi-l">Separados</div><div class="kpi-v warn">${s}</div></div>
      <div class="kpi accent-rojo"><div class="kpi-l">Bloqueados</div><div class="kpi-v danger">${b}</div></div>
      <div class="kpi"><div class="kpi-l">Disponibles</div><div class="kpi-v">${d}</div></div>
      <div class="kpi accent-gold"><div class="kpi-l">% Vendido</div><div class="kpi-v" style="color:var(--gold)">${pct}%</div></div>
    </div>
    <div class="stock-legend">
      <span class="stock-legend-item"><span class="stock-legend-swatch tile-v"></span>Vendido (${v})</span>
      <span class="stock-legend-item"><span class="stock-legend-swatch tile-s"></span>Separado (${s})</span>
      <span class="stock-legend-item"><span class="stock-legend-swatch tile-b"></span>Bloqueado (${b})</span>
      <span class="stock-legend-item"><span class="stock-legend-swatch tile-d"></span>Disponible (${d})</span>
      <span class="stock-legend-hint">Pisos: mayor → menor &middot; Clic en unidad para ver detalle</span>
    </div>
    ${planHtml}
    ${extrasHtml}
  `;
}

function mostrarDetalleStock(idx) {
  const r = _stockDetalle[idx];
  if (!r) return;

  const sit      = str(r['SITUACION']);
  const inmueble = str(r['INMUEBLE']);
  const isEst    = inmueble === 'Estacionamiento';
  const isDep    = inmueble.toLowerCase().includes('dep');
  const unitNum  = str(r['DPTO']) || str(r['EST']) || str(r['DEP']);
  const cliente  = str(r['Nombre del Cliente']);
  const areaV        = num(r['Area  Ocupada']);
  const isPrecioLista= sit === 'POR VENDER' || sit === 'BLOQUEADO';
  const valor        = isPrecioLista ? num(r['Presupuestado S/']) : num(r['VALOR S/']);
  const valorLabel   = isPrecioLista ? 'Presupuestado' : 'Precio';
  const ingresos     = num(r['Ingresos  S/.']);
  const porCobrar= num(r['Por Pagar  S/.']);
  const tipo     = str(r['Tipo de  Credito']);
  const vendedor = str(r['VENDEDOR']);
  const torre    = str(r['TORRE']);
  const pisoCol  = num(r['PISO']) || num(r['Piso']);
  const carta    = str(r['CARTA APROB.']);
  const mes = num(r['MES DE VENTA']), anio = num(r['AÑO DE VENTA']);
  const fechaVenta = (mes >= 1 && mes <= 12 && anio > 2000) ? MESES[mes - 1] + ' ' + anio : null;

  const sitColors = { 'VENDIDO':'var(--verde)', 'SEPARADO':'var(--amber)', 'BLOQUEADO':'var(--rojo)', 'POR VENDER':'var(--text3)' };
  const sitBgs    = { 'VENDIDO':'var(--verde-cl)', 'SEPARADO':'var(--amber-cl)', 'BLOQUEADO':'var(--rojo-cl)', 'POR VENDER':'var(--surface2)' };
  const sitLabels = { 'VENDIDO':'Vendido', 'SEPARADO':'Separado', 'BLOQUEADO':'Bloqueado', 'POR VENDER':'Disponible' };
  const sitColor  = sitColors[sit] || 'var(--text2)';
  const sitBg     = sitBgs[sit]    || 'var(--surface2)';
  const sitLabel  = sitLabels[sit] || sit;
  const unitPrefix= isEst ? 'Estac.' : isDep ? 'Dep.' : 'Dpto';

  document.getElementById('modal-stock-title').textContent =
    `${unitPrefix} ${unitNum}${torre ? ' · Torre ' + torre : ''}`;

  const kpis = [];
  if (areaV > 0)      kpis.push(`<div class="ck"><div class="ck-l">Área</div><div class="ck-v">${areaV.toFixed(2)} m²</div></div>`);
  if (valor > 0)      kpis.push(`<div class="ck"><div class="ck-l">${valorLabel}</div><div class="ck-v">${fmt(valor)}</div></div>`);
  if (ingresos > 0)   kpis.push(`<div class="ck"><div class="ck-l">Cobrado</div><div class="ck-v ok">${fmt(ingresos)}</div></div>`);
  if (porCobrar > 0)  kpis.push(`<div class="ck"><div class="ck-l">Por cobrar</div><div class="ck-v warn">${fmt(porCobrar)}</div></div>`);

  const detalles = [];
  if (tipo)        detalles.push([tipo, null, 'Tipo crédito']);
  if (fechaVenta)  detalles.push([fechaVenta, null, 'Fecha venta']);
  if (vendedor)    detalles.push([vendedor, null, 'Vendedor']);
  if (pisoCol > 0) detalles.push(['Piso ' + pisoCol, null, 'Piso']);
  if (sit !== 'POR VENDER') {
    const cartaOk = carta.toLowerCase() === 'si';
    detalles.push([carta || 'Pendiente', cartaOk ? 'var(--verde)' : null, 'Carta aprob.']);
  }

  document.getElementById('modal-stock-body').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:${sitBg};border-radius:var(--radius);border:1px solid var(--border2);margin-bottom:16px">
      <div style="width:9px;height:9px;border-radius:3px;background:${sitColor};flex-shrink:0"></div>
      <div style="font-size:14px;font-weight:700;color:${sitColor}">${sitLabel}</div>
      ${cliente
        ? `<div style="margin-left:auto;font-size:13px;font-weight:600;color:var(--text);text-align:right;line-height:1.3">${cliente}</div>`
        : '<div style="margin-left:auto;font-size:11px;color:var(--text3)">Sin asignar</div>'}
    </div>
    ${kpis.length ? `<div class="cliente-kpis" style="margin-bottom:14px">${kpis.join('')}</div>` : ''}
    ${detalles.length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 20px">
      ${detalles.map(([val, color, lbl]) => `
        <div>
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">${lbl}</div>
          <div style="font-size:13px;font-weight:600;color:${color || 'var(--text)'}">${val}</div>
        </div>`).join('')}
    </div>` : ''}
  `;

  document.getElementById('modal-stock').classList.add('visible');
}

function cerrarModalStock(event) {
  if (!event || event.target.id === 'modal-stock' || event.target.classList.contains('modal-close')) {
    document.getElementById('modal-stock').classList.remove('visible');
  }
}

// ── Navegación ───────────────────────────────────────────────
function mostrarPagina(id, btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  btn.classList.add('active');
  const filCuotaWrap = document.getElementById('fil-cuota-wrap');
  if(filCuotaWrap) filCuotaWrap.style.display = id==='cronograma' ? 'flex' : 'none';

  if(id !== 'cobranza'){
    window.filTipoCredito = '';
  }
}

// ── Auto-refresco ─────────────────────────────────────────────
const INTERVALO_MS = 60 * 60 * 1000;
let timerRefresco = null;
let ultimaCarga = null;

function programarRefresco() {
  if (timerRefresco) clearTimeout(timerRefresco);
  timerRefresco = setTimeout(async () => {
    await cargarDatos();
    programarRefresco();
  }, INTERVALO_MS);
  actualizarIndicador();
}

function actualizarIndicador() {
  if (!ultimaCarga) return;
  const diff = Math.round((Date.now() - ultimaCarga) / 60000);
  const prox = 60 - diff;
  const el = document.getElementById('refresco-info');
  if (el) el.textContent = diff === 0
    ? 'Datos actualizados ahora · próximo refresco en 60 min'
    : `Datos de hace ${diff} min · próximo refresco en ${prox} min`;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const diffMin = ultimaCarga ? (Date.now() - ultimaCarga) / 60000 : 999;
    if (diffMin >= 5) {
      cargarDatos().then(programarRefresco);
    } else {
      actualizarIndicador();
    }
  }
});

const _cargarDatosOriginal = cargarDatos;
cargarDatos = async function() {
  await _cargarDatosOriginal();
  ultimaCarga = Date.now();
  actualizarIndicador();
};

// ── Arranque ─────────────────────────────────────────────────
cargarDatos().then(programarRefresco);