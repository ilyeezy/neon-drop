// Шесть тем. Тема задаёт весь облик игры, а не только цвета фигур: фон, сетку
// и рамку поля, тон спецблоков и палитру интерфейса (панели, кнопки, текст).
// Дефолтная neon — из ТЗ п. 7; условия открытия — данные для CONTENT.
export const THEMES = [
  {
    id: 'neon',
    nameKey: 'th_neon',
    unlock: { type: 'default' },
    colors: ['#22d3ee', '#fbbf24', '#c084fc', '#4ade80', '#f87171', '#60a5fa', '#fb923c'],
    bg: ['#0a0a1f', '#1a0b2e'],
    accent: '#22d3ee',
    grid: 'rgba(255,255,255,0.05)',
    // спецблоки тонируются под тему: лёд, камень, фитиль бомбы, золотая цель
    ice: { fill: '#a5e1ff', crack: '#1e5078' },
    stone: ['#7b8494', '#4b5563'],
    bomb: { core: '#4b3040', edge: '#180b12', glow: '#f87171' },
    gold: '#fbbf24',
    ui: { panel: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.16)', text: '#e5e7eb', overlay: 'rgba(5,6,18,0.55)' },
  },
  {
    id: 'sunset',
    nameKey: 'th_sunset',
    unlock: { type: 'score', n: 50000 },
    colors: ['#fb923c', '#f87171', '#fbbf24', '#e879f9', '#f472b6', '#facc15', '#fda4af'],
    bg: ['#1c0710', '#3d0f1e'],
    accent: '#fb923c',
    grid: 'rgba(255,220,200,0.07)',
    ice: { fill: '#ffd7c2', crack: '#8a3a20' },
    stone: ['#8d6d63', '#4e342e'],
    bomb: { core: '#5b2130', edge: '#20070d', glow: '#fb7185' },
    gold: '#facc15',
    ui: { panel: 'rgba(255,190,150,0.09)', border: 'rgba(255,190,150,0.22)', text: '#ffe8dc', overlay: 'rgba(24,6,12,0.6)' },
  },
  {
    id: 'aurora',
    nameKey: 'th_aurora',
    unlock: { type: 'levels', n: 25 },
    colors: ['#34d399', '#22d3ee', '#a3e635', '#4ade80', '#67e8f9', '#5eead4', '#86efac'],
    bg: ['#03121a', '#07301f'],
    accent: '#34d399',
    grid: 'rgba(200,255,230,0.06)',
    ice: { fill: '#c8fff0', crack: '#0f5a4a' },
    stone: ['#6b8f85', '#37514a'],
    bomb: { core: '#1f4038', edge: '#04140f', glow: '#5eead4' },
    gold: '#a3e635',
    ui: { panel: 'rgba(180,255,225,0.08)', border: 'rgba(180,255,225,0.2)', text: '#dcfff2', overlay: 'rgba(3,18,20,0.6)' },
  },
  {
    id: 'ocean',
    nameKey: 'th_ocean',
    unlock: { type: 'levels', n: 10 },
    colors: ['#60a5fa', '#22d3ee', '#818cf8', '#38bdf8', '#34d399', '#93c5fd', '#67e8f9'],
    bg: ['#020a1c', '#04203a'],
    accent: '#38bdf8',
    grid: 'rgba(190,225,255,0.07)',
    ice: { fill: '#bfe9ff', crack: '#12496e' },
    stone: ['#6b8299', '#33455c'],
    bomb: { core: '#1c3550', edge: '#02101f', glow: '#60a5fa' },
    gold: '#7dd3fc',
    ui: { panel: 'rgba(160,215,255,0.08)', border: 'rgba(160,215,255,0.2)', text: '#dff1ff', overlay: 'rgba(2,10,28,0.6)' },
  },
  {
    id: 'ember',
    nameKey: 'th_ember',
    unlock: { type: 'streak', n: 3 },
    colors: ['#f87171', '#fb923c', '#fbbf24', '#fca5a5', '#f59e0b', '#ef4444', '#fdba74'],
    bg: ['#0d0705', '#241008'],
    accent: '#f59e0b',
    grid: 'rgba(255,200,160,0.06)',
    ice: { fill: '#ffe0c4', crack: '#7c3a12' },
    stone: ['#7a6a60', '#3f342e'],
    bomb: { core: '#4a1c14', edge: '#160604', glow: '#ef4444' },
    gold: '#fbbf24',
    ui: { panel: 'rgba(255,190,140,0.08)', border: 'rgba(255,190,140,0.2)', text: '#ffeadb', overlay: 'rgba(13,7,5,0.62)' },
  },
  {
    id: 'violet',
    nameKey: 'th_violet',
    unlock: { type: 'clear' },
    colors: ['#c084fc', '#e879f9', '#a78bfa', '#f0abfc', '#8b5cf6', '#d8b4fe', '#f472b6'],
    bg: ['#0f0518', '#2a0b3d'],
    accent: '#c084fc',
    grid: 'rgba(235,215,255,0.07)',
    ice: { fill: '#e9d5ff', crack: '#4c1d70' },
    stone: ['#7d6b90', '#3f3350'],
    bomb: { core: '#3d1b52', edge: '#12061c', glow: '#e879f9' },
    gold: '#f0abfc',
    ui: { panel: 'rgba(230,200,255,0.08)', border: 'rgba(230,200,255,0.22)', text: '#f3e8ff', overlay: 'rgba(15,5,24,0.6)' },
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((th) => [th.id, th]));

// Тема управляет и HTML-слоем: панели, кнопки, текст, подложка экранов.
export function applyThemeToCss(theme, root = document.documentElement) {
  const set = (name, value) => root.style.setProperty(name, value);
  set('--accent', theme.accent);
  set('--bg-top', theme.bg[0]);
  set('--bg-bottom', theme.bg[1]);
  set('--panel', theme.ui.panel);
  set('--panel-border', theme.ui.border);
  set('--text', theme.ui.text);
  set('--overlay', theme.ui.overlay);
  set('--gold', theme.gold);
}
