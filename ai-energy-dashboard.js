// =========================================================================
// AI's Power Bill — Dashboard Logic
// Loads CSVs, processes them, renders Chart.js visuals styled to match
// the portfolio's warm-paper / ink / burnt-orange design system.
// =========================================================================

const COLORS = {
  ink: '#0f0e0b',
  paper: '#f5f2eb',
  accent: '#c8531a',
  accent2: '#1a6bc8',
  muted: '#7a7568',
  border: '#d8d3c8',
  card: '#eeeae0',
};

const REGION_COLORS = {
  ERCO: '#c8531a',
  PJM: '#1a6bc8',
  MISO: '#5a8a5a',
  CISO: '#9a6bc8',
};

const REGION_LABELS = {
  ERCO: 'ERCOT (Texas)',
  PJM: 'PJM (Mid-Atlantic)',
  MISO: 'MISO',
  CISO: 'CISO (California)',
};

const STATE_COLORS = {
  VA: '#c8531a',
  TX: '#1a6bc8',
  OH: '#5a8a5a',
  CA: '#9a6bc8',
  GA: '#c8a01a',
};

// Set global Chart.js defaults to match site typography
Chart.defaults.font.family = "'DM Sans', sans-serif";
Chart.defaults.color = COLORS.muted;
Chart.defaults.borderColor = COLORS.border;

// -------------------------------------------------------------------------
// CSV PARSING (lightweight, no dependency — these are simple flat CSVs)
// -------------------------------------------------------------------------
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    // simple split; our CSVs don't have embedded commas in values
    const vals = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] !== undefined ? vals[i].trim() : ''; });
    return row;
  });
}

async function loadCSV(path) {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`Failed to load ${path}: ${resp.status}`);
    const text = await resp.text();
    return parseCSV(text);
  } catch (err) {
    console.error(`Error loading ${path}:`, err);
    return null;
  }
}

// -------------------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------------------
function rollingAverage(values, window) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1).filter(v => !isNaN(v));
    out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null);
  }
  return out;
}

function yoyGrowth(values) {
  // assumes values are sequential daily/monthly points; computes 365-step or 12-step YoY
  return values.map((v, i, arr) => {
    const prior = arr[i - 365] ?? arr[i - 12];
    if (prior === undefined || prior === null || isNaN(prior) || prior === 0) return null;
    return ((v - prior) / prior) * 100;
  });
}

