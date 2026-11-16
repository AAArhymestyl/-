/* 神降计划·塔 - 3D 地图引擎（Three.js · 粒子球体）
 * 最初版表现：金色粒子球体 + 大陆陆地 + 海岸线 + 地点标签。
 * 不含任何区域划分、区块网格、真实地图瓦片等后续实验代码。
 * 标签按相机距离分 L1–L4 四层淡入淡出；地点详情、委托绑定、管理员增删改、
 * 追踪飞行、自转与双击球外恢复自转等交互保持不变。 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
// 静态 import 必须写字面量：发布时与 app.js 的 ASSET_V、index.html 的 ?v= 同步递增
import { SEED_LOCATIONS, AREA_LABELS } from "./locations.js?v=62";

const MAP_STORE_KEY = "sdj_map_data_v2";

const escHtml = (s) => String(s == null ? "" : s)
  .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DEG2RAD = Math.PI / 180;
const LAND_RADIUS = 0.9830;
// 海岸线与陆地几乎同半径，避免贴近时丝带浮在陆地上方产生错位
const LINE_RADIUS = 0.9845;
// 标签与委托标记必须落在球面附近：此前放在 1.05 半径，近距离缩放时
// 0.07 的高度差会放大成严重视差，地标看起来「漂」到海里甚至球体外的黑暗区
const LABEL_RADIUS = 0.9832;
const MARKER_RADIUS = 0.9842;

// 已完成列表里的委托（成功 / 失败 / 截止）视为关闭态，地图上不再显示任何标记
const MISSION_CLOSED = new Set(["done", "failed", "expired"]);
const isMissionOpen = (m) => {
  if (!m || MISSION_CLOSED.has(m.status)) return false;
  // 已过截止时间但尚未被定时清扫的委托，同样按关闭处理
  const endsAt = m.deadline && m.deadline.endsAt;
  if (endsAt && endsAt < Date.now()) return false;
  return true;
};

/* 三块大陆：一块已探索（A / B 区所在地），两块未探索 */
const CONTINENT_SEEDS = [
  {
    id: "l1a", lat: 20.5, lon: -96.5, R: 18, sx: 0.82, sy: 1.12, explored: true,
    phase: [0.6, 2.2, 4.1, 1.3, 5.9, 3.4]
  },
  {
    id: "l1b", lat: -20, lon: 60, R: 16, sx: 0.95, sy: 1.02, explored: false,
    phase: [2.4, 0.9, 3.3, 5.2, 1.7, 4.4]
  },
  {
    id: "l1c", lat: 10, lon: 150, R: 16, sx: 0.95, sy: 1.02, explored: false,
    phase: [4.7, 1.8, 0.4, 2.9, 3.6, 0.9]
  }
];

// 与 getPos 同一套球面映射，供模块级几何构建复用
function latLonToVec3(lat, lon, radius, out) {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  const sinPhi = Math.sin(phi);
  const v = out || new THREE.Vector3();
  return v.set(
    -(radius * sinPhi * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta)
  );
}

/* 海岸线：以大陆中心为极点的半径函数，多组正弦叠加出半岛与海湾 */
function coastRadiusDeg(seed, theta) {
  const [a, b, c, d, e, f] = seed.phase;
  const k = 1
    + 0.16 * Math.sin(2 * theta + a)
    + 0.12 * Math.sin(3 * theta + b)
    + 0.09 * Math.sin(5 * theta + c)
    + 0.06 * Math.sin(9 * theta + d)
    + 0.04 * Math.sin(17 * theta + e)
    + 0.03 * Math.sin(29 * theta + f);
  // 最低不小于 0.66R，保证区内地点始终落在陆地上
  return seed.R * Math.max(0.66, k);
}

/* 大陆局部平面：x = 东向弧长（度），y = 纬度（度） */
function localToLatLon(seed, x, y) {
  const k = Math.cos(seed.lat * DEG2RAD);
  return { lat: seed.lat + y, lon: seed.lon + x / k };
}

function localToVec3(seed, x, y, radius, out) {
  const ll = localToLatLon(seed, x, y);
  return latLonToVec3(ll.lat, ll.lon, radius, out);
}

/* 海岸线闭合多边形（局部平面） */
function coastPolygon(seed, seg) {
  const n = seg || 240;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const r = coastRadiusDeg(seed, th);
    pts.push({ x: Math.sin(th) * r * seed.sx, y: Math.cos(th) * r * seed.sy });
  }
  return pts;
}

/* 把一串单位球面点做成带宽度的丝带（开放路径） */
function pushRibbon(path, halfWidth, pos, arc, side, idx) {
  const n = path.length;
  if (n < 2) return;

  const tangent = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const outer = new THREE.Vector3();
  const base = pos.length / 3;
  let acc = 0;

  for (let i = 0; i < n; i++) {
    const cur = path[i];
    const pv = path[Math.max(0, i - 1)];
    const nx = path[Math.min(n - 1, i + 1)];
    radial.copy(cur).normalize();
    tangent.copy(nx).sub(pv).normalize();
    outward.crossVectors(tangent, radial).normalize();
    inner.copy(cur).addScaledVector(outward, -halfWidth).normalize().multiplyScalar(LINE_RADIUS);
    outer.copy(cur).addScaledVector(outward, halfWidth).normalize().multiplyScalar(LINE_RADIUS);
    pos.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z);
    arc.push(acc, acc);
    side.push(-1, 1);
    if (i + 1 < n) acc += cur.distanceTo(nx);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    const b = base + (i + 1) * 2;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
}

