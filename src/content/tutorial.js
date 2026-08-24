// Интерактивное обучение (п. 6.8): три шага на скриптованном провайдере,
// пропускаемое, повторно вызывается из меню.
const trio = (id) => [
  { shapeId: id, color: 2 },
  { shapeId: id, color: 4 },
  { shapeId: id, color: 6 },
];

export const TUTORIAL_STEPS = [
  {
    key: 'tut_1',
    board: [],
    tray: [{ shapeId: 'I3H', color: 2 }, { shapeId: 'SQ2', color: 4 }, { shapeId: 'C3_0', color: 6 }],
    advance: { event: 'piecePlaced' },
  },
  {
    key: 'tut_2',
    board: [0, 1, 2, 3, 4].map((x) => ({ x, y: 7, color: 1 + (x % 7) })),
    tray: trio('I3H'),
    advance: { event: 'linesCleared' },
  },
  {
    key: 'tut_3',
    board: [
      ...[0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 6, color: 1 + (x % 7) })),
      ...[0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 7, color: 1 + ((x + 3) % 7) })),
    ],
    tray: trio('SQ2'),
    advance: { event: 'linesCleared', min: 2 },
  },
];

export function tutorialProvider(step) {
  return (board, rng, opts) => step.tray.slice(0, opts.count ?? 3).map((p) => ({ ...p }));
}
