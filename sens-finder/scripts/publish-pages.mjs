/**
 * Publish the static app into the workspace GitHub Pages folder.
 *
 * This repository publishes docs/ (branch main, /docs), while the source
 * lives in sens-finder/. The app uses only relative URLs, so copying the
 * three runtime files into docs/sens-finder/ exposes it at:
 *   https://hguohbter.github.io/dsh-workspace/sens-finder/
 *
 * Usage: node scripts/publish-pages.mjs   (or: pnpm publish-pages)
 * Override the destination with OUT=... if the Pages layout changes.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.env.OUT || path.join(project, '..', 'docs', 'sens-finder'));

const files = ['index.html', 'styles.css'];
const dirs = ['src'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of files) {
  await cp(path.join(project, file), path.join(out, file));
}
for (const dir of dirs) {
  await cp(path.join(project, dir), path.join(out, dir), { recursive: true });
}

const sizes = [];
for (const file of files) {
  sizes.push(`${file} (${(await stat(path.join(out, file))).size} B)`);
}
for (const dir of dirs) {
  sizes.push(`${dir}/`);
}
console.log(`Published to ${out}`);
console.log('  ' + sizes.join(', '));
console.log('URL: https://hguohbter.github.io/dsh-workspace/sens-finder/');
