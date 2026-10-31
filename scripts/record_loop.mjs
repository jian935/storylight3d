// 录制 StoryLight3D「闭环演示」真实运行画面（CDP Page.startScreencast）
// 输出：deliverables/video/loop/frames/*.jpg + timeline.json（帧时间戳 + 分段标记）
//
// 与旧版演示视频的区别：旧版是报告截图做 Ken-Burns 幻灯片；
// 本脚本采集的是应用真实运行的连续帧（含运镜/加载/切换/聚焦），用于"视频闭环"。
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/Agent/aholo-storylight3d';
const OUT = path.join(ROOT, 'deliverables/video/loop');
const FRAMES = path.join(OUT, 'frames');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9336;
const URL = 'http://127.0.0.1:8080/';
const W = 1280, H = 720;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (existsSync(FRAMES)) rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

// 用 D3D11（本机 RTX 4060）做硬件渲染：软件渲染(SwiftShader)只有 ~3fps，
// 录出来会严重卡顿；实测 D3D11 下 rAF 60fps、screencast 59fps。
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu-sandbox',
  '--use-angle=d3d11', '--enable-gpu',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--window-size=${W},${H}`, 'about:blank'
], { stdio: 'ignore' });

async function getWS() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page') || list[0];
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { await sleep(300); }
  }
  throw new Error('Edge 调试端点未就绪');
}

let id = 0;
const pending = new Map();
let ws;
function rpc(method, params = {}) {
  const mid = ++id;
  return new Promise((res) => { pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
}
async function evalJs(expr, awaitPromise = false) {
  const r = await rpc('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  if (r?.result?.exceptionDetails) console.error('JS ERR:', r.result.exceptionDetails.text);
  return r?.result?.result?.value;
}
async function waitFor(expr, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(expr)) return true;
    await sleep(250);
  }
  console.error('timeout waiting:', label || expr);
  return false;
}

// ---- 页面内运镜助手（注入一次） ----
const HELPERS = `
window.__shot = {
  orbit(ms, turn) {
    const st = window.__sl3d; if (!st) return;
    const cam = st.camera, ctr = st.controls; st.focus = null;
    const t0 = performance.now();
    const dx = cam.position.x - ctr.target.x, dz = cam.position.z - ctr.target.z;
    const r = Math.hypot(dx, dz) || 10, y = cam.position.y;
    const a0 = Math.atan2(dz, dx);
    if (st.__anim) cancelAnimationFrame(st.__anim);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const a = a0 + (turn || 0.9) * k;
      cam.position.x = ctr.target.x + Math.cos(a) * r;
      cam.position.z = ctr.target.z + Math.sin(a) * r;
      cam.position.y = y; ctr.update();
      if (k < 1) st.__anim = requestAnimationFrame(step);
    };
    step();
  },
  zoom(factor, ms) {
    const st = window.__sl3d; if (!st) return;
    const cam = st.camera, ctr = st.controls; st.focus = null;
    const t0 = performance.now();
    const p0 = cam.position.clone(), tgt = ctr.target.clone();
    const p1 = tgt.clone().add(p0.clone().sub(tgt).multiplyScalar(factor));
    if (st.__anim) cancelAnimationFrame(st.__anim);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cam.position.lerpVectors(p0, p1, e); ctr.update();
      if (k < 1) st.__anim = requestAnimationFrame(step);
    };
    step();
  },
  title(html) {
    let ov = document.getElementById('__shotTitle');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = '__shotTitle';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 45%,#131c2e 0%,#080b12 75%);color:#fff;transition:opacity .9s ease;font-family:"Microsoft YaHei","PingFang SC",sans-serif;';
    ov.innerHTML = html;
    document.body.appendChild(ov);
    return true;
  },
  fadeTitle() {
    const ov = document.getElementById('__shotTitle');
    if (!ov) return;
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 1000);
  }
};
'ok'
`;

(async () => {
  ws = new WebSocket(await getWS());
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.screencastFrame') {
      const { data, sessionId } = m.params;
      const file = `f${String(frameIdx).padStart(6, '0')}.jpg`;
      writeFileSync(path.join(FRAMES, file), Buffer.from(data, 'base64'));
      frames.push({ file, t: Date.now() - t0 });
      frameIdx++;
      rpc('Page.screencastFrameAck', { sessionId });
    }
  };

  await rpc('Runtime.enable');
  await rpc('Page.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: URL });

  // 等默认故事（精灵森林 4 个实体）真正加载完
  await waitFor('!!(window.__sl3d && window.__sl3d.entities && window.__sl3d.entities.length>=4)', 60000, 'default scene');
  await sleep(1500);
  await evalJs(HELPERS);

  const t0 = Date.now();
  let frameIdx = 0;
  const frames = [];
  const marks = [];
  await rpc('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 2 });
  await sleep(400);

  async function seg(name, fn) {
    const start = Date.now() - t0;
    await fn();
    const end = Date.now() - t0;
    marks.push({ name, start, end });
    console.log(`seg ${name}: ${((end - start) / 1000).toFixed(1)}s`);
  }

  // S0 钩子：缓慢绕场（开场标题卡由后期 build_loop_video.py 生成，避免页内叠加重复）
  await seg('s0_hook', async () => {
    await evalJs(`window.__shot.orbit(9000, 0.55)`);
    await sleep(9000);
  });

  // S1 理念：反向绕场，展示真实资产
  await seg('s1_idea', async () => {
    await evalJs(`window.__shot.orbit(7000, -0.7)`);
    await sleep(7000);
  });

  // S2 生成闭环：切到轨道机甲 → 生成 → 等真实资产载入
  await seg('s2_generate', async () => {
    await evalJs(`(()=>{const p=document.getElementById('story-picker');p.value='mech';p.dispatchEvent(new Event('change'));document.getElementById('btn-generate').click();return 'clicked';})()`);
    await waitFor("window.__sl3d && window.__sl3d.entities.length===3", 40000, 'mech loaded');
    await sleep(1800);
    await evalJs(`window.__shot.orbit(6000, 0.6)`);
    await sleep(6000);
  });

  // S3 交互：推近 + 绕场
  await seg('s3_interact', async () => {
    await evalJs(`window.__shot.zoom(0.62, 4200)`);
    await sleep(4200);
    await evalJs(`window.__shot.orbit(5000, 0.85)`);
    await sleep(5000);
  });

  // S4 聚焦：点实体 → 镜头自动聚焦
  await seg('s4_focus', async () => {
    await evalJs(`(()=>{const li=document.querySelectorAll('#entity-list li')[0]; if(li) li.click(); return (li&&li.textContent)||'none';})()`);
    await sleep(3200);
    await evalJs(`window.__shot.orbit(3000, 0.28)`);
    await sleep(3000);
  });

  // S5 第三个故事：切到云雾茶舍 → 生成 → 绕场
  await seg('s5_tea', async () => {
    await evalJs(`(()=>{const p=document.getElementById('story-picker');p.value='tea';p.dispatchEvent(new Event('change'));document.getElementById('btn-generate').click();return 'clicked';})()`);
    await waitFor("window.__sl3d && window.__sl3d.entities.length===3", 40000, 'tea loaded');
    await sleep(1600);
    await evalJs(`window.__shot.orbit(6000, 0.55)`);
    await sleep(6000);
  });

  // S6 收尾：标题卡 + 轻绕场
  await seg('s6_close', async () => {
    await evalJs(`window.__shot.title('<div style="font-size:52px;font-weight:800;letter-spacing:2px">写作即造物，故事即世界</div><div style="margin-top:20px;font-size:24px;color:#22d3ee">StoryLight3D · Powered by Aholo Lux3D</div><div style="margin-top:10px;font-size:17px;color:#7f8ea3">在线 Demo 可体验 · 源码已开源</div>', 'end')`);
    await evalJs(`window.__shot.orbit(7000, 0.4)`);
    await sleep(7000);
  });

  await rpc('Page.stopScreencast');
  await sleep(300);

  const timeline = { width: W, height: H, t0, marks, frameCount: frames.length, frames };
  writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline));
  console.log(`frames=${frames.length}, total=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('marks:', marks.map((m) => `${m.name} ${(m.start / 1000).toFixed(1)}-${(m.end / 1000).toFixed(1)}`).join(' | '));

  ws.close();
  edge.kill('SIGKILL');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e);
  try { edge.kill('SIGKILL'); } catch {}
  process.exit(1);
});