function formatMonthLabel(period) {
  // period like "2015-01" -> "Jan 2015"
  const [y, m] = period.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

// -------------------------------------------------------------------------
// FALLBACK DEMO DATA
// Used only if the real CSVs (from pull_eia_data.py output) aren't found at
// the expected paths — keeps the page functional for preview/dev purposes.
// Replace by placing real CSVs at: data/national_demand_monthly.csv etc.
// -------------------------------------------------------------------------
function generateFallbackNationalDemand() {
  const rows = [];
  const start = new Date('2015-01-01');
  for (let i = 0; i < 132; i++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const seasonal = Math.sin((d.getMonth() / 12) * 2 * Math.PI) * 8000;
    const yearsSince2023 = Math.max(0, d.getFullYear() - 2023 + d.getMonth() / 12);
    const trendBreak = yearsSince2023 * 4500;
    const base = 320000 + i * 90 + seasonal + trendBreak;
    rows.push({ period, sales: String(base.toFixed(0)) });
  }
  return rows;
}

function generateFallbackRegional() {
  const rows = [];
  const regions = ['ERCO', 'PJM', 'MISO', 'CISO'];
  const baseDemand = { ERCO: 45000, PJM: 90000, MISO: 80000, CISO: 28000 };
  const growthRate = { ERCO: 0.00018, PJM: 0.00022, MISO: 0.00008, CISO: 0.00006 };
  const start = new Date('2018-01-01');
  const totalDays = Math.floor((new Date() - start) / 86400000);
  for (let r = 0; r < regions.length; r++) {
    const region = regions[r];
    for (let i = 0; i < totalDays; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const period = d.toISOString().slice(0, 10);
      const dayOfYear = (d - new Date(d.getFullYear(), 0, 0)) / 86400000;
      const seasonal = Math.sin((dayOfYear / 365) * 2 * Math.PI - Math.PI / 2) * baseDemand[region] * 0.18;
      const weekday = d.getDay();
      const weekendDip = (weekday === 0 || weekday === 6) ? -0.06 * baseDemand[region] : 0;
      const trend = baseDemand[region] * growthRate[region] * i;
      const noise = (Math.random() - 0.5) * baseDemand[region] * 0.04;
      const value = baseDemand[region] + seasonal + weekendDip + trend + noise;
      rows.push({ period, respondent: region, value: String(value.toFixed(0)), type: 'D' });
    }
  }
  return rows;
}

function generateFallbackPrice() {
  const rows = [];
  const states = ['VA', 'TX', 'OH', 'CA', 'GA'];
  const basePrice = { VA: 11.2, TX: 11.8, OH: 11.5, CA: 18.9, GA: 11.9 };
  const growthRate = { VA: 0.045, TX: 0.018, OH: 0.02, CA: 0.025, GA: 0.022 };
  for (const state of states) {
    for (let y = 2015; y <= 2026; y++) {
      const yearsSince2023 = Math.max(0, y - 2023);
      const accel = state === 'VA' ? yearsSince2023 * yearsSince2023 * 0.15 : yearsSince2023 * 0.05;
      const price = basePrice[state] * Math.pow(1 + growthRate[state], y - 2015) + accel;
      rows.push({ period: String(y), stateid: state, price: price.toFixed(2) });
    }
  }
  return rows;
}

const FALLBACK_NVIDIA = [
  { fiscal_quarter: 'Q1 FY2023', quarter_end_date: '2022-05-01', datacenter_revenue_billion_usd: '3.75' },
  { fiscal_quarter: 'Q2 FY2023', quarter_end_date: '2022-07-31', datacenter_revenue_billion_usd: '3.81' },
  { fiscal_quarter: 'Q3 FY2023', quarter_end_date: '2022-10-30', datacenter_revenue_billion_usd: '3.83' },
  { fiscal_quarter: 'Q4 FY2023', quarter_end_date: '2023-01-29', datacenter_revenue_billion_usd: '3.62' },
  { fiscal_quarter: 'Q1 FY2024', quarter_end_date: '2023-04-30', datacenter_revenue_billion_usd: '4.28' },
  { fiscal_quarter: 'Q2 FY2024', quarter_end_date: '2023-07-30', datacenter_revenue_billion_usd: '10.32' },
  { fiscal_quarter: 'Q3 FY2024', quarter_end_date: '2023-10-29', datacenter_revenue_billion_usd: '14.51' },
  { fiscal_quarter: 'Q4 FY2024', quarter_end_date: '2024-01-28', datacenter_revenue_billion_usd: '18.40' },
  { fiscal_quarter: 'Q1 FY2025', quarter_end_date: '2024-04-28', datacenter_revenue_billion_usd: '22.60' },
  { fiscal_quarter: 'Q2 FY2025', quarter_end_date: '2024-07-28', datacenter_revenue_billion_usd: '26.30' },
  { fiscal_quarter: 'Q3 FY2025', quarter_end_date: '2024-10-27', datacenter_revenue_billion_usd: '30.80' },
  { fiscal_quarter: 'Q4 FY2025', quarter_end_date: '2025-01-26', datacenter_revenue_billion_usd: '35.60' },
  { fiscal_quarter: 'Q1 FY2026', quarter_end_date: '2025-04-27', datacenter_revenue_billion_usd: '39.10' },
  { fiscal_quarter: 'Q2 FY2026', quarter_end_date: '2025-07-27', datacenter_revenue_billion_usd: '41.10' },
  { fiscal_quarter: 'Q3 FY2026', quarter_end_date: '2025-10-26', datacenter_revenue_billion_usd: '51.20' },
  { fiscal_quarter: 'Q4 FY2026', quarter_end_date: '2026-01-25', datacenter_revenue_billion_usd: '62.30' },
  { fiscal_quarter: 'Q1 FY2027', quarter_end_date: '2026-04-26', datacenter_revenue_billion_usd: '75.20' },
];

const FALLBACK_ANNOTATIONS = [
  { date: '2022-11-30', annotation: "ChatGPT launches publicly — widely cited as the start of the generative AI boom", source: 'OpenAI' },
  { date: '2023-01-01', annotation: 'US data centers consumed ~4.4% of total US electricity (2023 baseline)', source: 'Programs.com / LBNL' },
  { date: '2023-07-01', annotation: 'Nvidia Data Center revenue begins exponential growth (Q2 FY2024: $10.3B vs $4.3B prior quarter)', source: 'NVIDIA earnings releases' },
  { date: '2024-12-01', annotation: 'PJM capacity market price jumps from $30 to $270 per megawatt-day', source: 'Programs.com / PJM' },
  { date: '2025-01-01', annotation: "Virginia data centers consume ~26% of state's total electricity (highest concentration in US)", source: 'EPRI 2026 update' },
  { date: '2025-01-01', annotation: 'US data center power demand: 31 GW (2025), forecast 41 GW (2026), 66 GW (2027)', source: 'Goldman Sachs Research' },
  { date: '2026-01-01', annotation: "Data centers' share of US peak summer power demand projected to rise from 4.1% (2025) to 8.5% (2027)", source: 'Goldman Sachs Research' },
  { date: '2026-04-01', annotation: 'EIA Annual Energy Outlook 2026 projects total US electricity generation to grow 25-50% through 2050, driven primarily by data center servers', source: 'EIA AEO2026' },
];

// -------------------------------------------------------------------------
// DATA LOADING ORCHESTRATION
// -------------------------------------------------------------------------
const DATA = {};

async function loadAllData() {
  const [national, regional, price, nvidia, annotations] = await Promise.all([
    loadCSV('data/national_demand_monthly.csv'),
    loadCSV('data/regional_demand_daily.csv'),
    loadCSV('data/retail_price_by_state.csv'),
    loadCSV('data/nvidia_datacenter_revenue.csv'),
    loadCSV('data/dashboard_annotations.csv'),
  ]);

  DATA.national = national || generateFallbackNationalDemand();
  DATA.regional = regional || generateFallbackRegional();
  DATA.price = price || generateFallbackPrice();
  DATA.nvidia = nvidia || FALLBACK_NVIDIA;
  DATA.annotations = annotations || FALLBACK_ANNOTATIONS;
  DATA.usingFallback = !national || !regional || !price;

  const lastUpdatedEl = document.getElementById('last-updated-label');
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = DATA.usingFallback
      ? 'Demo data (run pull_eia_data.py for live data)'
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  }
}

