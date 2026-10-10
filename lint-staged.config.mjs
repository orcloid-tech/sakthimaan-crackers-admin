// Windows limits command-line length, so large commits lint/format the whole repo
// instead of passing every file name (paths are quoted: the repo path contains spaces).
const MAX_FILES = 25;
const quote = (files) => files.map((f) => `"${f}"`).join(' ');

export default {
  '*.{ts,tsx,mjs,js}': (files) =>
    files.length > MAX_FILES
      ? ['eslint --fix .', 'prettier --write .']
      : [`eslint --fix --no-warn-ignored ${quote(files)}`, `prettier --write ${quote(files)}`],
  '*.{json,md,yml,yaml,css,html}': (files) =>
    files.length > MAX_FILES ? 'prettier --write .' : `prettier --write ${quote(files)}`,
};
