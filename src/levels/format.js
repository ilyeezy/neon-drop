// Раскладка уровня хранится строками — по одной на ряд поля. Так сотня уровней
// остаётся читаемой глазами и правится руками, а координатный список из
// нескольких тысяч записей был бы нечитаем.
//
//   '.' пусто        '#' обычный блок     'g' золотая цель (пустая клетка)
//   'i' лёд          'I' толстый лёд      's' камень        'b' бомба
export const CELL_SYMBOLS = { EMPTY: '.', BLOCK: '#', ICE: 'i', THICK_ICE: 'I', STONE: 's', BOMB: 'b', GOLD: 'g' };

const colorFor = (x, y) => 1 + ((x * 3 + y * 5) % 7);

export function parseBoard(level) {
  const cells = [];
  const rows = level.rows ?? [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      switch (ch) {
        case '#': cells.push({ x, y, color: colorFor(x, y) }); break;
        case 'i': cells.push({ x, y, color: colorFor(x, y), special: 'ice', hp: 1 }); break;
        case 'I': cells.push({ x, y, color: colorFor(x, y), special: 'ice', hp: 2 }); break;
        case 's': cells.push({ x, y, color: colorFor(x, y), special: 'stone' }); break;
        case 'b': cells.push({ x, y, color: colorFor(x, y), special: 'bomb', timer: level.bombTimer ?? 12 }); break;
        case 'g': cells.push({ x, y, gold: true }); break;
        default: break; // '.' и всё незнакомое — пустая клетка
      }
    });
  });
  return cells;
}