// -------------------------------------------------------------------------
// CHART 1: NATIONAL TREND + NVIDIA OVERLAY
// -------------------------------------------------------------------------
let nationalChart;
function renderNationalTrend(range = 'all') {
  let rows = DATA.national
    .filter(r => r.period && r.sales)
    .map(r => ({ period: r.period, sales: parseFloat(r.sales) }))
    .filter(r => !isNaN(r.sales))
    .sort((a, b) => a.period.localeCompare(b.period));

  if (range === 'recent') {
    rows = rows.filter(r => r.period >= '2022-01');
  }

  const labels = rows.map(r => formatMonthLabel(r.period));
  const rolling = rollingAverage(rows.map(r => r.sales), 12);

  // Build Nvidia series aligned by nearest month
  const nvidiaByMonth = {};
  DATA.nvidia.forEach(r => {
    const month = r.quarter_end_date.slice(0, 7);
    nvidiaByMonth[month] = parseFloat(r.datacenter_revenue_billion_usd);
  });
  const nvidiaSeries = rows.map(r => nvidiaByMonth[r.period] ?? null);

  const ctx = document.getElementById('chart-national-trend').getContext('2d');
  if (nationalChart) nationalChart.destroy();

  nationalChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'Demand (12-mo rolling avg)',
          data: rolling,
          borderColor: COLORS.ink,
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.3,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Nvidia Data Center Revenue ($B/qtr)',
          data: nvidiaSeries,
          borderColor: COLORS.accent,
          backgroundColor: COLORS.accent + '22',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: COLORS.accent,
          spanGaps: true,
          tension: 0.3,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { family: "'DM Mono', monospace", size: 11 } } },
        tooltip: { backgroundColor: COLORS.ink, titleFont: { family: "'DM Mono', monospace" }, bodyFont: { family: "'DM Sans', sans-serif" } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
        y: { position: 'left', title: { display: true, text: 'Demand (GWh, indexed)', font: { size: 11 } }, grid: { color: COLORS.border } },
        y2: { position: 'right', title: { display: true, text: 'Nvidia DC Revenue ($B)', font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

// -------------------------------------------------------------------------
// CHART 2: REGIONAL DIVERGENCE
// -------------------------------------------------------------------------
let regionalChart;
function renderRegional(metric = 'growth') {
  const regions = ['ERCO', 'PJM', 'MISO', 'CISO'];
  const byRegion = {};
  regions.forEach(r => byRegion[r] = []);

  DATA.regional.forEach(row => {
    if (row.type && row.type !== 'D') return;
    const region = row.respondent;
    if (!byRegion[region]) return;
    const val = parseFloat(row.value);
    if (isNaN(val)) return;
    byRegion[region].push({ period: row.period, value: val });
  });

  // aggregate to monthly average for readability
  const monthlyByRegion = {};
  regions.forEach(region => {
    const sorted = byRegion[region].sort((a, b) => a.period.localeCompare(b.period));
    const grouped = {};
    sorted.forEach(r => {
      const month = r.period.slice(0, 7);
      if (!grouped[month]) grouped[month] = [];
      grouped[month].push(r.value);
    });
    monthlyByRegion[region] = Object.entries(grouped)
      .map(([month, vals]) => ({ month, avg: vals.reduce((a, b) => a + b, 0) / vals.length }))
      .sort((a, b) => a.month.localeCompare(b.month));
  });

  const allMonths = [...new Set(regions.flatMap(r => monthlyByRegion[r].map(m => m.month)))].sort();
  const labels = allMonths.map(formatMonthLabel);

  const datasets = regions.map(region => {
    const seriesMap = {};
    monthlyByRegion[region].forEach(m => seriesMap[m.month] = m.avg);
    let values = allMonths.map(m => seriesMap[m] ?? null);

    if (metric === 'growth') {
      values = values.map((v, i) => {
        const prior = values[i - 12];
        if (v === null || prior === null || prior === undefined || !prior) return null;
        return ((v - prior) / prior) * 100;
      });
    }

    return {
      label: REGION_LABELS[region],
      data: values,
      borderColor: REGION_COLORS[region],
      backgroundColor: REGION_COLORS[region] + '15',
      borderWidth: 2.2,
      pointRadius: 0,
      tension: 0.3,
      spanGaps: true,
    };
  });

  const ctx = document.getElementById('chart-regional').getContext('2d');
  if (regionalChart) regionalChart.destroy();

  regionalChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { family: "'DM Mono', monospace", size: 11 } } },
        tooltip: { backgroundColor: COLORS.ink },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: {
          title: { display: true, text: metric === 'growth' ? 'YoY Demand Growth (%)' : 'Avg Demand (MWh)', font: { size: 11 } },
          grid: { color: COLORS.border },
        },
      },
    },
  });
}

