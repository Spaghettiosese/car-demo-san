// Drive the game headlessly: node tests/play.mjs <outPrefix> <script.json>
// script: [{ "wait": ms } | { "down": "KeyW" } | { "up": "KeyW" } | { "press": "KeyC" } | { "shot": "name" } | { "eval": "js" } | {"click":[x,y]}]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const [,, prefix, scriptArg, w = '1280', h = '720'] = process.argv;
const script = JSON.parse(fs.existsSync(scriptArg) ? fs.readFileSync(scriptArg, 'utf8') : scriptArg);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/index.html`);
try { await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }); } catch (e) { logs.push('timeout waiting for __ready'); }
logs.push(`[ready] ${(Date.now() - t0) / 1000}s`);
for (const step of script) {
  if (step.wait) await page.waitForTimeout(step.wait);
  if (step.down) await page.keyboard.down(step.down);
  if (step.up) await page.keyboard.up(step.up);
  if (step.press) await page.keyboard.press(step.press);
  if (step.click) await page.mouse.click(step.click[0], step.click[1]);
  if (step.eval) { try { const r = await page.evaluate(step.eval); if (r !== undefined) logs.push(`[eval] ${JSON.stringify(r)}`); } catch (e) { logs.push('[eval error] ' + e.message); } }
  if (step.shot) await page.screenshot({ path: `${prefix}_${step.shot}.png` });
}
console.log(logs.join('\n'));
await browser.close();
server.close();
