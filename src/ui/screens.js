// HTML-экраны поверх канваса: меню, уровни, настройки, «как играть», темы,
// пауза, результат, туториал-подсказка + игровой HUD. Полная навигация
// стрелками + Enter, кнопки ≥ 48×48 (п. 1.8), кнопки «выход» нет (п. 6.7).
import { t, LANGS } from '../i18n/index.js';
import { THEMES, THEME_BY_ID } from '../render/themes.js';
import { LEVELS } from '../levels/levels.js';
import { goalText } from '../content/goals.js';
import { unlockText, isLevelOpen } from '../content/progress.js';
import { BIG_UNLOCK_SCORE, dailyDateKey } from '../content/modes.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(cls, text, onClick) {
  const b = el('button', `btn focusable ${cls ?? ''}`, text);
  b.type = 'button';
  b.addEventListener('click', () => onClick?.());
  return b;
}

export function createScreens({ root, hudRoot, actions, save, audio }) {
  let current = null;
  let currentName = null;
  let escAction = null;

  function clear() {
    root.innerHTML = '';
    root.classList.remove('visible');
    current = null;
    currentName = null;
    escAction = null;
  }

  function mount(name, node, { esc } = {}) {
    root.innerHTML = '';
    const wrap = el('div', `screen screen-${name}`);
    wrap.append(node);
    root.append(wrap);
    root.classList.add('visible');
    current = wrap;
    currentName = name;
    escAction = esc ?? null;
    requestAnimationFrame(() => wrap.classList.add('in'));
    const first = wrap.querySelector('.focusable');
    first?.focus?.();
  }

  // --- экраны ---

  function menu() {
    const box = el('div', 'panel menu');
    box.append(el('h1', 'title', t('game_name')));
    if (save.data.currentRun) {
      box.append(btn('primary', t('menu_continue'), actions.onContinue));
    }
    box.append(btn('primary', t('menu_classic'), () => actions.onPlay('classic')));

    const bigOpen = save.data.records.classic >= BIG_UNLOCK_SCORE
      || save.data.records.fairClassic >= BIG_UNLOCK_SCORE;
    const bigBtn = btn('', t('menu_big'), () => bigOpen && actions.onPlay('big'));
    if (!bigOpen) {
      bigBtn.classList.add('locked');
      bigBtn.append(el('span', 'hint', t('big_locked', { n: BIG_UNLOCK_SCORE })));
    }
    box.append(bigBtn);

    const dailyBtn = btn('', t('menu_daily'), () => actions.onPlay('daily'));
    const dailyInfo = el('span', 'hint');
    const today = dailyDateKey();
    if (save.data.daily.streakDays > 0) dailyInfo.textContent = t('daily_streak', { n: save.data.daily.streakDays });
    if (save.data.daily.lastDate === today && save.data.daily.playedToday) {
      dailyInfo.textContent = t('daily_played');
    }
    if (dailyInfo.textContent) dailyBtn.append(dailyInfo);
    box.append(dailyBtn);

    box.append(btn('', t('menu_levels'), actions.onLevels));
    const rowBox = el('div', 'row');
    rowBox.append(btn('small', t('menu_themes'), actions.onThemes));
    rowBox.append(btn('small', t('menu_settings'), actions.onSettings));
    box.append(rowBox);
    const rowBox2 = el('div', 'row');
    rowBox2.append(btn('small', t('menu_howto'), actions.onHowto));
    rowBox2.append(btn('small', t('menu_tutorial'), actions.onTutorial));
    box.append(rowBox2);
    mount('menu', box);
  }

  function levels() {
    const box = el('div', 'panel wide');
    box.append(el('h2', 'title', t('levels_title')));
    const grid = el('div', 'levels-grid');
    for (const level of LEVELS) {
      const open = isLevelOpen(save.data, level.id);
      const stars = save.data.progress.levels[level.id - 1] ?? 0;
      const card = btn('level-card', '', () => open && actions.onLevel(level.id));
      card.append(el('div', 'level-num', String(level.id)));
      card.append(el('div', 'level-stars', open ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : ''));
      if (!open) {
        card.classList.add('locked');
        card.append(el('div', 'hint', t('locked')));
      } else {
        card.title = goalText(level);
      }
      grid.append(card);
    }
    box.append(grid);
    box.append(btn('small', t('back'), actions.onMenu));
    mount('levels', box, { esc: actions.onMenu });
  }

  function settings() {
    const box = el('div', 'panel');
    box.append(el('h2', 'title', t('st_title')));
    const s = save.data.settings;
    const toggle = (label, value, onFlip, hint) => {
      const b = btn('', `${label}: ${value ? t('on') : t('off')}`, () => {
        const next = onFlip();
        b.firstChild.textContent = `${label}: ${next ? t('on') : t('off')}`;
      });
      if (hint) b.append(el('span', 'hint', hint));
      return b;
    };
    box.append(toggle(t('st_sound'), s.sound, () => actions.onToggle('sound')));
    box.append(toggle(t('st_music'), s.music, () => actions.onToggle('music')));
    const langBtn = btn('', `${t('st_lang')}: ${LANGS.find((l) => l.code === (s.lang ?? 'ru'))?.name}`, () => {
      const name = actions.onCycleLang();
      langBtn.firstChild.textContent = `${t('st_lang')}: ${name}`;
      settings(); // перерисовка на новом языке
    });
    box.append(langBtn);
    box.append(toggle(t('st_fair'), s.fairMode, () => actions.onToggle('fairMode'), t('st_fair_hint')));
    box.append(btn('small', t('back'), actions.onMenu));
    mount('settings', box, { esc: actions.onMenu });
  }

  function howto() {
    const box = el('div', 'panel wide');
    box.append(el('h2', 'title', t('howto_title')));
    for (const key of ['howto_drag', 'howto_preview', 'howto_streak', 'howto_boosters', 'howto_specials', 'howto_keys']) {
      box.append(el('p', 'howto-line', t(key)));
    }
    box.append(btn('small', t('back'), actions.onMenu));
    mount('howto', box, { esc: actions.onMenu });
  }

  function themes() {
    const box = el('div', 'panel wide');
    box.append(el('h2', 'title', t('themes_title')));
    const grid = el('div', 'themes-grid');
    for (const themeDef of THEMES) {
      const owned = save.data.progress.themes.includes(themeDef.id);
      const active = save.data.progress.activeTheme === themeDef.id;
      const card = btn(`theme-card${active ? ' active' : ''}${owned ? '' : ' locked'}`, '', () => {
        if (owned) { actions.onTheme(themeDef.id); themes(); }
      });
      const sw = el('div', 'swatches');
      for (const color of themeDef.colors.slice(0, 5)) {
        const dot = el('span', 'swatch');
        dot.style.background = color;
        sw.append(dot);
      }
      card.append(el('div', 'theme-name', t(themeDef.nameKey)));
      card.append(sw);
      if (!owned) {
        card.append(el('div', 'hint', unlockText(themeDef, t)));
        const rv = btn('rv small', `▶ ${t('rv_theme', { name: t(themeDef.nameKey) })}`, () => actions.onRvTheme(themeDef.id));
        card.append(rv);
      }
      grid.append(card);
    }
    box.append(grid);
    box.append(btn('small', t('back'), actions.onMenu));
    mount('themes', box, { esc: actions.onMenu });
  }

  function pause() {
    const box = el('div', 'panel');
    box.append(el('h2', 'title', t('pause_title')));
    box.append(btn('primary', t('resume'), actions.onResume));
    box.append(btn('', t('restart'), actions.onRestart));
    box.append(btn('', t('to_menu'), actions.onQuit));
    mount('pause', box, { esc: actions.onResume });
  }

  function result(data) {
    const box = el('div', 'panel');
    const title = data.level
      ? (data.outcome === 'win' ? t('result_win') : t('result_fail'))
      : t('result_over');
    box.append(el('h2', 'title', title));
    if (data.level && data.outcome === 'win') {
      box.append(el('div', 'stars-big', '★'.repeat(data.stars) + '☆'.repeat(3 - data.stars)));
    }
    box.append(el('p', 'score-line', t('score', { n: data.score })));
    if (data.best !== null) box.append(el('p', 'hint', t('best', { n: data.best })));
    if (data.newRecord) box.append(el('p', 'record', t('new_record')));
    box.append(btn('primary', t('play_again'), actions.onRestart)); // всегда доступна (п. 4.5)
    if (data.rvBoosters) {
      // Награда — три бустера одного типа: игрок выбирает тот, которого не хватило.
      // Каждая кнопка сама называет и рекламу, и конкретную награду (п. 4.5.1).
      box.append(el('p', 'rv-title', t('rv_pick')));
      const rvRow = el('div', 'row rv-row');
      for (const type of ['hammer', 'shuffle', 'undo']) {
        rvRow.append(btn('rv small', t(`rv_${type}`), () => actions.onRvBoosters(type)));
      }
      box.append(rvRow);
    }
    if (data.rvDaily) {
      box.append(btn('rv', `▶ ${t('rv_daily')}`, actions.onRvDaily));
    }
    box.append(btn('', t('to_menu'), actions.onQuit));
    mount('result', box);
  }

  function tutorialHint(key, { skippable = true } = {}) {
    const box = el('div', 'tutorial-bar');
    box.append(el('p', 'tut-text', t(key)));
    if (skippable) box.append(btn('small', t('tut_skip'), actions.onTutorialSkip));
    root.innerHTML = '';
    root.classList.add('visible', 'passthrough');
    root.append(box);
    current = box;
    currentName = 'tutorial';
    escAction = null;
  }

  function hideAll() {
    root.classList.remove('passthrough');
    clear();
  }

  // --- HUD ---

  const hud = {
    bar: el('div', 'hud'),
    score: el('div', 'hud-cell'),
    best: el('div', 'hud-cell'),
    streak: el('div', 'hud-cell'),
    goal: el('div', 'hud-goal'),
    boosters: el('div', 'booster-bar'),
    pauseBtn: null,
    boosterBtns: {},
  };
  hud.pauseBtn = btn('hud-pause', '⏸', () => actions.onPause());
  hud.bar.append(hud.score, hud.best, hud.streak, hud.goal, hud.pauseBtn);
  for (const type of ['hammer', 'shuffle', 'undo']) {
    const b = btn('booster', '', () => actions.onBooster(type));
    hud.boosterBtns[type] = b;
    hud.boosters.append(b);
  }
  hudRoot.append(hud.bar, hud.boosters);

  const BOOSTER_ICONS = { hammer: '🔨', shuffle: '🔀', undo: '↩' };

  function updateHud(game, { goalLine = '', movesLeft = null, best = null, hammerActive = false } = {}) {
    const visible = !!game;
    hud.bar.style.display = visible ? '' : 'none';
    hud.boosters.style.display = visible ? '' : 'none';
    if (!game) return;
    hud.score.textContent = `${t('hud_score')} ${game.score}`;
    hud.best.textContent = best !== null ? `${t('hud_best')} ${best}` : '';
    const mult = [1, 1.2, 1.5, 2, 2.5, 3][Math.min(game.streakStep, 5)];
    hud.streak.textContent = game.streakStep > 0 ? `${t('hud_streak')} ×${mult}` : '';
    hud.goal.textContent = movesLeft !== null ? `${goalLine} · ${t('moves_left', { n: movesLeft })}` : goalLine;
    for (const type of ['hammer', 'shuffle', 'undo']) {
      const b = hud.boosterBtns[type];
      const left = game.boosters[type];
      b.textContent = `${BOOSTER_ICONS[type]} ${left}`;
      b.disabled = left < 1 || game.phase !== 'playing';
      b.title = t(`bo_${type}`);
      // молот — режим прицеливания: подсвечиваем, пока он включён
      b.classList.toggle('active', type === 'hammer' && hammerActive);
    }
  }

  // --- навигация стрелками (заодно закрывает клавиатурные среды) ---

  document.addEventListener('keydown', (e) => {
    if (!current || currentName === 'tutorial') return;
    const focusables = [...current.querySelectorAll('.focusable:not(.locked):not([disabled])')];
    if (!focusables.length) return;
    const idx = focusables.indexOf(document.activeElement);
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
      e.preventDefault();
      focusables[(idx + 1) % focusables.length].focus();
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
      e.preventDefault();
      focusables[(idx - 1 + focusables.length) % focusables.length].focus();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      if (document.activeElement?.classList.contains('focusable')) {
        e.preventDefault();
        document.activeElement.click();
      }
    } else if (e.code === 'Escape' && escAction) {
      e.preventDefault();
      escAction();
    }
  });

  return {
    menu, levels, settings, howto, themes, pause, result, tutorialHint, hideAll, updateHud,
    get currentName() { return currentName; },
  };
}
