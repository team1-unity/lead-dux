// Position map into the 9-column x 6-row doodle-icon sheet at
// /badges-sprite.jpg (see BadgeRing in Badges.jsx, which pairs this with
// `background-size: 900% 600%`). Grid measured directly off the source
// image (2000x2000, 9x6 uniform cells) — coordinates below are exact cell
// indices, not guesses.
const COLS = 9;
const ROWS = 6;

const CELL = {
  'first-quest': [0, 1], // paper plane
  'high-five': [0, 2], // target + arrow
  regular: [4, 1], // anchor
  'community-pillar': [3, 4], // tall pyramid
  'quest-warrior': [3, 1], // lightning bolt
  'side-quester': [2, 1], // dice
  explorer: [1, 4], // location pin
  'rising-fast': [4, 4], // zigzag trend arrow

  'tag-community': [3, 0], // stick figure
  'tag-education': [6, 2], // signpost
  'tag-environment': [4, 3], // leaf
  'tag-outdoors': [2, 2], // trailblazing arrow
  'tag-technology': [3, 5], // UFO
  'tag-youth': [5, 2], // forked arrow (mentorship)
  'tag-fitness': [6, 1], // spring
  'tag-food-security': [1, 2], // aid cross
  'tag-arts': [1, 5], // sparkles
};

export function badgeSpritePosition(id) {
  const cell = CELL[id];
  if (!cell) return '50% 50%';
  const [col, row] = cell;
  return `${(col / (COLS - 1)) * 100}% ${(row / (ROWS - 1)) * 100}%`;
}
