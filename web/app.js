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

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const storyEl = $('story');
const listEl = $('entity-list');
const viewerEl = $('viewer');
const overlayEl = $('overlay');
const statusEl = $('status');
const logEl = $('log');

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
  scene.background = new THREE.Color(0x0b0e13);
  scene.fog = new THREE.Fog(0x0b0e13, 18, 60);

  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
  camera.position.set(0, 6, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  viewerEl.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1.5, 0);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202830, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(6, 12, 8);
  scene.add(dir);
  const fill = new THREE.PointLight(0x6ee7ff, 0.6, 40);
  fill.position.set(-8, 6, -4);
  scene.add(fill);

  const grid = new THREE.GridHelper(40, 40, 0x2a323d, 0x1a2029);
  scene.add(grid);

  state.scene = scene; state.camera = camera; state.renderer = renderer; state.controls = controls;

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPick);
  animate();
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
  return group;
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(12,16,22,0.8)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = '24px "PingFang SC", sans-serif';
  ctx.fillStyle = '#e6edf3';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 10), 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  spr.scale.set(2.2, 0.55, 1);
  spr.position.y = 2.6;
  return spr;
}

// ---------- 布局 ----------
function layout(entities) {
  const n = entities.length;
  const cols = Math.ceil(Math.sqrt(n));
  const spacing = 4;
  entities.forEach((e, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * spacing;
    const z = (row - (Math.ceil(n / cols) - 1) / 2) * spacing;
    e.pos = new THREE.Vector3(x, 0, z);
  });
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

  layout(parsed);
  const configured = isConfigured(state.cfg);
  const manifestOn = !!(state.manifest && state.manifest.assets);
  log(`解析到 ${parsed.length} 个实体；` +
      (manifestOn ? `预生成资产 ${Object.keys(state.manifest.assets).length} 个可用；`
                  : `未检测到预生成 manifest（将在本机运行 scripts/generate_assets.mjs 生成真实资产）；`) +
      (configured ? '实时模式已开启。' : '当前为占位模式。'));

  for (const ent of parsed) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="tag-type">${ent.type}</span><span>${ent.name}</span><span class="tag-state pending">生成中…</span>`;
    listEl.appendChild(li);
    const stateSpan = li.querySelector('.tag-state');

    let group;
    try {
      // 1) 优先：本机预生成的真实 GLB（manifest）
      const glbPath = manifestOn ? getModelForEntity(state.manifest, ent.name) : null;
      if (glbPath) {
        group = await loadGLB(glbPath);
        stateSpan.textContent = '✓ Lux3D';
        stateSpan.className = 'tag-state ok';
        log(`✓ ${ent.name} 载入预生成真实资产`, 'ok');
      }
      // 2) 其次：浏览器实时调用 Aholo（需配置 key 且 Aholo 允许跨域）
      else if (configured) {
        stateSpan.textContent = '生成中 0%';
        const url = await generateTextToGlbUrl(ent.prompt, {
          key: state.cfg.key, base: state.cfg.base,
          onTick: (s) => { stateSpan.textContent = '生成中…(状态' + s + ')'; },
        });
        group = await loadGLB(url);
        stateSpan.textContent = '✓ Lux3D';
        stateSpan.className = 'tag-state ok';
        log(`✓ ${ent.name} 由 Lux3D 实时生成`, 'ok');
      }
      // 3) 兜底：程序化占位模型，保证流程可演示
      else {
        group = makePlaceholder(ent.type);
        stateSpan.textContent = '占位';
        stateSpan.className = 'tag-state';
        log(`· ${ent.name} 使用占位模型（接入 Lux3D 后自动替换为真实资产）`);
      }
    } catch (err) {
      group = makePlaceholder(ent.type);
      stateSpan.textContent = '占位(失败)';
      stateSpan.className = 'tag-state';
      log(`✗ ${ent.name} 生成失败，回退占位：${err.message}`, 'warn');
    }

    group.position.copy(ent.pos);
    group.add(makeLabel(ent.name));
    group.userData.entity = ent;
    state.scene.add(group);
    ent.group = group;
    state.entities.push(ent);

    li.addEventListener('click', () => focusOn(ent));
  }

  statusEl.textContent = `已生成 ${state.entities.length} 个实体`;
  log('场景生成完成，拖动旋转、滚轮缩放，点击左侧条目聚焦。', 'ok');
}

async function loadGLB(url) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const g = gltf.scene;
  const box = new THREE.Box3().setFromObject(g);
  const size = new THREE.Vector3(); box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const k = 2.2 / maxDim;
  g.scale.setScalar(k);
  return g;
}

// ---------- 聚焦 ----------
function focusOn(ent) {
  const p = ent.pos;
  const camPos = new THREE.Vector3(p.x + 4, p.y + 4, p.z + 7);
  state.focus = { cam: camPos, tgt: new THREE.Vector3(p.x, 1.4, p.z) };
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
  state.camera.position.set(0, 6, 14);
  state.controls.target.set(0, 1.5, 0);
  state.focus = null;
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