// -------------------------------------------------------------------------
// CHART 3: SEASONALITY HEATMAP (rendered as a custom grid via Chart.js matrix-style using bar)
// -------------------------------------------------------------------------
let seasonalityChart;
function renderSeasonality(region = 'ERCO') {
  const rows = DATA.regional.filter(r => r.respondent === region && (!r.type || r.type === 'D'));
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Since our daily data has no hour granularity (EIA daily-region-data is daily, not hourly),
  // we show day-of-week pattern as a bar chart — a clean, honest substitute for a true hourly heatmap.
  const byDay = Array.from({ length: 7 }, () => []);
  rows.forEach(r => {
    const val = parseFloat(r.value);
    if (isNaN(val) || !r.period) return;
    const d = new Date(r.period);
    if (isNaN(d.getTime())) return;
    byDay[d.getDay()].push(val);
  });

  const avgByDay = byDay.map(arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const overallAvg = avgByDay.reduce((a, b) => a + b, 0) / avgByDay.filter(v => v > 0).length;
  const pctOfAvg = avgByDay.map(v => overallAvg ? ((v - overallAvg) / overallAvg) * 100 : 0);

  const ctx = document.getElementById('chart-seasonality').getContext('2d');
  if (seasonalityChart) seasonalityChart.destroy();

  seasonalityChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dayLabels,
      datasets: [{
        label: `${REGION_LABELS[region]} — Demand vs. Weekly Average`,
        data: pctOfAvg,
        backgroundColor: pctOfAvg.map(v => v >= 0 ? COLORS.accent : COLORS.accent2),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: COLORS.ink,
          callbacks: { label: (ctx) => `${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)}% vs. weekly average` },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { title: { display: true, text: '% deviation from weekly average', font: { size: 11 } }, grid: { color: COLORS.border } },
      },
    },
  });
}

