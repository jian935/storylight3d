import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEMO_STORIES, DEMO_DEFAULT } from './demo-story.js';
import { parseStory } from './story-parse.js';
import { loadManifest, getModelForEntity, generateTextToGlbUrl, isConfigured } from './lux3d.js';

// ---------- 状态 ----------
const state = {
  scene: null, camera: null, renderer: null, controls: null,
  entities: [],          // { name, type, prompt, group, pos }
  focus: null,           // 相机聚焦插值目标
  cfg: loadCfg(),
  manifest: null,        // 预生成资产清单（本机脚本产出）
};

// 按类型定目标尺寸：场景要够大，道具要收小，否则角色和房子一样高
const TARGET_SIZE = { character: 2.3, creature: 2.4, prop: 2.0, scene: 3.6 };

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const storyEl = $('story');
const listEl = $('entity-list');
const viewerEl = $('viewer');
const overlayEl = $('overlay');
const statusEl = $('status');
const logEl = $('log');
const progWrap = $('progress');
const progBar = $('progress-bar');

function log(msg, cls = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = msg;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------- 配置（localStorage，仅实时模式用） ----------
function loadCfg() {
  try { return JSON.parse(localStorage.getItem('sl3d_cfg') || '{}'); }
  catch { return {}; }
}
function saveCfg(cfg) { localStorage.setItem('sl3d_cfg', JSON.stringify(cfg)); }

// ---------- Three.js 初始化 ----------
function initThree() {
  const w = viewerEl.clientWidth, h = viewerEl.clientHeight;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e15);
  scene.fog = new THREE.Fog(0x0a0e15, 26, 78);

  const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 1000);
  camera.position.set(0, 6, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewerEl.appendChild(renderer.domElement);

  // 关键：PBR 金属/水晶材质没有环境贴图会渲染成纯黑。
  // 这里自建一个「紫蓝青」彩光环境，让水晶、镜面、金属反射出主题色而不是灰白。
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(makeEnvScene(), 0.02).texture;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1.5, 0);
  controls.minDistance = 3;
  controls.maxDistance = 80;

  // 三灯布光：天光 + 主光 + 双色补光，保证暗底上模型不发黑
  scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x2a3446, 1.6));
  const dir = new THREE.DirectionalLight(0xffffff, 2.4);
  dir.position.set(8, 15, 10);
  scene.add(dir);
  const fill = new THREE.PointLight(0x7fe9ff, 2.2, 70);
  fill.position.set(-10, 8, -6);
  scene.add(fill);
  const rim = new THREE.PointLight(0xf0abfc, 1.5, 60);
  rim.position.set(5, 6, -10);
  scene.add(rim);

  // 有质感的地面 + 淡网格，避免纯黑虚空
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(80, 72),
    new THREE.MeshStandardMaterial({ color: 0x121a28, roughness: 0.55, metalness: 0.4 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const grid = new THREE.GridHelper(60, 60, 0x33425a, 0x1e2836);
  grid.material.transparent = true;
  grid.material.opacity = 0.32;
  grid.position.y = 0.01;
  scene.add(grid);

  state.scene = scene; state.camera = camera; state.renderer = renderer; state.controls = controls;

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPick);
  animate();
}

// ---------- 自定义 IBL 环境：紫蓝青三色柔光箱 ----------
function makeEnvScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x0a0e15);
  const panel = (hex, boost, pos, sx, sy) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    m.material.color.setHex(hex).multiplyScalar(boost);
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(sx, sy, 1);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(0x4f46e5, 2.6, [-8, 5, -7], 10, 10);   // 靛蓝
  panel(0x22d3ee, 2.2, [8, 3, -6], 9, 9);      // 青
  panel(0xf0abfc, 1.7, [0, 9, 5], 8, 8);       // 粉紫顶光
  panel(0xffffff, 3.4, [4, 10, 3], 3.4, 3.4);  // 主高光
  panel(0x1e293b, 1.0, [0, -6, 0], 16, 16);    // 地面暗补
  return s;
}

function onResize() {
  const w = viewerEl.clientWidth, h = viewerEl.clientHeight;
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(w, h);
}

