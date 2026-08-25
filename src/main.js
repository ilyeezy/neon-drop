// Точка входа: платформа → сейв → язык → лейаут → рендер → экраны → цикл.
// LoadingAPI.ready() зовётся ровно когда игрок реально может начать играть
// (п. 1.19.2): после сейва, спрайтов и отрисовки главного меню.
import { initPlatform, localMirror } from './platform/yandex.js';
import { createSaveManager } from './save/storage.js';
import { setLang, getLang, t, LANGS } from './i18n/index.js';
import { initAudio, setSound, setMusic, suspendAudio, resumeAudio, sfx } from './audio/sound.js';
import { createLayout } from './ui/layout.js';
import { createBackground } from './render/background.js';
import { createParticles } from './render/particles.js';
import { createRenderer } from './render/renderer.js';
import { THEME_BY_ID, applyThemeToCss } from './render/themes.js';
import { createDragInput } from './input/drag.js';
import { createKeyboardInput } from './input/keyboard.js';
import { createSession } from './content/session.js';
import { refillDailyBoosters } from './content/progress.js';
import { dailyDateKey } from './content/modes.js';
import { createScreens } from './ui/screens.js';

async function boot() {
  document.addEventListener('contextmenu', (e) => e.preventDefault()); // п. 1.6.2.7

  const platform = await initPlatform();
  const saveMgr = createSaveManager({ platform, mirror: localMirror });
  await saveMgr.load();
  const save = saveMgr.data;
  if (refillDailyBoosters(save, dailyDateKey())) saveMgr.commit(true);

  setLang(save.settings.lang ?? platform.getLang());
  initAudio(save.settings);
  setSound(save.settings.sound);
  setMusic(save.settings.music);

  const stageEl = document.getElementById('stage');
  const bgCanvas = document.getElementById('bg');
  const gameCanvas = document.getElementById('game');
  const background = createBackground(bgCanvas);
  const particles = createParticles();
  const renderer = createRenderer(gameCanvas, particles);
  let session = null;

  const layout = createLayout({
    stageEl,
    onChange(metrics) {
      renderer.setLayout(metrics);
      background.resize(window.innerWidth, window.innerHeight, metrics.dpr);
      session?.onResize();
    },
  });

  const theme = THEME_BY_ID[save.progress.activeTheme] ?? THEME_BY_ID.neon;
  renderer.setTheme(theme);
  background.setTheme(theme);
  applyThemeToCss(theme); // панели, кнопки и текст тоже живут в теме
  renderer.setLayout(layout.metrics);
  background.resize(window.innerWidth, window.innerHeight, layout.metrics.dpr);

  const dragInput = createDragInput({
    canvas: gameCanvas,
    getGame: () => session?.game,
    getLayout: () => layout.metrics,
    renderer,
    onPlace: (slot, x, y) => session.placePiece(slot, x, y),
    onHammerCell: (x, y) => session.hammerCell(x, y),
    onPointerNorm: (p) => background.setParallax((p.x / layout.metrics.w - 0.5) * 2, (p.y / layout.metrics.h - 0.5) * 2),
    onLift: () => sfx.pick(),
    onReject: () => sfx.invalid(),
  });

  session = createSession({ platform, saveMgr, renderer, layout, dragInput });

  const keyboardInput = createKeyboardInput({
    getGame: () => session.game,
    renderer,
    onPlace: (slot, x, y) => session.placePiece(slot, x, y),
    onPause: () => session.pause(),
    onCancel: () => session.cancelHammer(),
    isGameVisible: () => screens.currentName === null,
  });
  session.setKeyboard(keyboardInput);

  const screens = createScreens({
    root: document.getElementById('screens'),
    hudRoot: document.getElementById('hud-root'),
    save: saveMgr,
    actions: {
      onPlay: (mode) => { sfx.uiClick(); session.startMode(mode); },
      onLevel: (id) => { sfx.uiClick(); session.startMode('levels', id); },
      onLevels: () => { sfx.uiClick(); screens.levels(); },
      onContinue: () => { sfx.uiClick(); session.continueRun(); },
      onThemes: () => { sfx.uiClick(); screens.themes(); },
      onSettings: () => { sfx.uiClick(); screens.settings(); },
      onHowto: () => { sfx.uiClick(); screens.howto(); },
      onTutorial: () => { sfx.uiClick(); session.startTutorial(); },
      onTutorialSkip: () => session.skipTutorial(),
      onMenu: () => { sfx.uiClick(); screens.menu(); },
      onPause: () => session.pause(),
      onResume: () => { sfx.uiClick(); session.resumeGame(); },
      onRestart: () => { sfx.uiClick(); session.restart(); },
      onQuit: () => { sfx.uiClick(); session.quitToMenu(); },
      onBooster: (type) => session.useBooster(type),
      onToggle(key) {
        save.settings[key] = !save.settings[key];
        if (key === 'sound') setSound(save.settings.sound);
        if (key === 'music') setMusic(save.settings.music);
        saveMgr.commit(false);
        sfx.uiClick();
        return save.settings[key];
      },
      onCycleLang() {
        const codes = LANGS.map((l) => l.code);
        const next = codes[(codes.indexOf(getLang()) + 1) % codes.length];
        save.settings.lang = next;
        setLang(next);
        saveMgr.commit(false);
        return LANGS.find((l) => l.code === next).name;
      },
      onTheme(id) {
        save.progress.activeTheme = id;
        saveMgr.commit(true);
        const th = THEME_BY_ID[id];
        renderer.setTheme(th);
        background.setTheme(th);
        applyThemeToCss(th);
        sfx.uiClick();
      },
      onRvTheme(id) {
        session.showRewarded(() => {
          if (!save.progress.themes.includes(id)) save.progress.themes.push(id);
          saveMgr.commit(true);
          screens.themes();
        });
      },
      onRvBoosters: (type) => session.showRewarded(() => session.grantBoosters(type)),
      onRvDaily: () => session.showRewarded(() => {
        save.daily.rvSecond = true;
        saveMgr.commit(true);
        session.startMode('daily');
      }),
    },
  });
  session.setScreens(screens);

  // системные паузы: сворачивание, потеря фокуса, пауза платформы (п. 1.3, 1.19.4)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) session.systemPause(); else session.systemResume();
  });
  window.addEventListener('blur', () => session.systemPause());
  window.addEventListener('focus', () => session.systemResume());
  platform.onPause(() => session.systemPause());
  platform.onResume(() => session.systemResume());

  screens.updateHud(null);
  screens.menu();
  platform.ready();

  // rAF-цикл: delta с обрезкой (одинаково на 60/120 Гц, без телепортов после фона)
  let last = performance.now();
  const frameTimes = [];
  let degraded = false;

  // Сторож: если кадры перестали идти (свёрнутое окно, фоновая вкладка), ядро
  // осталось бы в animating с закрытым вводом. Таймеры в фоне тикают — снимаем
  // блокировку сами, не дожидаясь очереди рендера.
  setInterval(() => {
    const game = session.game;
    if (game && game.phase === 'animating' && performance.now() - last > 1500) {
      game.animationsDone();
    }
  }, 1000);
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    background.step(dt);
    renderer.step(dt);
    session.syncAnimations();
    if (!degraded && session.game) {
      frameTimes.push(dt);
      if (frameTimes.length === 240) {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        if (sorted[120] > 0.02) { // медиана хуже 50 FPS → деградация (тенет плавности)
          particles.setMultiplier(0.5);
          document.body.classList.add('no-blur');
        }
        degraded = true;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

boot();
