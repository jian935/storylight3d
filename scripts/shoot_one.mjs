// 单独捕获某一个故事的截图，并在截图前校验实体列表。用法：node scripts/shoot_one.mjs <sprite|mech|tea> <outname>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const story = process.argv[2] || 'tea';
const out = process.argv[3] || 'shot-tea';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const URL = 'http://127.0.0.1:8080/';
const SHOTS = 'E:/Agent/aholo-storylight3d/web/assets/generated/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });

async function getWS() {
  for (let i = 0; i < 40; i++) { try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = list.find((t) => t.type === 'page') || list[0]; if (p && p.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { await sleep(300); } }
  throw new Error('no page');
}
let id = 0; const pending = new Map();
function rpc(ws, method, params = {}) { const mid = ++id; return new Promise((res) => { pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); }); }
function onMessage(ws, data) { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } }
async function evalJs(ws, expr) { const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }); return r?.result?.value; }

(async () => {
  const ws = new WebSocket(await getWS());
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => onMessage(ws, e.data);
  await rpc(ws, 'Runtime.enable'); await rpc(ws, 'Page.enable');
  await rpc(ws, 'Page.navigate', { url: URL });
  await sleep(13000);
  const items = await evalJs(ws, `(()=>{document.getElementById('story-picker').value='${story}';document.getElementById('story-picker').dispatchEvent(new Event('change'));document.getElementById('btn-generate').click();return 'switched';})()`);
  await sleep(12000);
  const list = await evalJs(ws, `Array.from(document.querySelectorAll('#entity-list li span:nth-child(2)')).map(s=>s.textContent).join(' / ')`);
  console.log(`故事=${story} 实体列表:`, list);
  const r = await rpc(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  if (r?.result?.data) { writeFileSync(`${SHOTS}/${out}.png`, Buffer.from(r.result.data, 'base64')); console.log('✓ 截图', out); }
  ws.close(); edge.kill('SIGKILL'); process.exit(0);
})().catch((e) => { console.error('ERR', e); try { edge.kill('SIGKILL'); } catch {} process.exit(1); });