// ---------- 占位模型 ----------
const TYPE_STYLE = {
  character: { color: 0x6ee7ff, shape: 'capsule', scale: 1.4 },
  creature:  { color: 0xa78bfa, shape: 'sphere',  scale: 1.2 },
  prop:      { color: 0xfbbf24, shape: 'box',     scale: 0.9 },
  scene:     { color: 0x34d399, shape: 'platform',scale: 2.6 },
};

function makePlaceholder(type) {
  const s = TYPE_STYLE[type] || TYPE_STYLE.prop;
  const group = new THREE.Group();
  let mesh;
  const mat = new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.92 });
  if (s.shape === 'capsule') mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 8, 16), mat);
  else if (s.shape === 'sphere') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 18), mat);
  else if (s.shape === 'box') mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  else {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.4, 32), mat);
    mesh.position.y = -0.2;
  }
  if (s.shape !== 'platform') mesh.position.y = 1.0;
  group.add(mesh);
  group.userData.height = s.shape === 'platform' ? 0.4 : 2.0;
  group.userData.footprint = s.shape === 'platform' ? 4.6 : 1.6;
  return group;
}

function makeLabel(text, topY) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,14,21,0.82)';
  ctx.fillRect(6, 8, 500, 112);
  ctx.strokeStyle = 'rgba(110,231,255,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 8, 500, 112);
  ctx.font = 'bold 48px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#eaf2ff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 8), 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  spr.scale.set(1.95, 0.49, 1);
  spr.position.y = (topY || 2.4) + 0.5;
  return spr;
}

// ---------- 加载 ----------
async function loadGLB(url, type, onProgress) {
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) =>
    loader.load(url, res, (xhr) => {
      if (onProgress) onProgress(xhr.total ? xhr.loaded / xhr.total : 0);
    }, rej)
  );
  const g = gltf.scene;

  // 统一到目标尺寸（场景大、道具小）
  let box = new THREE.Box3().setFromObject(g);
  const size = new THREE.Vector3(); box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const target = TARGET_SIZE[type] || TARGET_SIZE.prop;
  g.scale.setScalar(target / maxDim);

  // 底部落到 y=0，并包一层 wrapper：外层只负责摆位置，内层 y 校正不被覆盖
  box = new THREE.Box3().setFromObject(g);
  g.position.y = -box.min.y;
  const wrapper = new THREE.Group();
  wrapper.add(g);
  box = new THREE.Box3().setFromObject(wrapper);
  const size2 = new THREE.Vector3(); box.getSize(size2);
  wrapper.userData.height = size2.y;
  wrapper.userData.footprint = Math.max(size2.x, size2.z);

  // 让暗底上也能看清颜色
  g.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (m.color) m.color.multiplyScalar(1.06);
        if ('envMapIntensity' in m) m.envMapIntensity = 0.95;
        if (m.roughness !== undefined && m.roughness > 0.92) m.roughness = 0.88;
        m.needsUpdate = true;
      });
    }
  });
  return wrapper;
}

// ---------- 布局：按各自真实尺寸累加成一排，轻微前后错位增强立体感 ----------
function layout(entities) {
  const widths = entities.map((e) => e.group?.userData?.footprint || 2.2);
  const gap = 0.55;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (entities.length - 1);
  let cursor = -total / 2;
  entities.forEach((e, i) => {
    const w = widths[i];
    // 交替错开一点 z，避免完全平铺的呆板感，但不影响视觉大小
    const z = i % 2 === 0 ? -0.35 : 0.35;
    e.pos = new THREE.Vector3(cursor + w / 2, 0, z);
    cursor += w + gap;
  });
}

