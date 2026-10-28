/* Minimal, dependency-free SVG chart helpers for the analytics dashboard.
   No chart library exists anywhere in this project yet (checked dashboard.js,
   leads.js, testimonials.js), and the project is intentionally plain
   HTML/CSS/vanilla JS with no build step — so this stays framework-free
   rather than pulling in Chart.js or similar. */

const PURPLE = '#4B0082';
const PURPLE_LIGHT = '#7b3fb3';
const SUCCESS = '#1a7f4f';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Renders a responsive SVG line chart. points: [{label, value}], returns an HTML string. */
export function lineChart({ points, color = PURPLE, formatValue = (v) => String(v), height = 220 }) {
  if (!points || points.length === 0) {
    return '<div class="empty-state">No data for this period.</div>';
  }
  const width = 760;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 16;

  // Show at most ~8 x-axis labels to avoid crowding on small screens; rotate
  // them if even the thinned set would be too tight to read horizontally.
  const n = points.length;
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const effectiveLabelCount = Math.ceil(n / labelEvery);
  const plotWEstimate = width - padLeft - padRight;
  const pxPerLabel = plotWEstimate / Math.max(1, effectiveLabelCount);
  const rotate = pxPerLabel < 56;

  const padBottom = rotate ? 48 : 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(1, ...points.map((p) => p.value));
  const stepX = n > 1 ? plotW / (n - 1) : 0;

  const coords = points.map((p, i) => {
    const x = padLeft + (n > 1 ? i * stepX : plotW / 2);
    const y = padTop + plotH - (p.value / maxVal) * plotH;
    return { x, y, ...p };
  });

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${coords[coords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

  const lastRegularIdx = Math.floor((n - 1) / labelEvery) * labelEvery;
  const labelSet = new Set();
  for (let i = 0; i < n; i += labelEvery) labelSet.add(i);
  if (n - 1 - lastRegularIdx < labelEvery / 2 && lastRegularIdx !== n - 1) {
    labelSet.delete(lastRegularIdx);
  }
  labelSet.add(n - 1);

  const xLabels = coords
    .filter((_, i) => labelSet.has(i))
    .map((c) => {
      const lx = c.x.toFixed(1);
      const ly = height - (rotate ? 14 : 8);
      return rotate
        ? `<text x="${lx}" y="${ly}" font-size="10" fill="var(--text-soft)" text-anchor="end" transform="rotate(-40 ${lx} ${ly})">${escapeHtml(c.label)}</text>`
        : `<text x="${lx}" y="${ly}" font-size="10" fill="var(--text-soft)" text-anchor="middle">${escapeHtml(c.label)}</text>`;
    })
    .join('');

  const gridLines = [0, 0.5, 1]
    .map((f) => {
      const y = padTop + plotH * f;
      const val = maxVal * (1 - f);
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
        <text x="${padLeft - 6}" y="${(y + 3).toFixed(1)}" font-size="10" fill="var(--text-soft)" text-anchor="end">${escapeHtml(formatValue(Math.round(val)))}</text>`;
    })
    .join('');

  const dots = coords
    .map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="${color}"><title>${escapeHtml(c.label)}: ${escapeHtml(formatValue(c.value))}</title></circle>`)
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block" role="img" aria-label="Line chart">
    <defs>
      <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridLines}
    <path d="${areaD}" fill="url(#areaFill)"/>
    <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

/** Renders a responsive SVG bar chart. bars: [{label, value}]. */
export function barChart({ bars, color = PURPLE_LIGHT, formatValue = (v) => String(v), height = 220 }) {
  if (!bars || bars.length === 0 || bars.every((b) => b.value === 0)) {
    return '<div class="empty-state">No data for this period.</div>';
  }
  const width = 760;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 16;

  // Show at most ~8 x-axis labels to avoid crowding when there are many bars
  // (e.g. a daily view spanning a month). Always keep the last label.
  const n = bars.length;
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const effectiveLabelCount = Math.ceil(n / labelEvery);
  const plotWEstimate = width - padLeft - padRight;
  const pxPerLabel = plotWEstimate / Math.max(1, effectiveLabelCount);
  const rotate = pxPerLabel < 56;

  const padBottom = rotate ? 54 : 36;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(1, ...bars.map((b) => b.value));
  const gap = n > 1 ? plotW / n * 0.25 : 0;
  const barW = (plotW / n) - gap;

  // Decide which bars get a label up front: every `labelEvery`-th bar, plus
  // the last bar always. If the last regular label would land right next to
  // the forced last label, drop that regular one so they don't collide.
  const lastRegularIdx = Math.floor((n - 1) / labelEvery) * labelEvery;
  const labelSet = new Set();
  for (let i = 0; i < n; i += labelEvery) labelSet.add(i);
  if (n - 1 - lastRegularIdx < labelEvery / 2 && lastRegularIdx !== n - 1) {
    labelSet.delete(lastRegularIdx);
  }
  labelSet.add(n - 1);

  const rects = bars
    .map((b, i) => {
      const x = padLeft + i * (plotW / n) + gap / 2;
      const barH = (b.value / maxVal) * plotH;
      const y = padTop + plotH - barH;
      const showLabel = labelSet.has(i);
      const labelX = (x + barW / 2).toFixed(1);
      const labelY = height - (rotate ? 20 : 14);
      const label = showLabel
        ? (rotate
          ? `<text x="${labelX}" y="${labelY}" font-size="10" fill="var(--text-soft)" text-anchor="end" transform="rotate(-40 ${labelX} ${labelY})">${escapeHtml(b.label)}</text>`
          : `<text x="${labelX}" y="${labelY}" font-size="10" fill="var(--text-soft)" text-anchor="middle">${escapeHtml(b.label)}</text>`)
        : '';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="3">
        <title>${escapeHtml(b.label)}: ${escapeHtml(formatValue(b.value))}</title>
      </rect>
      ${label}`;
    })
    .join('');

  const gridLines = [0, 0.5, 1]
    .map((f) => {
      const y = padTop + plotH * f;
      const val = maxVal * (1 - f);
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
        <text x="${padLeft - 6}" y="${(y + 3).toFixed(1)}" font-size="10" fill="var(--text-soft)" text-anchor="end">${escapeHtml(formatValue(Math.round(val)))}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block" role="img" aria-label="Bar chart">
    ${gridLines}
    ${rects}
  </svg>`;
}

/** Simple donut/pie-free horizontal distribution bars (status counts), avoids a pie chart's harder-to-read labels. */
export function distributionBars({ rows, colorFor }) {
  if (!rows || rows.length === 0) return '<div class="empty-state">No data for this period.</div>';
  const total = rows.reduce((s, r) => s + r.count, 0);
  return `<div style="display:flex;flex-direction:column;gap:10px">
    ${rows
      .map((r) => {
        const pct = total > 0 ? (r.count / total) * 100 : 0;
        const color = colorFor ? colorFor(r.status) : PURPLE;
        return `<div>
          <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px">
            <span style="text-transform:capitalize;color:var(--text)">${escapeHtml(r.status)}</span>
            <span style="color:var(--text-soft)">${r.count} (${pct.toFixed(1)}%)</span>
          </div>
          <div style="background:var(--lavender-soft);border-radius:999px;height:8px;overflow:hidden">
            <div style="width:${pct.toFixed(2)}%;background:${color};height:100%"></div>
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

export { SUCCESS };