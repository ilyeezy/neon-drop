// Оркестратор партий: связывает ядро, рендер, звук, сейв, платформу и экраны.
// Разметка геймплея (GameplayAPI start/stop) строго парная и соответствует
// реальному состоянию (п. 1.19.3).
import { createGame, deserializeGame } from '../core/game.js';
import { buildParty } from './modes.js';
import { createGoalTracker, goalText, starsFor } from './goals.js';
import { applyResult, refillDailyBoosters } from './progress.js';
import { TUTORIAL_STEPS, tutorialProvider } from './tutorial.js';
import { createAdPolicy } from '../platform/ads-policy.js';
import { sfx, suspendAudio, resumeAudio } from '../audio/sound.js';
import { dailyDateKey } from './modes.js';

export function createSession({ platform, saveMgr, renderer, layout, dragInput }) {
  let screens = null;
  let keyboard = null;
  let party = null;
  let game = null;
  let goalTracker = null;
  let subs = [];
  let gameplayActive = false;
  let runStats = { maxStreak: 0, boardCleared: false, boostersUsed: 0 };
  let tutorial = null; // { stepIdx }
  const adPolicy = createAdPolicy();
  const save = () => saveMgr.data;

  const gameplay = (on) => {
    if (on === gameplayActive) return;
    gameplayActive = on;
    if (on) platform.gameplayStart(); else platform.gameplayStop();
  };

  function detach() {
    subs.forEach((off) => off());
    subs = [];
    goalTracker?.detach();
    goalTracker = null;
  }

  function hudLine() {
    if (!game) return {};
    if (party?.level) {
      return {
        goalLine: goalText(party.level),
        movesLeft: Math.max(0, party.level.moveLimit - game.moveCount),
        best: null,
      };
    }
    const best = party?.recordKey ? save().records[party.recordKey]
      : party?.modeId === 'daily' ? save().daily.best : null;
    return { goalLine: '', movesLeft: null, best };
  }

  function refreshHud() {
    screens.updateHud(game, hudLine());
  }

  function persistRun(critical = false) {
    if (!game || !party || tutorial) return;
    if (game.phase === 'over') return;
    save().currentRun = {
      modeId: party.modeId,
      levelId: party.level?.id ?? null,
      extra: { ...runStats },
      core: game.serialize(),
    };
    save().boosters = { ...game.boosters };
    saveMgr.commit(critical);
  }

  function wireGame({ restored = false } = {}) {
    renderer.attach(game);
    keyboard?.reset();

    subs.push(game.on('piecePlaced', () => sfx.place()));
    subs.push(game.on('linesCleared', (ev) => {
      sfx.clear(ev.count);
      if (ev.iceDamaged.length) sfx.iceCrack();
    }));
    subs.push(game.on('streakChanged', ({ step }) => {
      if (step >= 2) sfx.streak(step);
      runStats.maxStreak = Math.max(runStats.maxStreak, step);
    }));
    subs.push(game.on('boardEmpty', () => {
      sfx.perfect();
      runStats.boardCleared = true;
    }));
    subs.push(game.on('bombTick', ({ timers }) => {
      if (timers.some((v) => v > 0 && v <= 2)) sfx.bombTick();
    }));
    subs.push(game.on('moveResolved', () => {
      refreshHud();
      persistRun(false);
    }));
    subs.push(game.on('boosterApplied', () => {
      runStats.boostersUsed += 1;
      refreshHud();
      persistRun(false);
    }));
    subs.push(game.on('undoApplied', () => {
      runStats.boostersUsed += 1;
      refreshHud();
      persistRun(false);
    }));
    subs.push(game.on('gameOver', (ev) => onGameOver(ev)));

    if (party.level) {
      goalTracker = createGoalTracker(game, party.level, { onUpdate: refreshHud });
      if (restored) goalTracker.seedBoostersUsed?.(runStats.boostersUsed);
    }
    refreshHud();
  }

  function enterParty() {
    screens.hideAll();
    dragInput.setHammerMode(false);
    renderer.setLayout(layout.setGameSize(game.board.size));
    gameplay(true);
    if (game.phase === 'over') onGameOver(game.result); // честный режим может умереть на старте
  }

  function startMode(modeId, levelId = null) {
    detach();
    tutorial = null;
    // вкладка могла пережить полночь: добираем запас до входа в партию
    if (refillDailyBoosters(save(), dailyDateKey())) saveMgr.commit(true);
    party = buildParty(modeId, { save: save(), levelId });
    runStats = { maxStreak: 0, boardCleared: false, boostersUsed: 0 };
    game = createGame(party.config);
    wireGame();
    enterParty();
    persistRun(true);
  }

  function continueRun() {
    const run = save().currentRun;
    if (!run) return;
    detach();
    tutorial = null;
    party = buildParty(run.modeId, { save: save(), levelId: run.levelId });
    runStats = { maxStreak: 0, boardCleared: false, boostersUsed: 0, ...run.extra };
    try {
      game = deserializeGame(run.core, party.config);
    } catch {
      save().currentRun = null;
      saveMgr.commit(true);
      screens.menu();
      return;
    }
    wireGame({ restored: true });
    enterParty();
    if (game.phase === 'paused') {
      screens.pause();
      gameplay(false);
    }
  }

  function showResult(ev) {
    const stars = party.level ? starsFor(party.level, game, runStats.boostersUsed, ev.outcome === 'win') : 0;
    const outcome = applyResult(save(), party, game, {
      stars,
      maxStreakInRun: runStats.maxStreak,
      boardCleared: runStats.boardCleared,
    });
    save().currentRun = null;
    saveMgr.commit(true);
    adPolicy.markGameFinished();
    const today = dailyDateKey();
    const data = {
      outcome: ev.outcome,
      level: party.level,
      stars,
      score: game.score,
      best: party.recordKey ? save().records[party.recordKey]
        : party.modeId === 'daily' ? save().daily.best : null,
      newRecord: outcome.newRecord,
      rvBoosters: true,
      rvDaily: party.modeId === 'daily' && save().daily.lastDate === today
        && save().daily.playedToday && !save().daily.secondAttemptUsed,
    };
    const present = () => {
      refreshHud();
      screens.result(data);
    };
    if (adPolicy.shouldShow(Date.now())) {
      adPolicy.markShown(Date.now());
      suspendAudio();
      gameplay(false);
      platform.showInterstitial({
        onClose: () => { resumeAudio(); present(); },
        onError: () => { resumeAudio(); present(); },
      });
    } else {
      present();
    }
  }

  function onGameOver(ev) {
    gameplay(false);
    if (tutorial) return;
    if (ev.outcome === 'win') sfx.win(); else sfx.lose();
    const waitIdle = () => {
      if (renderer.busy()) requestAnimationFrame(waitIdle);
      else showResult(ev); // экран результата — по опустошению очереди, не по animationsDone
    };
    waitIdle();
  }

  // --- пауза ---

  function pause({ system = false } = {}) {
    if (!game || tutorial) return;
    if (game.phase === 'playing' || game.phase === 'animating') {
      game.pause();
      gameplay(false);
      dragInput.cancel();
      if (!system) sfx.uiClick();
      screens.pause();
    }
  }

  function resumeGame() {
    if (!game || game.phase !== 'paused') return;
    screens.hideAll();
    game.resume();
    gameplay(true);
  }

  function systemPause() {
    if (tutorial) { suspendAudio(); return; }
    pause({ system: true });
    suspendAudio();
  }

  function systemResume() {
    resumeAudio(); // игру не возобновляем — только экран паузы (п. 1.19.4)
  }

  function quitToMenu() {
    if (game && game.phase !== 'over' && !tutorial) {
      if (game.phase === 'playing' || game.phase === 'animating') game.pause();
      persistRun(true);
    }
    detach();
    gameplay(false);
    tutorial = null;
    game = null;
    party = null;
    renderer.attach(null);
    screens.updateHud(null);
    screens.menu();
  }

  // --- бустеры ---

  function useBooster(type) {
    if (!game) return;
    if (type === 'hammer') {
      dragInput.setHammerMode(true);
      sfx.uiClick();
      return;
    }
    const res = game.applyBooster(type);
    if (res.ok) sfx.booster(); else sfx.invalid();
    refreshHud();
  }

  function hammerCell(x, y) {
    const res = game.applyBooster('hammer', { x, y });
    dragInput.setHammerMode(false);
    if (res.ok) {
      sfx.booster();
      renderer.burstAt(x, y);
    } else {
      sfx.invalid();
    }
    refreshHud();
  }

  // --- rewarded ---

  function grantBoosters() {
    const grant = { hammer: 1, shuffle: 1, undo: 1 }; // +3 бустера
    if (game && game.phase !== 'over') {
      game.addBoosters(grant);
      save().boosters = { ...game.boosters };
    } else {
      for (const [k, v] of Object.entries(grant)) save().boosters[k] += v;
    }
    saveMgr.commit(true);
    refreshHud();
  }

  function showRewarded(onGranted) {
    suspendAudio();
    gameplay(false);
    platform.showRewarded({
      onRewarded: onGranted, // награда — только здесь (п. 4.5)
      onClose: () => resumeAudio(),
      onError: () => resumeAudio(),
    });
  }

  // --- туториал ---

  function startTutorial() {
    detach();
    party = null;
    tutorial = { stepIdx: 0 };
    runTutorialStep();
  }

  function runTutorialStep() {
    const step = TUTORIAL_STEPS[tutorial.stepIdx];
    if (!step) return finishTutorial();
    game = createGame({
      size: 8,
      seed: 1,
      headless: false,
      initialBoard: step.board,
      trayProvider: tutorialProvider(step),
      boosters: { hammer: 0, shuffle: 0, undo: 0 },
    });
    renderer.attach(game);
    subs.push(game.on('piecePlaced', () => sfx.place()));
    subs.push(game.on('linesCleared', (ev) => sfx.clear(ev.count)));
    const advance = () => {
      detach();
      tutorial.stepIdx += 1;
      setTimeout(runTutorialStep, 450);
    };
    if (step.advance.event === 'piecePlaced') {
      subs.push(game.on('piecePlaced', advance));
    } else {
      subs.push(game.on('linesCleared', (ev) => {
        if (ev.count >= (step.advance.min ?? 1)) advance();
      }));
    }
    layout.setGameSize(8);
    renderer.setLayout(layout.metrics);
    screens.updateHud(null);
    screens.tutorialHint(step.key);
  }

  function finishTutorial() {
    save().progress.tutorialDone = true;
    saveMgr.commit(true);
    detach();
    tutorial = null;
    game = null;
    renderer.attach(null);
    sfx.win();
    quitToMenu();
  }

  function skipTutorial() {
    save().progress.tutorialDone = true;
    saveMgr.commit(true);
    quitToMenu();
  }

  // Выход из animating — по СОСТОЯНИЮ очереди рендера, а не по событию
  // «была занята → освободилась»: у бустеров своих эффектов может не быть,
  // и на событийной схеме ядро оставалось бы в animating с закрытым вводом.
  function syncAnimations() {
    if (game && game.phase === 'animating' && !renderer.busy()) game.animationsDone();
  }

  return {
    setScreens(s) { screens = s; },
    setKeyboard(k) { keyboard = k; },
    syncAnimations,
    startMode,
    continueRun,
    restart() {
      const modeId = party?.modeId;
      const levelId = party?.level?.id ?? null;
      if (modeId) startMode(modeId, levelId);
    },
    pause,
    resumeGame,
    systemPause,
    systemResume,
    quitToMenu,
    useBooster,
    hammerCell,
    grantBoosters,
    showRewarded,
    startTutorial,
    skipTutorial,
    placePiece(slot, x, y) {
      const res = game?.placePiece(slot, x, y);
      if (res && !res.ok) sfx.invalid();
      return !!res?.ok;
    },
    onResize() {
      dragInput.cancel();
      if (game && (game.phase === 'playing' || game.phase === 'animating') && !tutorial) {
        pause({ system: true }); // при ресайзе игра автоматически на паузе (ТЗ п. 8)
      }
    },
    get game() { return game; },
    get inTutorial() { return !!tutorial; },
    get adPolicy() { return adPolicy; },
  };
}