// ---------- 自动取景：按布局已知量算，不依赖可能含离群几何的包围盒 ----------
function frameAll(instant = false) {
  if (!state.entities.length) return;
  const maxFoot = Math.max(2.0, ...state.entities.map((e) => e.group?.userData?.footprint || 2.0));
  const maxH = Math.max(2.0, ...state.entities.map((e) => e.group?.userData?.height || 2.0));
  const xs = state.entities.map((e) => e.pos?.x || 0);
  const zs = state.entities.map((e) => e.pos?.z || 0);
  const spanX = Math.max(...xs) - Math.min(...xs) + maxFoot;
  const spanZ = Math.max(...zs) - Math.min(...zs) + maxFoot;
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midZ = (Math.max(...zs) + Math.min(...zs)) / 2;

  const fov = (state.camera.fov * Math.PI) / 180;
  const tan = Math.tan(fov / 2);
  const needH = Math.max(maxH * 1.15, spanZ * 0.55);
  const needW = spanX * 1.06 / Math.max(0.6, state.camera.aspect);
  const dist = (Math.max(needH, needW) / 2 / tan) * 1.06 + maxFoot * 0.25;

  const camPos = new THREE.Vector3(midX, maxH * 0.5 + dist * 0.42, midZ + dist * 0.86);
  const tgt = new THREE.Vector3(midX, maxH * 0.48, midZ);

  if (instant) {
    state.camera.position.copy(camPos);
    state.controls.target.copy(tgt);
    state.controls.update();
  } else {
    state.focus = { cam: camPos, tgt };
  }
}

// ---------- 进度 ----------
function setProgress(p) {
  if (!progWrap) return;
  if (p === null) { progWrap.classList.add('hidden'); return; }
  progWrap.classList.remove('hidden');
  progBar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
}

