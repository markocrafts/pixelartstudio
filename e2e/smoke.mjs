// Browser smoke test: create → draw → add layer → add frame → export PNG → reload → restored from autosave.
// Usage: npm run build && node e2e/smoke.mjs [url]   (needs Playwright's Chromium, see CLAUDE.md)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.argv[2] ?? 'http://localhost/pixelstudio/dist/?debug';
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const dir = fs.readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
if (!dir) throw new Error('No cached Playwright Chromium found');
const browser = await chromium.launch({ executablePath: path.join(cache, dir, 'chrome-linux64/chrome') });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const check = (cond, msg) => { if (!cond) fail(msg); else console.log('ok  ', msg); };

await page.goto(URL);
await page.waitForSelector('#canvas');
await page.evaluate(() => indexedDB.deleteDatabase('pixelforge'));
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#canvas');

// New 16x16 project
await page.click('#new');
await page.selectOption('#preset', '16');
await page.click('#newdlg button[value=ok]');
await page.waitForFunction(() => window.__editor.project.width === 16);

const px = async (x, y) => {
  const box = await (await page.$('#canvas')).boundingBox();
  const zoom = parseInt(await page.textContent('#zoom')) / 100;
  const ox = box.x + Math.round((box.width - 16 * zoom) / 2), oy = box.y + Math.round((box.height - 16 * zoom) / 2);
  return [ox + x * zoom + zoom / 2, oy + y * zoom + zoom / 2];
};
await page.evaluate(() => window.__editor.setPrimary(0xff0000ff));
let [x, y] = await px(3, 3);
await page.mouse.click(x, y);
await page.click('#lyAdd');
await page.click('#fAdd');
[x, y] = await px(5, 5);
await page.mouse.click(x, y);
await page.fill('#pname', 'Smoke test');
await page.dispatchEvent('#pname', 'change');

const before = await page.evaluate(() => ({ layers: window.__editor.project.layers.length, frames: window.__editor.project.frames.length, name: window.__editor.project.name, id: window.__editor.project.id }));
check(before.layers === 2 && before.frames === 2, 'project has 2 layers and 2 frames');

// Export PNG
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
const file = await dl.path();
const png = fs.readFileSync(file);
check(png.subarray(1, 4).toString() === 'PNG', 'PNG export downloaded');

// Autosave (the gallery saves before listing), then reload
await page.click('#gallery');
await page.waitForSelector('#galleryDlg[open] .gcard');
await page.click('#gClose');
await page.reload();
await page.waitForSelector('#canvas');
await page.waitForFunction((id) => window.__editor.project.id === id, before.id, { timeout: 8000 }).catch(() => {});
const after = await page.evaluate(() => {
  const e = window.__editor, p = e.project;
  return { layers: p.layers.length, frames: p.frames.length, name: p.name, id: p.id, dot: p.frames[1].cels.get(p.layers[1].id)[5 * 16 + 5] >>> 0 };
});
check(after.id === before.id && after.layers === 2 && after.frames === 2, 'project restored after reload');
check(after.name === 'Smoke test', 'project name restored');
check(after.dot === 0xff0000ff, 'pixel data restored');

console.log(errors.length ? `console errors: ${JSON.stringify(errors)}` : 'no console errors');
if (errors.length) process.exitCode = 1;
await browser.close();
