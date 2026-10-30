// 线上站点实机验证：无头 Edge 打开公网分享链接，等待真实 GLB 加载，截图 + 收集控制台。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const URL = process.argv[2] || 'https://storylight3d-demo.app.workbuddy.host/?sharecode=XMGNJCAINZ';
const OUT = 'E:/Agent/aholo-storylight3d/deliverables/check';
const WAIT = Number(process.argv[3] || 75000);

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,800', '--disable-web-security=false', 'about:blank'
], { stdio: 'ignore' });

async function getWS() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page') || list[0];
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { await sleep(400); }
  }
  throw new Error('Edge 页面调试端点未就绪');
}

const logs = [];
const failed = [];
let id = 0;
const pending = new Map();
function rpc(ws, method, params = {}) {
  const mid = ++id;
  return new Promise((res) => { pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
}
function onMessage(ws, data) {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  } else if (m.method === 'Network.loadingFailed') {
    failed.push(`${m.params.type} ${m.params.errorText}`);
  } else if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    if (r.status >= 400) failed.push(`HTTP ${r.status} ${r.url.slice(0, 90)}`);
  }
}

(async () => {
  const ws = new WebSocket(await getWS());
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => onMessage(ws, ev.data);

  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Log.enable');
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Network.enable');
  await rpc(ws, 'Page.navigate', { url: URL });

  // 轮询实体列表状态，直到全部非 pending 或超时
  let ready = false;
  for (let t = 0; t < WAIT / 2500; t++) {
    await sleep(2500);
    try {
      const r = await rpc(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const lis = [...document.querySelectorAll('#entity-list li')];
          const states = lis.map(li => (li.querySelector('.tag-state')||{}).textContent || '');
          return JSON.stringify({ n: lis.length, states, done: lis.length > 0 && !states.some(s => s.includes('生成中')) });
        })()`, returnByValue: true,
      });
      const v = JSON.parse(r.result.value);
      if (v.n) {
        console.log(`t=${(t + 1) * 2.5}s 实体 ${v.n} 个: ${v.states.join(' | ')}`);
        if (v.done) { ready = true; break; }
      }
    } catch {}
  }

  await sleep(2500);
  const diag = await rpc(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({ title: document.title, li: document.querySelectorAll('#entity-list li').length,
      ok: document.querySelectorAll('.tag-state.ok').length, status: (document.getElementById('status')||{}).textContent,
      canvas: !!document.querySelector('#viewer canvas') })`, returnByValue: true,
  });
  console.log('\n=== 页面诊断 ===');
  console.log(diag.result?.value);

  const shot = await rpc(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (shot?.result?.data) {
    const buf = Buffer.from(shot.result.data, 'base64');
    writeFileSync(`${OUT}/online-default.png`, buf);
    console.log('截图:', `${OUT}/online-default.png`, buf.length, 'B');
  }

  console.log('\n=== 控制台（' + logs.length + ' 条）===');
  logs.forEach((l) => console.log('  ' + l));
  console.log('\n=== 请求失败（' + failed.length + ' 条）===');
  failed.slice(0, 20).forEach((l) => console.log('  ' + l));

  console.log('\n判定: ' + (ready ? '全部实体已就绪' : '仍存在未完成实体（可能超时）'));
  ws.close();
  edge.kill('SIGKILL');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); try { edge.kill('SIGKILL'); } catch {} process.exit(1); });