/* 大陆陆地网格 + 海岸线 */
function buildContinentLand(seed) {
  const SEG = 240;
  const RINGS = 14;
  const coast = coastPolygon(seed, SEG);
  const pos = [];
  const idx = [];
  const p = new THREE.Vector3();

  localToVec3(seed, 0, 0, LAND_RADIUS, p);
  pos.push(p.x, p.y, p.z);

  for (let k = 1; k <= RINGS; k++) {
    const t = k / RINGS;
    for (let i = 0; i < SEG; i++) {
      localToVec3(seed, coast[i].x * t, coast[i].y * t, LAND_RADIUS, p);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < SEG; i++) {
    idx.push(0, 1 + i, 1 + ((i + 1) % SEG));
  }
  for (let k = 1; k < RINGS; k++) {
    const a0 = 1 + (k - 1) * SEG;
    const b0 = 1 + k * SEG;
    for (let i = 0; i < SEG; i++) {
      const i2 = (i + 1) % SEG;
      idx.push(a0 + i, b0 + i, b0 + i2);
      idx.push(a0 + i, b0 + i2, a0 + i2);
    }
  }

  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  fillGeo.setIndex(idx);

  // 海岸线：沿闭合海岸做一条细丝带
  const loop = coast.map((c) => localToVec3(seed, c.x, c.y, 1, new THREE.Vector3()));
  loop.push(loop[0]);
  const cPos = [], cArc = [], cSide = [], cIdx = [];
  pushRibbon(loop, 0.24 * DEG2RAD, cPos, cArc, cSide, cIdx);
  const coastGeo = new THREE.BufferGeometry();
  coastGeo.setAttribute("position", new THREE.Float32BufferAttribute(cPos, 3));
  coastGeo.setAttribute("aArc", new THREE.Float32BufferAttribute(cArc, 1));
  coastGeo.setAttribute("aSide", new THREE.Float32BufferAttribute(cSide, 1));
  coastGeo.setIndex(cIdx);

  return { fillGeo, coastGeo };
}

export class GlobeMapEngine {
  constructor(containerId, userRole) {
    this.container = document.getElementById(containerId);
    this.userRole = userRole;
    this.isAdmin = userRole === "admin";
    this.isAddMode = false;
    this.isAnimating = false;
    this._destroyed = false;
    this._onResize = null;
    this.ripples = [];
    this.missionAnchors = [];
    this.missionGroup = null;
    this._dockTimer = null;
    this._dockKey = "";

    this.scene = new THREE.Scene();
    // near 必须远小于「最近相机距离 - 球半径」，否则贴到球面时表面会被近裁剪面切掉
    this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.02, 60);
    this.camera.position.set(0, 0, 3.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.labelRenderer.domElement.style.position = "absolute";
    this.labelRenderer.domElement.style.top = "0px";
    this.labelRenderer.domElement.style.pointerEvents = "none";
    this.container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.05;
    this.controls.maxDistance = 8.0;
    this.controls.target.set(0, 0, 0);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.0;

    // ---- 触摸端手感：捏合缩放降灵敏度，交互时暂停自转 ----
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    this._isTouch = coarse || ("ontouchstart" in window);
    this.controls.rotateSpeed = this._isTouch ? 0.55 : 1.0;
    this.controls.zoomSpeed = this._isTouch ? 0.42 : 0.8;
    this.controls.autoRotateSpeed = this._isTouch ? 0.5 : 1.0;
    this.renderer.domElement.style.touchAction = "none";

    // 只要操作过球体就停转，只有双击球体外的空白才重新开启自转
    this._autoRotateResume = null;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      clearTimeout(this._autoRotateResume);
      this._autoRotateResume = null;
    });
    this.renderer.domElement.addEventListener("dblclick", (e) => {
      if (this._isOutsideGlobe(e)) this.controls.autoRotate = true;
    });

    this.labels = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    // 动画循环里复用的临时向量，避免每帧 new Vector3 造成 GC 抖动
    this._vLabel = new THREE.Vector3();
    this._vDir = new THREE.Vector3();
    this._lastTick = performance.now();

    this.init();
  }

  init() {
    this.buildTerrain();
    this.buildParticles();
    this.loadMapData();
    this.bindEvents();
    this.animate();
  }

  buildTerrain() {
    const geo = new THREE.SphereGeometry(0.98, 128, 128);
    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewNormal;
        void main() {
          vNormal = normal;
          vViewNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewNormal;
        void main() {
          // 海洋：偏深的蓝黑底色，和陆地形成明确反差
          float diff = max(dot(normalize(vNormal), normalize(vec3(0.6, 0.8, 0.45))), 0.0);
          vec3 color = vec3(0.0035, 0.010, 0.020) * (0.55 + 0.55 * diff);
          // 边缘光：和暗色页面背景拉开，保证球体轮廓始终可见
          float rim = pow(1.0 - clamp(abs(normalize(vViewNormal).z), 0.0, 1.0), 2.5);
          color += vec3(0.008, 0.026, 0.048) * rim;
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }
      `
    });
    this.terrainMesh = new THREE.Mesh(geo, mat);

    this.globeGroup = new THREE.Group();
    this.globeGroup.add(this.terrainMesh);
    this.globeGroup.rotation.x = Math.PI / 6;
    this.globeGroup.rotation.y = -Math.PI / 4;
    this.scene.add(this.globeGroup);

    this.buildContinents();
  }

  /* 海岸线材质：按最大宽度建好丝带，运行时用 uHalf 只显示中间一条 */
  makeLineMaterial(colorHex) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 1 },
        uHalf: { value: 1 },
        uColor: { value: new THREE.Color(colorHex) },
        uPeriod: { value: 0.020 }
      },
      vertexShader: `
        attribute float aArc;
        attribute float aSide;
        varying float vArc;
        varying float vSide;
        void main() {
          vArc = aArc;
          vSide = aSide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform float uHalf;
        uniform vec3 uColor;
        varying float vArc;
        varying float vSide;
        void main() {
          float band = abs(vSide);
          if (band > uHalf) discard;
          float core = 1.0 - smoothstep(uHalf * 0.35, uHalf, band);
          gl_FragColor = vec4(uColor, core * uOpacity);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }

  /* L1：大陆陆块 + 海岸线，三层大陆都画，未探索大陆同样有形状 */
  buildContinents() {
    this.continentGroup = new THREE.Group();
    this.globeGroup.add(this.continentGroup);
    this._coastMats = [];

    CONTINENT_SEEDS.forEach((seed) => {
      const { fillGeo, coastGeo } = buildContinentLand(seed);

      const fillMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0x3a4a40) } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normal;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vNormal;
          void main() {
            // 陆地和海洋共用同一套光照方向，球体才像一个整体
            float diff = max(dot(normalize(vNormal), normalize(vec3(0.6, 0.8, 0.45))), 0.0);
            gl_FragColor = vec4(uColor * (0.72 + 0.38 * diff), 1.0);
            #include <colorspace_fragment>
          }
        `,
        side: THREE.DoubleSide
      });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.renderOrder = 0;
      this.continentGroup.add(fill);

      const coastMat = this.makeLineMaterial(0x8a9b84);
      const coast = new THREE.Mesh(coastGeo, coastMat);
      coast.renderOrder = 2;
      this.continentGroup.add(coast);
      this._coastMats.push(coastMat);
    });
  }

  // 双击点不在球体上时才算「球体外空白」，避免双击大陆时误开自转
  _isOutsideGlobe(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.mouse, this.camera);
    return this.raycaster.intersectObject(this.terrainMesh, false).length === 0;
  }

  buildParticles() {
    const pGeo = new THREE.BufferGeometry();
    const pPos = [];
    for (let i = 0; i < 10000; i++) {
      const lat = Math.random() * 180 - 90;
      const lon = Math.random() * 360 - 180;
      const p = this.getPos(lat, lon, 1.02);
      pPos.push(p.x, p.y, p.z);
    }
    pGeo.setAttribute("position", new THREE.Float32BufferAttribute(pPos, 3));
    this.pMat = new THREE.PointsMaterial({ color: 0xc8a357, size: 0.0065, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
    this.particles = new THREE.Points(pGeo, this.pMat);
    this.globeGroup.add(this.particles);
  }

  getPos(lat, lon, radius = 1.0) {
    return latLonToVec3(lat, lon, radius);
  }

  getLatLon(vector) {
    const r = vector.length();
    const lat = 90 - (Math.acos(vector.y / r) * 180 / Math.PI);
    let lon = (Math.atan2(vector.z, -vector.x) * 180 / Math.PI) - 180;
    if (lon < -180) lon += 360;
    return { lat: lat.toFixed(2), lon: lon.toFixed(2) };
  }

  loadMapData() {
    this.labelGroup = new THREE.Group();
    this.globeGroup.add(this.labelGroup);

    let store = null;
    try { store = JSON.parse(localStorage.getItem(MAP_STORE_KEY)); } catch (e) { store = null; }
    // 丢弃历史实验版本（v3/v4）留下的地图缓存，按内置地点重建
    if (store && Number(store.v || 0) !== 2) store = null;

    const seeds = SEED_LOCATIONS.concat(AREA_LABELS);
    // 统一清洗：地点只保留地理字段，历史上的演示任务 task 一律剔除
    const cleanLoc = (it) => {
      const copy = Object.assign({}, it);
      delete copy.task;
      return copy;
    };
    if (store && Array.isArray(store.items)) {
      const removed = Array.isArray(store.removed) ? store.removed : [];
      this._removedIds = removed.slice();
      const savedIds = new Set(store.items.map(i => i.id));
      // 已保存的地点保留管理员改动；新增的种子地点自动补齐；被删除的种子不复活
      this.labelsData = store.items.map(cleanLoc);
      seeds.forEach(seed => {
        if (!savedIds.has(seed.id) && !removed.includes(seed.id)) this.labelsData.push(cleanLoc(seed));
      });
    } else {
      this.labelsData = seeds.map(cleanLoc);
      this._removedIds = [];
      this.saveMapData();
    }

    // 本地缓存里残留的 task 字段只清一次；管理员会顺带把干净数据推回云端
    if (store && Array.isArray(store.items) && store.items.some(i => i && i.task !== undefined)) {
      this.saveMapData();
    }

    this.labelsData.forEach(data => this.addLabel(data));

    document.getElementById("infoClose").onclick = () => {
      document.getElementById("infoPanel").classList.remove("show");
      const hint = document.getElementById("mapHint");
      if (hint) hint.classList.add("show");
    };

    this.buildMissionMarkers();
    this.setupDock();
  }

  saveMapData() {
    this._removedIds = this._removedIds || [];
    const payload = { v: 2, items: this.labelsData, removed: this._removedIds };
    try { localStorage.setItem(MAP_STORE_KEY, JSON.stringify(payload)); } catch (e) {}
    // 云端模式下同步到 world_state.map_locations（未配置 Supabase 时为空操作）
    if (window.SDJMap && typeof window.SDJMap.push === "function") {
      try { window.SDJMap.push(payload); } catch (e) {}
    }
  }

  // 新增或更新一个地点（管理员后台使用）
  upsertLocation(data) {
    const idx = this.labelsData.findIndex(i => i.id === data.id);
    if (idx >= 0) this.labelsData[idx] = Object.assign({}, this.labelsData[idx], data);
    else this.labelsData.push(data);
    this.saveMapData();
    this.rebuildLabels();
  }

  deleteLocation(id) {
    this.labelsData = this.labelsData.filter(i => i.id !== id);
    this._removedIds = (this._removedIds || []).concat([id]);
    this.saveMapData();
    this.rebuildLabels();
  }

  rebuildLabels() {
    this.labels.slice().forEach(label => this.labelGroup.remove(label));
    this.labels = [];
    this.labelsData.forEach(data => this.addLabel(data));
    if (this.missionGroup) this.buildMissionMarkers();
  }

  // 统一的地点标签创建入口（初始数据与管理员新增共用）
  addLabel(data) {
    const esc = escHtml;
    const div = document.createElement("div");
    div.className = `map-label label-l${data.level}`;
    div.innerHTML = `
      <div class="label-text">${esc(data.name)}${data.district ? `<span class="label-district">${esc(data.district)}</span>` : ""}</div>
      <div class="label-line"></div>
      <div class="label-dot"></div>
    `;
    div.dataset.id = data.id;

    const label = new CSS2DObject(div);
    label.position.copy(this.getPos(data.lat, data.lon, LABEL_RADIUS));
    label.userData = data;

    div.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onLabelClick(label);
    });

    this.labelGroup.add(label);
    this.labels.push(label);
    return label;
  }

  onLabelClick(label) {
    const data = label.userData;
    document.getElementById("infoTitle").textContent = data.name;
    document.getElementById("infoDesc").textContent = data.desc || "暂无地点描述。";
    const geo = document.getElementById("infoGeo");
    if (geo) {
      geo.textContent = `${data.district ? data.district + " · " : ""}L${data.level} · ${Number(data.lat).toFixed(2)}, ${Number(data.lon).toFixed(2)}`;
    }
    document.getElementById("infoPanel").classList.add("show");
    const hint = document.getElementById("mapHint");
    if (hint) hint.classList.remove("show");
    this._activeLoc = data;
    this.renderLocationMissions(data);

    // 旧的「一键接取」按钮不再使用：同一点位允许存在多个委托，统一在任务列表里逐条操作
    const acceptBtn = document.getElementById("btnAcceptTask");
    if (acceptBtn) { acceptBtn.hidden = true; acceptBtn.onclick = null; }

    document.getElementById("btnTrack").onclick = () => {
      this.flyToTarget(label);
    };
  }

  /* ---------- 地点 ↔ 真实委托列表（支持一个地点多条委托） ---------- */
  missionsAt(loc) {
    if (!loc) return [];
    const name = String(loc.name || "").trim();
    return this.getMissions().filter(m => {
      if (m.locationId) return m.locationId === loc.id;
      return String(m.loc || "").trim() === name;
    });
  }

  missionStatusText(m) {
    const left = m.deadline && m.deadline.endsAt ? m.deadline.endsAt - Date.now() : null;
    if (left !== null && left <= 0 && m.status !== "done") return "已截止";
    return ({
      available: "可接取", active: "进行中", review: "待审批",
      done: "已完成", failed: "已失败", expired: "已截止"
    })[m.status] || m.status || "未知";
  }

  missionRewardText(m) {
    const r = m && m.reward;
    if (!r) return "未设定";
    if (typeof r === "string") return r;
    if (r.type === "item") return (r.itemName || "道具") + (r.rarity ? "（" + r.rarity + "）" : "");
    return "计划点 ×" + (Number(r.points) || 0);
  }

  missionDeadlineText(m) {
    const dl = m && m.deadline;
    if (!dl || !dl.endsAt) return "长期有效";
    const d = new Date(dl.endsAt);
    if (!Number.isFinite(d.getTime())) return "长期有效";
    const p = n => String(n).padStart(2, "0");
    return `截止 ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  renderLocationMissions(loc) {
    const box = document.getElementById("infoTaskDesc");
    if (!box) return;
    this._activeLoc = loc;
    const isAdmin = this.userRole === "admin";
    const esc = escHtml;
    const palette = this.missionPalette();
    const sess = (window.SDJSession && typeof window.SDJSession.current === "function")
      ? window.SDJSession.current() : null;
    const me = sess ? (sess.username || sess.displayName) : "";

    // 关闭态委托（已完成 / 已失败 / 已截止）一律不在弹出面板里出现
    const list = this.missionsAt(loc).filter(isMissionOpen);
    const newBtn = isAdmin
      ? `<button class="map-mission-new" data-map-new>＋ 在此地点新增委托</button>` : "";

    if (!list.length) {
      box.innerHTML = `<div class="map-mission-empty">${isAdmin
        ? "该地点暂时没有委托，点下方按钮即可在这里发布。"
        : "等待管理者发布委托。"}</div>${newBtn}`;
      this.bindMissionActions(box);
      return;
    }

    box.innerHTML = `<div class="map-mission-list">${list.map(m => {
      const meta = palette[m.level] || { color: "#ddd", label: m.level };
      const acc = (m.acceptors || []).filter(a => a && a.username);
      const full = acc.length >= (m.slots || 1);
      const accepted = acc.some(a => a.username === me);
      const expired = m.deadline && m.deadline.endsAt && Date.now() > m.deadline.endsAt;
      let ops = "";
      if (isAdmin) {
        const locked = acc.length > 0;
        ops = `<button class="mm-btn ghost" data-map-view="${esc(m.id)}">查看</button>` +
          (locked ? "" : `<button class="mm-btn" data-map-edit="${esc(m.id)}">编辑</button>`);
      } else {
        if (accepted) ops = `<span class="mm-note">已接取</span>`;
        else if (m.status === "available" && !full && !expired) {
          ops = `<button class="mm-btn" data-map-accept="${esc(m.id)}">接取</button>`;
        } else if (full) ops = `<span class="mm-note">名额已满</span>`;
        else ops = `<span class="mm-note">${esc(this.missionStatusText(m))}</span>`;
      }
      return `<div class="map-mission status-${esc(m.status || "available")}">
        <div class="mm-head">
          <span class="mm-level" style="color:${meta.color};border-color:${meta.color}">${esc(m.level)}</span>
          <span class="mm-title">${esc(m.title)}</span>
          <span class="mm-state">${esc(this.missionStatusText(m))}</span>
        </div>
        <div class="mm-meta">奖励 ${esc(this.missionRewardText(m))} · 名额 ${acc.length}/${m.slots || 1} · ${esc(this.missionDeadlineText(m))}</div>
        <div class="mm-ops">${ops}</div>
      </div>`;
    }).join("")}</div>${newBtn}`;
    this.bindMissionActions(box);
  }

  bindMissionActions(box) {
    box.querySelectorAll("[data-map-accept]").forEach(btn => {
      btn.onclick = () => {
        if (window.SDJMapActions && typeof window.SDJMapActions.accept === "function") {
          window.SDJMapActions.accept(btn.dataset.mapAccept, btn);
        }
      };
    });
    box.querySelectorAll("[data-map-edit]").forEach(btn => {
      btn.onclick = () => {
        if (window.SDJMapActions && typeof window.SDJMapActions.edit === "function") {
          window.SDJMapActions.edit(btn.dataset.mapEdit);
        }
      };
    });
    box.querySelectorAll("[data-map-view]").forEach(btn => {
      btn.onclick = () => {
        if (window.SDJMapActions && typeof window.SDJMapActions.view === "function") {
          window.SDJMapActions.view(btn.dataset.mapView);
        }
      };
    });
    box.querySelectorAll("[data-map-new]").forEach(btn => {
      btn.onclick = () => {
        const loc = this._activeLoc;
        if (loc && window.SDJMapActions && typeof window.SDJMapActions.create === "function") {
          window.SDJMapActions.create(loc.id, loc.name);
        }
      };
    });
  }

  // 帖子自定义坐标：地图上没有对应地点时，临时显示一个标记并聚焦
  showTemporaryMarker(loc) {
    if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) return;
    const esc = escHtml;
    if (this._tempMarker) {
      this.labelGroup.remove(this._tempMarker);
      this._tempMarker = null;
    }
    const div = document.createElement("div");
    div.className = "map-label label-l3 temp-marker";
    div.innerHTML = `
      <div class="label-text">${esc(loc.name || "帖子标记")}<span class="label-district">帖子位置</span></div>
      <div class="label-line"></div>
      <div class="label-dot"></div>`;
    const label = new CSS2DObject(div);
    label.position.copy(this.getPos(Number(loc.lat), Number(loc.lon), LABEL_RADIUS));
    label.userData = Object.assign({ level: 3, desc: "来自论坛帖子的位置标记。" }, loc);
    div.addEventListener("click", (e) => { e.stopPropagation(); this.onLabelClick(label); });
    this.labelGroup.add(label);
    this._tempMarker = label;
    this.onLabelClick(label);
    this.flyToTarget(label);
  }

  // 使用 getWorldPosition 确保追踪目标准确（世界坐标含球体自转与倾斜）
  flyToTarget(label) {
    if (this.isAnimating) return;
    this.controls.autoRotate = false;

    const worldPos = label.getWorldPosition(new THREE.Vector3());
    const dir = worldPos.clone().normalize();

    this.animStartPos = this.camera.position.clone();

    const level = label.userData.level;
    const targetDist = level === 1 ? 2.2 : (level === 2 ? 1.4 : (level === 3 ? 1.15 : 1.1));

    this.animEndPos = dir.multiplyScalar(targetDist);
    this.animStartTime = performance.now();
    this.isAnimating = true;
    this.currentAnimTarget = label;
    this.controls.enabled = false;
  }

  updateCameraAnimation() {
    if (!this.isAnimating) return;
    const now = performance.now();
    let progress = (now - this.animStartTime) / 1000;
    if (progress > 1) progress = 1;
    const ease = 1 - Math.pow(1 - progress, 3);

    this.camera.position.lerpVectors(this.animStartPos, this.animEndPos, ease);
    this.camera.lookAt(0, 0, 0);

    if (progress === 1) {
      this.isAnimating = false;
      this.currentAnimTarget = null;
      this.controls.enabled = true;
    }
  }

  bindEvents() {
    this.controls.addEventListener("start", () => {
      if (this.isAnimating) {
        this.isAnimating = false;
        this.controls.enabled = true;
      }
      this.controls.autoRotate = false;
    });

    let addBtn = null;
    if (this.isAdmin) {
      const toolbar = document.getElementById("adminToolbar");
      if (toolbar) toolbar.style.display = "flex";
      addBtn = document.getElementById("btnAddMode");

      const setIdle = () => {
        this.isAddMode = false;
        if (addBtn) {
          addBtn.classList.remove("active");
          addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> 添加地点（点击球体）`;
        }
        const hint = document.getElementById("mapHint");
        if (hint) hint.textContent = "点击图钉查看详情 · 滚轮缩放 · 拖拽旋转";
      };
      this._resetAddMode = setIdle;

      // 页面结构缺失时不能直接 TypeError 打断整张地图
      if (!addBtn) console.warn("[地图] 缺少 #btnAddMode，管理员工具条未启用");
      if (addBtn) addBtn.onclick = () => {
        this.isAddMode = !this.isAddMode;
        if (this.isAddMode) {
          addBtn.classList.add("active");
          addBtn.innerHTML = "点击球体选择位置…";
          const hint = document.getElementById("mapHint");
          if (hint) {
            hint.textContent = "管理员模式：在地形上点击以创建新地点";
            hint.classList.add("show");
          }
        } else {
          setIdle();
        }
      };
    }

    this.renderer.domElement.addEventListener("click", (e) => {
      if (!this.isAddMode) return;

      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.terrainMesh);

      if (intersects.length > 0) {
        const point = intersects[0].point;
        const worldPoint = this.globeGroup.worldToLocal(point.clone());
        const latLon = this.getLatLon(worldPoint);
        const lat = parseFloat(latLon.lat);
        const lon = parseFloat(latLon.lon);

        // 交给管理面板去填表，引擎只负责提供坐标
        if (this._resetAddMode) this._resetAddMode();
        document.dispatchEvent(new CustomEvent("sdj:map-pick", { detail: { lat, lon } }));
      }
    });

    this._onResize = () => {
      if (this._destroyed || !this.container) return;
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.labelRenderer.setSize(w, h);
    };
    window.addEventListener("resize", this._onResize);
  }

  /* =========================================================
   *  委托与地图绑定：等级配色、A 级波纹、右侧委托侧边栏
   * ========================================================= */
  missionPalette() {
    return (window.SDJ_CONFIG && window.SDJ_CONFIG.missionLevels) || {};
  }

  getMissions() {
    if (window.SDJStore && typeof window.SDJStore.getMissions === "function") {
      try { return window.SDJStore.getMissions() || []; } catch (e) { return []; }
    }
    return [];
  }

  resolveMissionLocation(mission, items) {
    const list = items || this.labelsData || [];
    const key = String(mission.loc || "").trim();
    let loc = null;
    if (mission.locationId) loc = list.find(i => i.id === mission.locationId) || null;
    if (!loc && key) {
      loc = list.find(i => i.name === key)
        || list.find(i => i.name.startsWith(key) && key.length >= 2)
        || list.find(i => (i.district || "") === key)
        || null;
    }
    return loc;
  }

  buildMissionMarkers() {
    if (this.missionGroup) {
      this.globeGroup.remove(this.missionGroup);
      this.missionGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.missionGroup = null;
    }
    this.ripples = [];
    this.missionAnchors = [];

    const palette = this.missionPalette();
    // 只画仍在进行中的委托；已完成 / 已失败 / 已截止的不留任何光圈
    const missions = this.getMissions().filter(isMissionOpen);
    const group = new THREE.Group();

    missions.forEach(mission => {
      const loc = this.resolveMissionLocation(mission);
      if (!loc) return;
      const meta = palette[mission.level] || { color: "#ffffff" };
      const pos = this.getPos(Number(loc.lat), Number(loc.lon), MARKER_RADIUS);

      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.017, 20),
        new THREE.MeshBasicMaterial({
          color: meta.color, transparent: true, opacity: 0.55,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
        })
      );
      dot.position.copy(pos);
      dot.lookAt(0, 0, 0);
      group.add(dot);

      if (meta.ripple) {
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.021, 0.026, 44),
            new THREE.MeshBasicMaterial({
              color: meta.color, transparent: true, opacity: 0,
              side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
            })
          );
          ring.position.copy(pos);
          ring.lookAt(0, 0, 0);
          group.add(ring);
          this.ripples.push({ mesh: ring, phase: i / 3 });
        }
      }

      this.missionAnchors.push({
        id: mission.id, title: mission.title, level: mission.level,
        status: mission.status, loc, pos
      });
    });

    this.globeGroup.add(group);
    this.missionGroup = group;
    this.renderDock(true);
  }

  setupDock() {
    this.dockEl = document.getElementById("missionDock");
    this.dockListEl = document.getElementById("dockList");
    this.dockCountEl = document.getElementById("dockCount");
    const toggle = document.getElementById("dockToggle");
    if (!this.dockEl) return;
    if (toggle) toggle.onclick = (e) => {
      e.stopPropagation();
      this.dockEl.classList.toggle("open");
      this.renderDock(true);
    };

    const legend = document.getElementById("dockLegend");
    if (legend) {
      const palette = this.missionPalette();
      legend.innerHTML = ["A", "B", "C", "D"].map(k => {
        const meta = palette[k];
        if (!meta) return "";
        return `<span class="legend-item"><i style="background:${meta.color}"></i>${meta.label || k + " 级"}</span>`;
      }).join("");
    }

    this._onControlsChange = () => {
      clearTimeout(this._dockTimer);
      this._dockTimer = setTimeout(() => this.renderDock(), 180);
    };
    this.controls.addEventListener("change", this._onControlsChange);
    this.renderDock(true);
  }

  // 计算当前视野内、朝向相机的委托（球体背面与屏幕外的排除）
  visibleMissionAnchors() {
    if (!this.missionAnchors.length) return [];
    this.globeGroup.updateMatrixWorld();
    const camPos = this.camera.position;
    const v = new THREE.Vector3();
    return this.missionAnchors.filter(a => {
      v.copy(a.pos).applyMatrix4(this.globeGroup.matrixWorld);
      const normal = v.clone().normalize();
      const toCam = camPos.clone().sub(v).normalize();
      if (normal.dot(toCam) <= 0.05) return false;
      v.project(this.camera);
      return v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
    });
  }

  renderDock(force) {
    if (!this.dockListEl) return;
    const palette = this.missionPalette();
    const visible = this.visibleMissionAnchors();
    const all = this.getMissions().filter(isMissionOpen);
    const unresolved = all.filter(m => !this.resolveMissionLocation(m));

    const key = visible.map(a => a.id).sort().join("|") + "#" + unresolved.length;
    if (!force && key === this._dockKey) return;
    this._dockKey = key;

    if (this.dockCountEl) {
      this.dockCountEl.textContent = `${visible.length} 项视野内${unresolved.length ? ` · ${unresolved.length} 项未定位` : ""}`;
    }

    const order = ["A", "B", "C", "D"];
    const groups = order
      .map(level => ({ level, items: visible.filter(a => a.level === level) }))
      .filter(g => g.items.length);

    if (!groups.length) {
      this.dockListEl.innerHTML = `<div class="dock-empty">当前视野内暂无委托<br><span>旋转或缩放地图以查看其他区域</span></div>`;
    } else {
      this.dockListEl.innerHTML = groups.map(g => {
        const meta = palette[g.level] || { color: "#fff", label: g.level };
        return `
          <div class="dock-group">
            <div class="dock-group-title"><i style="background:${meta.color}"></i>${meta.label || g.level + " 级"}<span>${g.items.length}</span></div>
            ${g.items.map(a => `
              <div class="dock-item" data-mid="${escHtml(a.id)}">
                <span class="dock-dot" style="background:${meta.color}"></span>
                <span class="dock-name">${escHtml(a.title)}</span>
                <span class="dock-loc">${escHtml(a.loc.name)}</span>
              </div>`).join("")}
          </div>`;
      }).join("");
    }

    if (unresolved.length) {
      this.dockListEl.innerHTML += `
        <div class="dock-group">
          <div class="dock-group-title warn"><i></i>地点未匹配<span>${unresolved.length}</span></div>
          ${unresolved.map(m => `<div class="dock-item unresolved"><span class="dock-dot"></span><span class="dock-name">${escHtml(m.title)}</span><span class="dock-loc">${escHtml(m.loc || "未填写")}</span></div>`).join("")}
        </div>`;
    }

    this.dockListEl.querySelectorAll(".dock-item[data-mid]").forEach(row => {
      row.onclick = () => {
        const anchor = this.missionAnchors.find(a => a.id === row.dataset.mid);
        if (!anchor) return;
        const label = this.labels.find(l => l.userData.id === anchor.loc.id);
        if (label) {
          this.onLabelClick(label);
          this.flyToTarget(label);
        }
      };
    });
  }

  refreshMissions() {
    this.buildMissionMarkers();
    if (this._activeLoc) {
      const still = (this.labelsData || []).find(i => i.id === this._activeLoc.id);
      if (still) this.renderLocationMissions(still);
    }
  }

  animate() {
    if (!this.renderer || this._destroyed) return;
    this.animationId = requestAnimationFrame(() => this.animate());

    if (this.controls.autoRotate) {
      this.globeGroup.rotation.y += 0.001;
    }

    this.updateCameraAnimation();
    const dist = this.camera.position.length();

    // A 级委托：一圈圈向外扩散的警戒波纹
    if (this.ripples.length) {
      const clock = performance.now() * 0.001;
      // 贴近球体时同步收小波纹：屏幕尺寸 ∝ 世界尺寸 / (视距 - 球半径)，
      // 按 (dist - 0.98) 等比例缩小才能保持固定的视觉大小，
      // 否则单个光圈会铺满整屏、像一块异常的色斑
      const shrink = Math.min(1, Math.max(0.03, (dist - 0.98) / 1.22));
      this.ripples.forEach(r => {
        const k = (clock * 0.55 + r.phase) % 1;
        r.mesh.scale.setScalar((1 + k * 6) * shrink);
        r.mesh.material.opacity = 0.6 * (1 - k);
      });
    }

    let t = (dist - 1.5) / (3.0 - 1.5);
    t = Math.max(0.0, Math.min(1.0, t));
    // 粒子保持最初的表现：远景最亮、贴近球体时淡出
    this.pMat.opacity = t;

    const now = performance.now();
    const dt = Math.min(0.05, (now - this._lastTick) / 1000);
    this._lastTick = now;
    if (this._coastMats) {
      // 海岸线按当前视野换算成固定像素宽，避免贴近时变成一条宽色带；
      // 放到 L3 / L4 视野时淡出，陆地轮廓已足够清晰，细丝带的折线接缝反而碍眼
      const pxPerDeg = this._pixelsPerDegree(dist);
      const halfDeg = 1.6 / Math.max(1, pxPerDeg);
      const half = Math.min(1, Math.max(0.02, halfDeg / 0.24));
      const coastOp = dist >= 1.95 ? 1 : (dist <= 1.70 ? 0 : (dist - 1.70) / 0.25);
      this._coastMats.forEach((m) => {
        m.uniforms.uOpacity.value = coastOp;
        m.uniforms.uHalf.value = half;
      });
    }

    this.labels.forEach(label => {
      const level = label.userData.level;
      let targetOpacity = 0;
      let scale = 1.0;

      if (level === 1) {
        if (dist > 2.45) targetOpacity = 1.0;
        else if (dist > 2.25) targetOpacity = (dist - 2.25) / 0.2;
      } else if (level === 2) {
        if (dist > 2.45) targetOpacity = 0;
        else if (dist > 2.25) targetOpacity = (2.45 - dist) / 0.2;
        else if (dist > 1.70) targetOpacity = 1.0;
        else if (dist > 1.50) targetOpacity = (dist - 1.50) / 0.2;
      } else if (level === 3) {
        if (dist > 1.70) targetOpacity = 0;
        else if (dist > 1.50) targetOpacity = (1.70 - dist) / 0.2;
        else if (dist > 1.15) targetOpacity = 1.0;
        else if (dist > 1.05) targetOpacity = (dist - 1.05) / 0.1;
        scale = 0.9;
      } else if (level === 4) {
        if (dist <= 1.15) targetOpacity = 1.0;
        else if (dist < 1.25) targetOpacity = (1.25 - dist) / 0.1;
        scale = 0.8;
      }

      const labelWorldPos = label.getWorldPosition(this._vLabel);
      // 地平线遮挡：只有朝向相机的那半球可见。
      // 之前用视线夹角判断，靠近球体边缘的标签仍会浮在球外的黑暗区。
      const camLen = this.camera.position.length();
      this._vDir.copy(labelWorldPos).normalize();
      const cosAngle = this._vDir.dot(this.camera.position) / Math.max(1e-6, camLen);
      const horizon = LABEL_RADIUS / Math.max(1e-6, camLen);
      targetOpacity *= Math.max(0, Math.min(1, (cosAngle - horizon) / 0.035));

      // 初始 style.opacity 为空，parseFloat 会得到 NaN，必须兜底为 0
      const currentOpacity = parseFloat(label.element.style.opacity) || 0;
      const newOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.15;

      label.element.style.opacity = newOpacity;

      if (newOpacity < 0.05) {
        label.element.style.pointerEvents = "none";
        label.element.style.zIndex = -1;
      } else {
        label.element.style.pointerEvents = "auto";
        label.element.style.zIndex = Math.floor(1000 + (level * 100) - (dist * 100));
      }

      const finalScale = scale * (0.8 + newOpacity * 0.2);
      label.element.style.transform = `translate(-50%, -100%) scale(${finalScale})`;
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  // 当前视野下每度对应多少屏幕像素（用于把海岸线宽钉在固定像素）
  _pixelsPerDegree(dist) {
    const h = this.container ? this.container.clientHeight : 600;
    const radius = 0.98;
    const k = Math.tan((this.camera.fov * Math.PI / 180) / 2);
    let lo = 0, hi = Math.PI / 2;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (k * (dist - radius * Math.cos(mid)) - radius * Math.sin(mid) > 0) lo = mid;
      else hi = mid;
    }
    const capDeg = Math.max(0.05, ((lo + hi) / 2) * 180 / Math.PI);
    return (h / 2) / capDeg;
  }

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this.animationId);
    clearTimeout(this._dockTimer);
    if (this._onControlsChange) {
      this.controls.removeEventListener("change", this._onControlsChange);
      this._onControlsChange = null;
    }
    if (this.missionGroup) {
      this.missionGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.missionGroup = null;
    }
    if (this._tempMarker) {
      if (this._tempMarker.element && this._tempMarker.element.parentNode) {
        this._tempMarker.element.parentNode.removeChild(this._tempMarker.element);
      }
      this.labelGroup.remove(this._tempMarker);
      this._tempMarker = null;
    }
    this.ripples = [];
    this.missionAnchors = [];
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      this._onResize = null;
    }
    // 离开地图时清掉自转恢复计时器，避免定时器持有已销毁的 controls
    if (this._autoRotateResume) {
      clearTimeout(this._autoRotateResume);
      this._autoRotateResume = null;
    }
    this.controls.dispose();
    this.renderer.dispose();
    this.labelRenderer.domElement.remove();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      this.terrainMesh.material.dispose();
      this.terrainMesh = null;
    }
    if (this.continentGroup) {
      this.continentGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.continentGroup = null;
    }
    this._coastMats = [];
    if (this.particles) {
      this.particles.geometry.dispose();
      this.pMat.dispose();
      this.particles = null;
    }
    this.labels = [];
    this.labelsData = [];
    this.scene.clear();
    this.container = null;
  }
}
