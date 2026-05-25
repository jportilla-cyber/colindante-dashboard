// ════════════════════════════════════════════════════════════
// VARIANT ENHANCEMENTS
// Hooks que envuelven renderResumen / renderGraficos
// para añadir el bloque Preventa Hero y conclusiones de gráficos.
// ════════════════════════════════════════════════════════════

(function () {
  // ─────────────────────────────────────────────────────────
  // PREVENTA HERO — calcula stats por proyecto y los muestra
  // como tarjetas semáforo arriba del resumen ejecutivo.
  // ─────────────────────────────────────────────────────────
  function computePreventaPorProyecto() {
    const fp = (document.getElementById('fil-proyecto') || {}).value || '';
    const proyectos = [...new Set(rawMC.map(r => str(r['PROYECTO'])).filter(Boolean))].sort();
    const lista = fp ? [fp] : proyectos;

    const out = [];
    let totalMeta = 0, totalValido = 0, totalUnidValido = 0, totalUnidTotal = 0;

    lista.forEach(p => {
      const meta = rawPrevMeta.find(m => str(m['PROYECTO']) === p);
      const metaMonto = meta ? num(meta['META PREVENTA S/']) : 0;
      let validoMonto = 0, validoU = 0, totalUnitsActivas = 0;

      const unidades = rawMC.filter(r =>
        str(r['PROYECTO']) === p &&
        ['VENDIDO', 'SEPARADO'].includes(str(r['SITUACION'])) &&
        str(r['INMUEBLE']) === 'Departamento'
      );

      unidades.forEach(u => {
        totalUnitsActivas++;
        const tipo = str(u['Tipo de  Credito']).toLowerCase();
        const valor = num(u['VALOR S/']);
        const ingresos = num(u['Ingresos  S/.']);
        const pct = valor > 0 ? (ingresos / valor) * 100 : 0;
        const carta = str(u['CARTA APROB.']).toLowerCase() === 'si';
        let califica = false;
        if (tipo.includes('directo'))                          califica = pct >= 30;
        else if (tipo.includes('hipotecario') || tipo.includes('ahorro casa')) califica = carta && pct >= 10;
        else if (tipo.includes('contado'))                     califica = true;
        if (califica) { validoMonto += valor; validoU++; }
      });

      const pctMeta = metaMonto > 0 ? Math.min((validoMonto / metaMonto) * 100, 100) : 0;
      let status = 'danger';
      if (pctMeta >= 80) status = 'ok';
      else if (pctMeta >= 40) status = 'warn';

      out.push({
        proyecto: p,
        meta: metaMonto,
        validoMonto, validoU,
        unidActivas: totalUnitsActivas,
        pctMeta,
        status
      });
      totalMeta += metaMonto;
      totalValido += validoMonto;
      totalUnidValido += validoU;
      totalUnidTotal += totalUnitsActivas;
    });

    return { lista: out, totalMeta, totalValido, totalUnidValido, totalUnidTotal };
  }

  function renderPreventaHero() {
    if (typeof rawMC === 'undefined' || !rawMC.length) return '';
    const data = computePreventaPorProyecto();
    if (!data.lista.length) return '';

    const pctGlobal = data.totalMeta > 0 ? (data.totalValido / data.totalMeta * 100) : 0;
    let statusGlobal = 'danger';
    if (pctGlobal >= 80) statusGlobal = 'ok';
    else if (pctGlobal >= 40) statusGlobal = 'warn';

    const cards = data.lista.map(d => {
      const pct = d.pctMeta.toFixed(1);
      const statusLabel = d.status === 'ok' ? 'En meta' : d.status === 'warn' ? 'En riesgo' : 'Crítico';
      return `
        <div class="ph-proj-card">
          <div class="ph-proj-status ${d.status}" title="${statusLabel}"></div>
          <div class="ph-proj-name">${d.proyecto}</div>
          <div class="ph-proj-pct ${d.status}">${pct}<span style="font-size:13px;opacity:.6;font-weight:500;letter-spacing:0">%</span></div>
          <div class="ph-proj-meta">
            ${d.validoU} de ${d.unidActivas} unid. válidas<br>
            ${fmt(d.validoMonto)} de ${fmt(d.meta)}
          </div>
          <div class="ph-proj-bar"><div class="ph-proj-bar-fill ${d.status}" style="width:${Math.max(d.pctMeta, 1)}%"></div></div>
        </div>
      `;
    }).join('');

    return `
      <div class="preventa-hero">
        <div class="preventa-hero-head">
          <div>
            <div class="ph-eyebrow">▲ Prioridad gerencial</div>
            <div class="ph-title">Avance de Preventa · Activación de proyectos</div>
            <div class="ph-sub">Unidades que califican según tipo de crédito, % pagado y carta de aprobación.</div>
          </div>
          <div class="ph-stat-row">
            <div>
              <div class="ph-stat-label">Avance global</div>
              <div class="ph-stat-value ${statusGlobal === 'ok' ? 'ok' : statusGlobal === 'warn' ? 'warn' : ''}" style="${statusGlobal==='danger'?'color:var(--rojo)':''}">${pctGlobal.toFixed(1)}%</div>
            </div>
            <div>
              <div class="ph-stat-label">Válido / Meta</div>
              <div class="ph-stat-value">${fmt(data.totalValido)}<span style="font-size:11px;color:var(--text3);margin-left:6px">de ${fmt(data.totalMeta)}</span></div>
            </div>
            <div>
              <div class="ph-stat-label">Unidades</div>
              <div class="ph-stat-value">${data.totalUnidValido}<span style="font-size:11px;color:var(--text3);margin-left:6px">de ${data.totalUnidTotal}</span></div>
            </div>
          </div>
        </div>
        <div class="ph-projects">${cards}</div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────
  // CHART INSIGHTS — conclusiones generadas desde los datos
  // ─────────────────────────────────────────────────────────
  function insightVentasVsIngresos() {
    if (typeof rawMC === 'undefined') return '';
    const ahora = new Date();
    const yAct = ahora.getFullYear(), mAct = ahora.getMonth() + 1;
    let vMes = 0, iMes = 0, vAnio = 0, iAnio = 0;

    filtrado.filter(r => str(r['SITUACION']) === 'VENDIDO').forEach(r => {
      const m = num(r['MES DE VENTA']), y = num(r['AÑO DE VENTA']);
      if (y === yAct) { vAnio += num(r['VALOR S/']); if (m === mAct) vMes += num(r['VALOR S/']); }
    });
    const fp = (document.getElementById('fil-proyecto') || {}).value || '';
    rawAB.filter(r => str(r['DPTO']) !== '').forEach(r => {
      if (fp && str(r['PROYECTO']) !== fp) return;
      const m = num(r['Mes']), y = num(r['Año']);
      const monto = num(r['INGRESO S/']) + num(r['INGRESO US$']) * (num(r['TC']) || 3.477);
      if (y === yAct && monto > 0) { iAnio += monto; if (m === mAct) iMes += monto; }
    });
    const ratio = vAnio > 0 ? (iAnio / vAnio * 100).toFixed(1) : 0;
    return `<strong>En lo que va del año</strong> se han facturado ${fmt(vAnio)} en ventas y cobrado ${fmt(iAnio)} (${ratio}% del valor vendido). Este mes: ${fmt(vMes)} en ventas, ${fmt(iMes)} en cobros.`;
  }

  function insightProyAcumulada() {
    if (typeof rawMC === 'undefined') return '';
    const fp = (document.getElementById('fil-proyecto') || {}).value || '';
    let proyU = 0, proyMonto = 0;
    rawProy.forEach(r => {
      if (fp && str(r['Proyecto'] || r['PROYECTO']) !== fp) return;
      if (str(r['Estatus']).toUpperCase() === 'VENDIDO') return;
      proyU++;
      proyMonto += num(r['Precio Real']);
    });
    return `Quedan <strong>${proyU} unidades</strong> proyectadas por vender (${fmt(proyMonto)}). La línea sólida es lo realizado; la punteada es la proyección hacia adelante.`;
  }

  function insightMetaComercial() {
    if (typeof rawMC === 'undefined' || !rawCMeta || !rawCMeta.length) return '';
    const ahora = new Date();
    const yAct = ahora.getFullYear(), mAct = ahora.getMonth() + 1;
    const mKeyAct = `${yAct}-${String(mAct).padStart(2, '0')}`;
    const fp = (document.getElementById('fil-proyecto') || {}).value || '';

    // Meta del mes
    const colsFecha = Object.keys(rawCMeta[0])[0];
    const colsProy = Object.keys(rawCMeta[0]).slice(1);
    let metaMes = 0;
    rawCMeta.forEach(r => {
      const v = r[colsFecha];
      let k = null;
      if (typeof v === 'string' && v.startsWith('Date(')) {
        const p = v.substring(5, v.length - 1).split(',');
        k = `${p[0]}-${String(parseInt(p[1]) + 1).padStart(2, '0')}`;
      }
      if (k === mKeyAct) {
        colsProy.forEach(col => {
          if (fp && col.trim() !== fp) return;
          metaMes += num(r[col]);
        });
      }
    });
    // Real del mes
    let realMes = 0;
    filtrado.filter(r => str(r['SITUACION']) === 'VENDIDO').forEach(r => {
      const m = num(r['MES DE VENTA']), y = num(r['AÑO DE VENTA']);
      if (m === mAct && y === yAct) realMes++;
    });
    const pct = metaMes > 0 ? (realMes / metaMes * 100).toFixed(0) : '—';
    const estado = metaMes === 0 ? 'sin meta definida' : (realMes >= metaMes ? 'en meta ✓' : realMes >= metaMes * 0.7 ? 'cerca de meta' : 'debajo de meta');
    return `Meta de este mes: <strong>${metaMes} unidades</strong>. Real: <strong>${realMes}</strong> (${pct}% — ${estado}).`;
  }

  function insightAcumUnidades() {
    if (typeof rawMC === 'undefined') return '';
    const realTotal = filtrado.filter(r => str(r['SITUACION']) === 'VENDIDO').length;
    const proyTotal = rawProy.filter(r => str(r['Estatus']).toUpperCase() !== 'VENDIDO').length;
    return `Total vendido hasta hoy: <strong>${realTotal} unidades</strong>. Proyectadas pendientes: <strong>${proyTotal}</strong>. El gap entre ambas líneas muestra el faltante para alcanzar la meta acumulada.`;
  }

  function insightAcumIngresos() {
    if (typeof rawMC === 'undefined') return '';
    const fp = (document.getElementById('fil-proyecto') || {}).value || '';
    let realT = 0;
    rawAB.filter(r => str(r['DPTO']) !== '').forEach(r => {
      if (fp && str(r['PROYECTO']) !== fp) return;
      realT += num(r['INGRESO S/']) + num(r['INGRESO US$']) * (num(r['TC']) || 3.477);
    });
    return `Total cobrado real acumulado: <strong>${fmt(realT)}</strong>. La distancia respecto a la meta indica el atraso o adelanto en flujo de caja.`;
  }

  // ─────────────────────────────────────────────────────────
  // WRAP renderResumen — añade Preventa Hero al inicio
  // ─────────────────────────────────────────────────────────
  if (typeof renderResumen === 'function') {
    const _origResumen = renderResumen;
    renderResumen = function () {
      _origResumen.apply(this, arguments);
      const el = document.getElementById('resumen-content');
      if (el && typeof rawMC !== 'undefined' && rawMC.length) {
        const heroHtml = renderPreventaHero();
        if (heroHtml) el.insertAdjacentHTML('afterbegin', heroHtml);
      }
    };
  }

  // ─────────────────────────────────────────────────────────
  // WRAP renderGraficos — añade .chart-insight bajo cada gráfico
  // ─────────────────────────────────────────────────────────
  if (typeof renderGraficos === 'function') {
    const _origGraf = renderGraficos;
    renderGraficos = function () {
      _origGraf.apply(this, arguments);

      const inserts = [
        ['ch-vr-ingr', insightVentasVsIngresos()],
        ['ch-proy-ingr', insightProyAcumulada()],
        ['ch-comercial-meta-mensual', insightMetaComercial()],
        ['ch-comercial-meta', insightMetaComercial()],
        ['ch-acum-unid', insightAcumUnidades()],
        ['ch-acum-s', insightAcumIngresos()]
      ];
      inserts.forEach(([id, html]) => {
        if (!html) return;
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const card = canvas.closest('.chart-card');
        if (!card || card.querySelector('.chart-insight')) return;
        const div = document.createElement('div');
        div.className = 'chart-insight';
        div.innerHTML = '<strong>Lectura: </strong>' + html;
        card.appendChild(div);
      });
    };
  }
})();
