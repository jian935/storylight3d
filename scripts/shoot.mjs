// 用 CDP 驱动 Edge，捕获 StoryLight3D 各故事的真实渲染截图，供报告与视频使用。
import { spawn } from 'node:child_process';
import { writeFileSync, renameSync, existsSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const URL = 'http://127.0.0.1:8080/';
const SHOTS = 'E:/Agent/aholo-storylight3d/web/assets/generated/shots';
const MANIFEST = 'E:/Agent/aholo-storylight3d/web/assets/generated/manifest.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,800', 'about:blank'
], { stdio: 'ignore' });

async function getWS() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page') || list[0];
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { await sleep(300); }
  }
  throw new Error('Edge 页面调试端点未就绪');
}
let id = 0; const pending = new Map();
function rpc(ws, method, params = {}) {
  const mid = ++id;
  return new Promise((res) => { pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
}
function onMessage(ws, data) {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
}
async function shot(ws, name) {
  const r = await rpc(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  if (r?.result?.data) { writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('  ✓', name); }
}
async function evalJs(ws, expr) {
  const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
  return r?.result?.value;
}

(async () => {
  const ws = new WebSocket(await getWS());
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => onMessage(ws, e.data);
  await rpc(ws, 'Runtime.enable'); await rpc(ws, 'Page.enable');
  await rpc(ws, 'Page.navigate', { url: URL });
  await sleep(13000);
  await shot(ws, 'shot-sprite');

  // 聚焦第一个实体（小精灵）
  await evalJs(ws, `document.querySelectorAll('#entity-list li')[0].click();`);
  await sleep(3500);
  await shot(ws, 'shot-focus');

  // 切换轨道机甲
  await evalJs(ws, `const p=document.getElementById('story-picker'); p.value='mech'; p.dispatchEvent(new Event('change')); document.getElementById('btn-generate').click();`);
  await sleep(11000);
  await shot(ws, 'shot-mech');

  // 切换云雾茶舍
  await evalJs(ws, `const p=document.getElementById('story-picker'); p.value='tea'; p.dispatchEvent(new Event('change')); document.getElementById('btn-generate').click();`);
  await sleep(11000);
  await shot(ws, 'shot-tea');

  // 占位对比：临时移走 manifest → 重新加载 → 占位模型
  if (existsSync(MANIFEST)) renameSync(MANIFEST, MANIFEST + '.bak');
  await rpc(ws, 'Page.navigate', { url: URL });
  await sleep(13000);
  await shot(ws, 'shot-placeholder');
  if (existsSync(MANIFEST + '.bak')) renameSync(MANIFEST + '.bak', MANIFEST);

  console.log('全部截图完成 →', SHOTS);
  ws.close(); edge.kill('SIGKILL'); process.exit(0);
})().catch((e) => { console.error('ERR', e); try { edge.kill('SIGKILL'); } catch {} process.exit(1); });
