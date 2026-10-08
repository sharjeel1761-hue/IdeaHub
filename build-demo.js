#!/usr/bin/env node
/*
 * Bundles the app into one self-contained HTML file that runs entirely in the browser (no server):
 *   node build-demo.js            → dist/ideahub-demo.html (libraries from cdnjs)
 *   node build-demo.js --local    → dist/ideahub-demo-local.html (libraries from public/vendor, for offline testing)
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const local = process.argv.includes('--local');
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const inline = code => code.replace(/<\/script/gi, '<\\/script');

const html = read('public/index.html');
const shell = html.split('<!--SHELL-->')[1].split('<!--/SHELL-->')[0].trim();
const libs = local
  ? ['public/vendor/marked.min.js', 'public/vendor/purify.min.js', 'public/vendor/highlight.min.js'].map(p => `<script src="${path.join(__dirname, p)}"></script>`).join('\n') +
    `\n<script src="${path.join(__dirname, 'public/vendor/tex-svg-full.js')}" async></script>`
  : ['marked/12.0.2/marked.min.js', 'dompurify/3.1.6/purify.min.js', 'highlight.js/11.9.0/highlight.min.js']
    .map(p => `<script src="https://cdnjs.cloudflare.com/ajax/libs/${p}"></script>`).join('\n') +
    '\n<script src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg-full.js" async></script>';

const out = `<title>IdeaHub DDUC</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Caveat:wght@600&family=JetBrains+Mono:wght@400;700&display=swap">
<style>
${read('public/styles.css')}
</style>
<script>window.MathJax = { tex: { inlineMath: [['$', '$']], displayMath: [['$$', '$$']] }, svg: { fontCache: 'global' }, startup: { typeset: false } };</script>
${libs}
${shell}
<script>
${inline(read('src/core.js'))}
</script>
<script>
${inline(read('src/seed.js'))}
</script>
<script>
${inline(read('src/demo.js'))}
</script>
<script>
${inline(read('public/app.js'))}
</script>
`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const file = path.join(__dirname, 'dist', local ? 'ideahub-demo-local.html' : 'ideahub-demo.html');
fs.writeFileSync(file, local ? `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n${out}</body></html>` : out);
console.log('Wrote', file, (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
