import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9222;
const PROXY = 'http://127.0.0.1:54252';
const USERDATA = 'E:/Agent/.tmp/edge-profile';
const OUT = 'E:/Agent/.tmp/aholo-reg';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

const edge = spawn(EDGE, [
  '--headless=new', '--remote-debugging-port=' + PORT,
  '--proxy-server=' + PROXY, '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--user-data-dir=' + USERDATA, 'about:blank',
], { stdio: 'ignore' });

let ver;
for (let i = 0; i < 40; i++) {
  await sleep(400);
  try { ver = await getJSON('/json/version'); if (ver && ver.webSocketDebuggerUrl) break; } catch (e) {}
}
if (!ver || !ver.webSocketDebuggerUrl) { console.error('Edge CDP 未就绪'); edge.kill(); process.exit(1); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
const pending = new Map();
let id = 0;
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

// 浏览器级：建 target + attach 拿到 sessionId
const created = await send('Target.createTarget', { url: 'about:blank' });
const targetId = created.result.targetId;
const attached = await send('Target.attachToTarget', { targetId, flatten: true });
const sessionId = attached.result.sessionId;

function ssend(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, sessionId, method, params }));
  });
}

await ssend('Page.enable');
await ssend('Runtime.enable');

const url = process.argv[2] || 'https://www.aholo3d.cn/hackathon/register';
console.log('navigate ->', url);
await ssend('Page.navigate', { url });
await sleep(Number(process.argv[3] || 6000));

const loc = await ssend('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
console.log('LOC RAW:', JSON.stringify(loc).slice(0, 400));
const title = await ssend('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
console.log('TITLE RAW:', JSON.stringify(title).slice(0, 400));
const html = await ssend('Runtime.evaluate', { expression: 'document.body ? document.body.outerHTML : "NO_BODY"', returnByValue: true });
console.log('HTML RAW:', JSON.stringify(html).slice(0, 400));
const body = (html.result && html.result.value) || '';
fs.writeFileSync(OUT + '/page.html', body);
console.log('HTML bytes:', body.length);

if (process.argv.includes('--shot')) {
  const shot = await ssend('Page.captureScreenshot', { format: 'png', full: true });
  fs.writeFileSync(OUT + '/page.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved');
}

await ssend('Target.closeTarget', { targetId });
ws.close();
edge.kill();
process.exit(0);