// ---------- 生成流程 ----------
async function generate() {
  const parsed = parseStory(storyEl.value);
  if (parsed.length === 0) {
    statusEl.textContent = '未解析到 [[标签]]';
    log('没有找到 [[名称:类型:描述]] 标签，请按格式书写故事。', 'warn');
    return;
  }
  overlayEl.style.display = 'none';
  listEl.innerHTML = '';
  state.entities.forEach((e) => state.scene.remove(e.group));
  state.entities = [];

  const configured = isConfigured(state.cfg);
  const manifestOn = !!(state.manifest && state.manifest.assets);
  log(`解析到 ${parsed.length} 个实体；` +
      (manifestOn ? `预生成资产 ${Object.keys(state.manifest.assets).length} 个可用；`
                  : `未检测到预生成 manifest（将在本机运行 scripts/generate_assets.mjs 生成真实资产）；`) +
      (configured ? '实时模式已开启。' : '当前为占位模式。'));

  // 先建列表项，边加载边更新状态
  const rows = parsed.map((ent) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="tag-type">${ent.type}</span><span>${ent.name}</span><span class="tag-state pending">排队中…</span>`;
    listEl.appendChild(li);
    return { ent, li, span: li.querySelector('.tag-state') };
  });

  // 每个实体的下载进度（0-1），汇总成总进度
  const ratio = new Array(parsed.length).fill(0);
  const setRatio = (i, v) => {
    ratio[i] = v;
    setProgress(ratio.reduce((a, b) => a + b, 0) / parsed.length);
  };
  setProgress(0);

  // 并发加载（原来是串行，3×20MB 要走很久）
  const results = await Promise.all(parsed.map(async (ent, i) => {
    const { span } = rows[i];
    let group;
    try {
      const glbPath = manifestOn ? getModelForEntity(state.manifest, ent.name) : null;
      if (glbPath) {
        span.textContent = '载入中…';
        group = await loadGLB(glbPath, ent.type, (p) => {
          setRatio(i, p * 0.98);
          span.textContent = '载入 ' + Math.round(p * 100) + '%';
        });
        setRatio(i, 1);
        span.textContent = '✓ Lux3D';
        span.className = 'tag-state ok';
        log(`✓ ${ent.name} 载入预生成真实资产`, 'ok');
      } else if (configured) {
        span.textContent = '生成中…';
        const url = await generateTextToGlbUrl(ent.prompt, {
          key: state.cfg.key, base: state.cfg.base,
          onTick: (s) => { span.textContent = '生成中…(状态' + s + ')'; },
        });
        group = await loadGLB(url, ent.type, (p) => setRatio(i, p));
        setRatio(i, 1);
        span.textContent = '✓ Lux3D';
        span.className = 'tag-state ok';
        log(`✓ ${ent.name} 由 Lux3D 实时生成`, 'ok');
      } else {
        group = makePlaceholder(ent.type);
        setRatio(i, 1);
        span.textContent = '占位';
        log(`· ${ent.name} 使用占位模型（接入 Lux3D 后自动替换为真实资产）`);
      }
    } catch (err) {
      group = makePlaceholder(ent.type);
      setRatio(i, 1);
      span.textContent = '占位(失败)';
      log(`✗ ${ent.name} 生成失败，回退占位：${err.message}`, 'warn');
    }
    return { ent, group };
  }));

  setProgress(null);

  // 拿到真实尺寸后再排布，最后自动取景
  const items = results.map(({ ent, group }) => { ent.group = group; return ent; });
  layout(items);
  items.forEach((ent) => {
    const group = ent.group;
    group.position.copy(ent.pos);
    group.add(makeLabel(ent.name, group.userData.height || 2.4));
    group.userData.entity = ent;
    state.scene.add(group);
    state.entities.push(ent);
  });
  rows.forEach(({ ent, li }) => { li.onclick = () => focusOn(ent); });

  statusEl.textContent = `已生成 ${state.entities.length} 个实体`;
  log('场景生成完成，拖动旋转、滚轮缩放，点击左侧条目聚焦。', 'ok');
  frameAll(true);
}

// ---------- 聚焦 ----------
function focusOn(ent) {
  if (!ent.pos) return;
  const p = ent.pos;
  const h = ent.group?.userData?.height || 2.2;
  const d = Math.max(4.2, h * 1.9);
  state.focus = {
    cam: new THREE.Vector3(p.x + d * 0.45, h * 0.8 + d * 0.45, p.z + d),
    tgt: new THREE.Vector3(p.x, h * 0.5, p.z),
  };
  log(`聚焦：${ent.name}`);
}
function onPick(ev) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, state.camera);
  const hits = ray.intersectObjects(state.entities.map((e) => e.group), true);
  if (hits.length) {
    let o = hits[0].object;
    while (o && !o.userData.entity) o = o.parent;
    if (o && o.userData.entity) focusOn(o.userData.entity);
  }
}

// ---------- 动画循环 ----------
function animate() {
  requestAnimationFrame(animate);
  if (state.focus) {
    state.camera.position.lerp(state.focus.cam, 0.08);
    state.controls.target.lerp(state.focus.tgt, 0.08);
    if (state.camera.position.distanceTo(state.focus.cam) < 0.15) state.focus = null;
  }
  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}

// ---------- UI 绑定 ----------
$('btn-generate').addEventListener('click', generate);
$('story-picker').addEventListener('change', (e) => {
  storyEl.value = DEMO_STORIES[e.target.value] || DEMO_DEFAULT;
});
$('btn-reset').addEventListener('click', () => {
  state.focus = null;
  frameAll(false);
});

const modal = $('config-modal');
$('btn-config').addEventListener('click', () => {
  $('cfg-base').value = state.cfg.base || '';
  $('cfg-key').value = state.cfg.key || '';
  $('cfg-mode').value = state.cfg.mode || 'standard';
  modal.classList.remove('hidden');
});
$('cfg-cancel').addEventListener('click', () => modal.classList.add('hidden'));
$('cfg-save').addEventListener('click', () => {
  state.cfg = {
    base: $('cfg-base').value.trim() || 'https://api.aholo3d.cn',
    key: $('cfg-key').value.trim(),
    mode: $('cfg-mode').value,
  };
  saveCfg(state.cfg);
  modal.classList.add('hidden');
  log(isConfigured(state.cfg) ? '已保存 Lux3D 配置，将尝试实时生成。' : '已保存（未填写 Key，仍为占位/预生成模式）。', 'ok');
});

// ---------- 启动 ----------
storyEl.value = DEMO_DEFAULT;
initThree();
loadManifest().then((m) => {
  state.manifest = m;
  if (m && m.assets) log(`已加载预生成资产清单（${Object.keys(m.assets).length} 个）。`, 'ok');
  else log('未检测到预生成资产清单；运行本机脚本 scripts/generate_assets.mjs 可生成真实 Lux3D 资产。');
  // manifest 加载完成后自动生成默认故事，直接进入可交互 3D 场景
  generate();
});
log('就绪：选择示例故事或自写故事，点击「生成 3D 场景」。');

// 调试出口（只读：便于自动化截图脚本检查相机/布局状态）
window.__sl3d = state;
window.__THREE = THREE;
window.__frame = frameAll;
window.__generate = generate;