// -------------------------------------------------------------------------
// CHART 4: PRICE BY STATE
// -------------------------------------------------------------------------
let priceChart;
function renderPrice(view = 'indexed') {
  const states = ['VA', 'TX', 'OH', 'CA', 'GA'];
  const byState = {};
  states.forEach(s => byState[s] = []);

  DATA.price.forEach(row => {
    const price = parseFloat(row.price);
    if (isNaN(price) || !byState[row.stateid]) return;
    byState[row.stateid].push({ period: row.period, price });
  });

  states.forEach(s => byState[s].sort((a, b) => a.period.localeCompare(b.period)));

  const allYears = [...new Set(states.flatMap(s => byState[s].map(r => r.period)))].sort();

  const datasets = states.map(state => {
    const seriesMap = {};
    byState[state].forEach(r => seriesMap[r.period] = r.price);
    let values = allYears.map(y => seriesMap[y] ?? null);

    if (view === 'indexed') {
      const base = values.find(v => v !== null);
      values = values.map(v => v !== null && base ? (v / base) * 100 : null);
    }

    return {
      label: state,
      data: values,
      borderColor: STATE_COLORS[state],
      backgroundColor: 'transparent',
      borderWidth: state === 'VA' ? 3 : 2,
      pointRadius: 2,
      tension: 0.25,
      spanGaps: true,
    };
  });

  const ctx = document.getElementById('chart-price').getContext('2d');
  if (priceChart) priceChart.destroy();

  priceChart = new Chart(ctx, {
    type: 'line',
    data: { labels: allYears, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { boxWidth: 12, font: { family: "'DM Mono', monospace", size: 11 } } },
        tooltip: { backgroundColor: COLORS.ink },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          title: { display: true, text: view === 'indexed' ? 'Price Index (2015 = 100)' : 'Price (¢/kWh)', font: { size: 11 } },
          grid: { color: COLORS.border },
        },
      },
    },
  });
}

