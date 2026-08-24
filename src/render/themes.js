// Шесть тем. Дефолтная палитра neon — из ТЗ п. 7; условия открытия — данные
// для CONTENT (progress.js), проверяются по stats сейва.
export const THEMES = [
  {
    id: 'neon', nameKey: 'th_neon', unlock: { type: 'default' },
    colors: ['#22d3ee', '#fbbf24', '#c084fc', '#4ade80', '#f87171', '#60a5fa', '#fb923c'],
    bg: ['#0a0a1f', '#1a0b2e'], accent: '#22d3ee',
  },
  {
    id: 'sunset', nameKey: 'th_sunset', unlock: { type: 'score', n: 50000 },
    colors: ['#fb923c', '#f87171', '#fbbf24', '#e879f9', '#f472b6', '#facc15', '#fda4af'],
    bg: ['#180a12', '#2e0b1a'], accent: '#fb923c',
  },
  {
    id: 'aurora', nameKey: 'th_aurora', unlock: { type: 'days', n: 7 },
    colors: ['#34d399', '#22d3ee', '#a3e635', '#4ade80', '#67e8f9', '#5eead4', '#86efac'],
    bg: ['#04121f', '#0b2e22'], accent: '#34d399',
  },
  {
    id: 'ocean', nameKey: 'th_ocean', unlock: { type: 'levels', n: 10 },
    colors: ['#60a5fa', '#22d3ee', '#818cf8', '#38bdf8', '#34d399', '#93c5fd', '#67e8f9'],
    bg: ['#050b1f', '#0b1a2e'], accent: '#38bdf8',
  },
  {
    id: 'ember', nameKey: 'th_ember', unlock: { type: 'streak', n: 3 },
    colors: ['#f87171', '#fb923c', '#fbbf24', '#fca5a5', '#f59e0b', '#ef4444', '#fdba74'],
    bg: ['#140a0a', '#241010'], accent: '#f59e0b',
  },
  {
    id: 'violet', nameKey: 'th_violet', unlock: { type: 'clear' },
    colors: ['#c084fc', '#e879f9', '#a78bfa', '#f0abfc', '#8b5cf6', '#d8b4fe', '#f472b6'],
    bg: ['#12081f', '#1f0b2e'], accent: '#c084fc',
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((th) => [th.id, th]));
