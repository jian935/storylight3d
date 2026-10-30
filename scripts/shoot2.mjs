// 重拍精品截图：打开本地站 → 切故事 → 等全部资产加载完 → 自动取景后截图
// 用法: node scripts/shoot2.mjs <sprite|mech|tea> <输出文件名> [宽] [高]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9341;
const STORY = process.argv[2] || 'sprite';
const NAME = process.argv[3] || `shot-${STORY}`;
const W = Number(process.argv[4] || 1600);
const H = Number(process.argv[5] || 1000);
const MODE = process.argv[6] || 'ui'; // 'ui' | 'scene' | 'focus' | 'portrait'
const SCENE_ONLY = MODE === 'scene' || MODE === 'portrait';
const PORTRAIT_TARGET = process.argv[7] || ''; // portrait 模式要特写的实体名关键词，如「水晶树屋」
const OUT = 'E:/Agent/aholo-storylight3d/web/assets/generated/shots';
const URL = 'http://127.0.0.1:8080/';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

async function getWS() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page') || list[0];
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { await sleep(400); }
  }
  throw new Error('CDP 端点未就绪');
}

let id = 0;
const pending = new Map();
const logs = [];
function rpc(ws, method, params = {}) {
  const mid = ++id;
  return new Promise((res) => { pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
}

(async () => {
  const ws = new WebSocket(await getWS());
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300));
  };

  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Network.enable');
  await rpc(ws, 'Network.setCacheDisabled', { cacheDisabled: true });
  await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await rpc(ws, 'Page.navigate', { url: URL });
  await sleep(2500);

  // 切到指定故事并重新生成
  if (STORY !== 'sprite') {
    await rpc(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const sel = document.getElementById('story-picker');
        sel.value = ${JSON.stringify(STORY)};
        sel.dispatchEvent(new Event('change'));
        document.getElementById('btn-generate').click();
        return 'switched';
      })()`, returnByValue: true,
    });
  }

  // 轮询：所有实体 ok 且列表非空
  let ok = false;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const r = await rpc(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const lis = [...document.querySelectorAll('#entity-list li')];
        const states = lis.map(l => (l.querySelector('.tag-state')||{}).textContent||'');
        return JSON.stringify({ n: lis.length, states, done: lis.length>0 && states.every(s => s.includes('✓') || s.includes('Lux3D') || s.includes('占位')) });
      })()`, returnByValue: true,
    });
    try {
      // CDP Runtime.evaluate(returnByValue) 的真实返回路径是 r.result.result.value
      const raw = r?.result?.result?.value ?? r?.result?.value;
      const v = JSON.parse(raw);
      console.log(`  ${i * 2}s: ${v.n} 个实体 [${v.states.join(', ')}]`);
      if (v.done) { ok = true; break; }
    } catch (e) { if (i === 0) console.log('  eval读取失败:', String(e).slice(0,80)); }
  }
  await sleep(3000); // 等相机 lerp 收敛与纹理上传

  // 聚焦模式：隐藏其它实体，精确对准「小精灵」设置特写相机，得到干净的单模型特写
  if (MODE === 'focus') {
    await rpc(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const s = window.__sl3d, T = window.__THREE;
        if (!s || !T) return 'no-state';
        const ent = s.entities.find(e => e.name.indexOf('小精灵') >= 0) || s.entities[0];
        if (!ent) return 'no-ent';
        // 保留所有实体可见（真实交互态：镜头对准小精灵，其余仍在场景中）
        if (ent.group) ent.group.traverse(o => { if (o.isSprite) o.visible = true; });
        const box = new T.Box3().setFromObject(ent.group);
        const size = new T.Vector3(); box.getSize(size);
        const ctr = new T.Vector3(); box.getCenter(ctr);
        const fov = (s.camera.fov * Math.PI) / 180;
        const aspect = s.camera.aspect;
        const fitH = (size.y / 2) / Math.tan(fov / 2);
        const fitW = (Math.max(size.x, size.z) / 2) / (Math.tan(fov / 2) * aspect);
        const d = Math.max(fitH, fitW) * 1.18;
        s.focus = {
          cam: new T.Vector3(ctr.x + d * 0.28, ctr.y + size.y * 0.12, ctr.z + d),
          tgt: new T.Vector3(ctr.x, ctr.y, ctr.z),
        };
        return 'focus: ' + ent.name + ' size=' + size.toArray().map(v=>v.toFixed(1)).join(',') + ' d=' + d.toFixed(1);
      })()`, returnByValue: true,
    });
    await sleep(2800); // 等聚焦相机 lerp 收敛
  }

  // scene/focus 模式：隐藏所有 UI，只留 3D 画面，用于报告/视频的精品图
  if (SCENE_ONLY) {
    await rpc(ws, 'Runtime.evaluate', {
      expression: `(() => {
        ['.panel.left', '.log', '.topbar', '.viewer-head'].forEach(s => {
          const el = document.querySelector(s); if (el) el.style.display = 'none';
        });
        const g = document.querySelector('.layout');
        if (g) { g.style.gridTemplateColumns = '1fr'; g.style.background = '#0a0e15'; g.style.height = '100vh'; g.style.overflow = 'hidden'; }
        const p = document.querySelector('.right');
        if (p) { p.style.padding = '0'; p.style.height = '100vh'; p.style.overflow = 'hidden'; }
        // portrait：锁死页面高度、隐藏滚动条，避免竖视口下滚动露白 + 横向硬边
        ${MODE === 'portrait' ? `document.documentElement.style.cssText += ';height:100vh;overflow:hidden;background:#0a0e15;'; document.body.style.cssText += ';height:100vh;overflow:hidden;margin:0;background:#0a0e15;'; const vw = document.querySelector('.viewer'); if (vw) { vw.style.height = '100vh'; vw.style.overflow = 'hidden'; }` : ''}
        window.dispatchEvent(new Event('resize'));
        ${MODE === 'scene'
          ? "setTimeout(() => window.__frame && window.__frame(true), 200);"
          : `setTimeout(() => {
              const s = window.__sl3d, T = window.__THREE;
              if (!s || !T) return;
              const kw = ${JSON.stringify(PORTRAIT_TARGET)};
              const scenes = s.entities.filter(e => e.type === 'scene');
              const ent = (kw && s.entities.find(e => e.name.indexOf(kw) >= 0))
                        || (scenes.length ? scenes.reduce((a,b) => ((b.group?.userData?.footprint||0) > (a.group?.userData?.footprint||0) ? b : a)) : s.entities[0]);
              if (!ent) return;
              s.entities.forEach(e => { if (e.group) e.group.visible = (e === ent); });
              if (ent.group) ent.group.traverse(o => { if (o.isSprite) o.visible = false; });
              // 隐藏地面网格 + 圆形地面盘(CircleGeometry)，消除与纯色背景的横向明暗硬边
              s.scene.traverse(o => {
                if (o.isGridHelper || o.type === 'GridHelper') o.visible = false;
                if (o.isMesh && o.geometry && o.geometry.type === 'CircleGeometry') o.visible = false;
              });
              s.scene.background = new T.Color(0x0a0e15);
              // resize 之后 camera.aspect 已更新为竖屏值，用新 aspect 重新算取景
              const box = new T.Box3().setFromObject(ent.group);
              const size = new T.Vector3(); box.getSize(size);
              const ctr = new T.Vector3(); box.getCenter(ctr);
              const fov = (s.camera.fov * Math.PI) / 180;
              const aspect = s.camera.aspect;
              const fitH = (size.y / 2) / Math.tan(fov / 2);
              const fitW = (Math.max(size.x, size.z) / 2) / (Math.tan(fov / 2) * aspect);
              // 竖构图：竖向充满，同时保证横向(宽模型如茶舍)也不被裁；留足四周安全边距
              // 宽体量模型(茶舍台基)横向按更保守系数，避免贴边裁切
              const wide = size.x > size.y * 0.9 || size.z > size.y * 0.9;
              const d = Math.max(fitH * 1.42, fitW * (wide ? 1.62 : 1.3));
              s.focus = null; // 关键：清掉旧的 lerp 目标，否则 animate 会把相机拉回横屏位置
              // 竖构图近正视：水平偏移极小，保证模型左右居中、留白均衡
              s.camera.position.set(ctr.x + d * 0.08, ctr.y + size.y * 0.06, ctr.z + d);
              s.controls.target.set(ctr.x, ctr.y, ctr.z);
              s.controls.update();
            }, 260);`}
        return 'ok';
      })()`, returnByValue: true,
    });
    await sleep(2600);
  }

  const shot = await rpc(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const buf = Buffer.from(shot.result.data, 'base64');
  const dest = `${OUT}/${NAME}.png`;
  writeFileSync(dest, buf);
  console.log(`截图: ${dest} (${(buf.length / 1024).toFixed(0)} KB) ${ok ? '' : '⚠ 未全部就绪'}`);
  console.log('日志尾部:', logs.slice(-4).join(' | '));

  ws.close();
  edge.kill('SIGKILL');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); try { edge.kill('SIGKILL'); } catch {} process.exit(1); });