// -------------------------------------------------------------------------
// HERO STATS
// -------------------------------------------------------------------------
function renderHeroStats() {
  const container = document.getElementById('hero-stats');
  const nv = DATA.nvidia;
  const firstRev = parseFloat(nv[0]?.datacenter_revenue_billion_usd || 0);
  const lastRev = parseFloat(nv[nv.length - 1]?.datacenter_revenue_billion_usd || 0);
  const growthMultiple = firstRev ? (lastRev / firstRev).toFixed(0) : '—';

  const stats = [
    { num: `${growthMultiple}×`, label: "Nvidia DC Rev. FY23→27" },
    { num: '31→66 GW', label: 'US DC Demand 2025→27' },
    { num: '~26%', label: "VA Electricity → DCs" },
    { num: '$270→330', label: 'PJM $/MW-day' },
  ];

  container.innerHTML = stats.map(s => `
    <div class="stat-chip">
      <div class="stat-chip-num">${s.num}</div>
      <div class="stat-chip-label">${s.label}</div>
    </div>
  `).join('');
}

// -------------------------------------------------------------------------
// TIMELINE / CALLOUTS
// -------------------------------------------------------------------------
function renderTimeline() {
  const container = document.getElementById('callout-list');
  const sorted = [...DATA.annotations].sort((a, b) => a.date.localeCompare(b.date));
  container.innerHTML = sorted.map(item => {
    const d = new Date(item.date);
    const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    return `
      <div class="callout-item">
        <div class="callout-date">${label}</div>
        <div>
          <div class="callout-text">${item.annotation}</div>
          <div class="callout-source">Source: ${item.source}</div>
        </div>
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------------------
// TOGGLE BUTTON WIRING
// -------------------------------------------------------------------------
function wireToggleGroup(selector, attr, onChange) {
  const buttons = document.querySelectorAll(selector);
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.getAttribute(attr));
    });
  });
}

// -------------------------------------------------------------------------
// INIT
// -------------------------------------------------------------------------
async function init() {
  await loadAllData();

  renderHeroStats();
  renderNationalTrend('all');
  renderRegional('growth');
  renderSeasonality('ERCO');
  renderPrice('indexed');
  renderTimeline();

  wireToggleGroup('[data-range]', 'data-range', renderNationalTrend);
  wireToggleGroup('[data-metric]', 'data-metric', renderRegional);
  wireToggleGroup('[data-priceview]', 'data-priceview', renderPrice);

  document.getElementById('seasonality-region-select').addEventListener('change', (e) => {
    renderSeasonality(e.target.value);
  });
}

document.addEventListener('DOMContentLoaded', init);

// =========================================================================
// CHAT WIDGET — "Ask About This Data"
// Calls a dedicated Cloudflare Worker scoped to this dashboard's data.
// =========================================================================
const CHAT_WORKER_URL = 'https://energy_data_chat.martamariawheeler.workers.dev';

const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
let chatHistory = [];

function appendMessage(text, role) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

async function sendChatMessage(text) {
  if (!text.trim()) return;
  appendMessage(text, 'user');
  chatHistory.push({ role: 'user', content: text });
  chatInput.value = '';
  chatSend.disabled = true;

  const typingDiv = appendMessage('Thinking...', 'bot typing');

  try {
    const resp = await fetch(CHAT_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory }),
    });
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const data = await resp.json();
    typingDiv.remove();
    const reply = data.reply || "Sorry, I couldn't generate a response just now.";
    appendMessage(reply, 'bot');
    chatHistory.push({ role: 'assistant', content: reply });
  } catch (err) {
    console.error('Chat error:', err);
    typingDiv.remove();
    appendMessage("Sorry, I'm having trouble connecting right now. Please try again in a moment.", 'bot');
  } finally {
    chatSend.disabled = false;
    chatInput.focus();
  }
}

chatSend.addEventListener('click', () => sendChatMessage(chatInput.value));
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage(chatInput.value);
});
document.querySelectorAll('.chat-suggest-btn').forEach(btn => {
  btn.addEventListener('click', () => sendChatMessage(btn.getAttribute('data-q')));
});
