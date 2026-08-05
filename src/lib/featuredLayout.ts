/**
 * The featured-card rhythm shared by the article grids (the home feed and the
 * five category portals).
 *
 * A "featured" card is a large one occupying two card columns, as if the two
 * stories it stands between had been merged. It moves one place to the right on
 * each successive row and returns to the left after four, so the cycle is
 * sixteen cards. Every row comes to exactly 1548px — the grid's full width at
 * the five-column layout:
 *
 *   row 1   large(1+2) + 3 normal            612 + 3x300 + 3x12
 *   row 2   normal + large(2+3) + 2 normal   300 + 612 + 2x300 + 3x12
 *   row 3   2 normal + large(3+4) + normal   2x300 + 612 + 300 + 3x12
 *   row 4   3 normal + large(4+5)            3x300 + 612 + 3x12
 *
 * Because every row holds the same four cards, the wrap points never move and
 * the columns stay aligned however far the reader scrolls.
 *
 * This module decides only WHICH cards are featured. The width itself lives in
 * each grid's stylesheet and is switched on at the five-per-row layout alone; on
 * anything narrower the class does nothing and the grid is the plain row of
 * equal cards it has always been.
 */

/**
 * How many cards stand in a row at the widest layout: three normal ones plus
 * the large card, which is two columns wide, filling all five columns.
 */
export const CARDS_PER_ROW = 4;

/** Whether the card at `index` is the large one in its row. */
export function isFeatured(index: number): boolean {
  const place = index % CARDS_PER_ROW;
  const row = Math.floor(index / CARDS_PER_ROW);
  return place === row % CARDS_PER_ROW;
}
