// CDP 驱动 Edge 加载 StoryLight3D 网页，捕获控制台日志并截图，验证真实 GLB 渲染。
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const URL = 'http://127.0.0.1:8080/';
const OUT = 'E:/Agent/aholo-storylight3d/web/assets/generated';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,800', 'about:blank'
], { stdio: 'ignore' });

async function getWS() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = (list.find((t) => t.type === 'page') || list[0]);
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { await sleep(300); }
  }
  throw new Error('Edge 页面调试端点未就绪');
}

const logs = [];
let id = 0;
const pending = new Map();
function rpc(ws, method, params = {}) {
  const mid = ++id;
  return new Promise((res) => { pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
}
function onMessage(ws, data) {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown' || m.method === 'Log.entryAdded') {
    let txt;
    if (m.method === 'Runtime.consoleAPICalled') txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    else if (m.method === 'Runtime.exceptionThrown') txt = 'EXC: ' + JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    else txt = 'LOG: ' + JSON.stringify(m.params.entry?.text || m.params.text || '');
    logs.push(txt);
  }
}

(async () => {
  const wsUrl = await getWS();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => onMessage(ws, ev.data);

  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Log.enable');
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Page.navigate', { url: URL });
  await sleep(14000); // 等待 manifest 加载 + 自动生成 + GLB 载入

  try {
    const diag = await rpc(ws, 'Runtime.evaluate', { expression: 'document.title + " | bodyLen=" + document.body.innerHTML.length + " | entities=" + document.querySelectorAll("#entity-list li").length', returnByValue: true });
    console.log('页面诊断:', diag.result && diag.result.value);
  } catch (e) { console.log('诊断失败:', e.message); }

  try {
    const shot = await rpc(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    if (shot && shot.result && shot.result.data) {
      const buf = Buffer.from(shot.result.data, 'base64');
      writeFileSync(`${OUT}/_test_sprite.png`, buf);
      console.log('截图字节:', buf.length);
    } else {
      console.log('截图返回异常:', JSON.stringify(shot).slice(0, 200));
    }
  } catch (e) { console.log('截图失败:', e.message); }

  console.log('=== 控制台日志（' + logs.length + ' 条）===');
  logs.forEach((l) => console.log('  ' + l));
  ws.close();
  edge.kill('SIGKILL');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); try { edge.kill('SIGKILL'); } catch {} process.exit(1); });
