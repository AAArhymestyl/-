/* 神降计划·塔 - 3D 地图引擎（Three.js） */
import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
  import { SEED_LOCATIONS, AREA_LABELS } from './locations.js?v=3';

  const MAP_STORE_KEY = 'sdj_map_data_v2';

  export class GlobeMapEngine {
    constructor(containerId, userRole) {
      this.container = document.getElementById(containerId);
      this.userRole = userRole;
      this.isAdmin = userRole === 'admin';
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
      this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
      this.camera.position.set(0, 0, 3.5);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.container.appendChild(this.renderer.domElement);

      this.labelRenderer = new CSS2DRenderer();
      this.labelRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
      this.labelRenderer.domElement.style.position = 'absolute';
      this.labelRenderer.domElement.style.top = '0px';
      this.labelRenderer.domElement.style.pointerEvents = 'none'; 
      this.container.appendChild(this.labelRenderer.domElement);

      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.enablePan = false;
      this.controls.minDistance = 1.1; 
      this.controls.maxDistance = 8.0;
      this.controls.target.set(0, 0, 0);
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 1.0;

      this.labels = [];
      this.raycaster = new THREE.Raycaster();
      this.mouse = new THREE.Vector2();
      
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
      const glslNoise = `
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        float snoise(vec3 v) {
          const vec2 C = vec2(1.0/6.0, 1.0/3.0);
          const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
          vec3 i  = floor(v + dot(v, C.yyy));
          vec3 x0 = v - i + dot(i, C.xxx);
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min(g.xyz, l.zxy);
          vec3 i2 = max(g.xyz, l.zxy);
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          i = mod289(i);
          vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
          float n_ = 0.142857142857;
          vec3 ns = n_ * D.wyz - D.xzx;
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_);
          vec4 x = x_ * ns.x + ns.yyyy;
          vec4 y = y_ * ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          vec4 b0 = vec4(x.xy, y.xy);
          vec4 b1 = vec4(x.zw, y.zw);
          vec4 s0 = floor(b0)*2.0 + 1.0;
          vec4 s1 = floor(b1)*2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
          vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
          vec3 p0 = vec3(a0.xy, h.x);
          vec3 p1 = vec3(a0.zw, h.y);
          vec3 p2 = vec3(a1.xy, h.z);
          vec3 p3 = vec3(a1.zw, h.w);
          vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
          p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
          vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
          m = m * m;
          return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }
      `;

      const geo = new THREE.SphereGeometry(0.98, 256, 256);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uDarkness: { value: 0.0 }, uDisplacementScale: { value: 0.05 } },
        vertexShader: `
          uniform float uDisplacementScale;
          varying float vElevation; varying vec3 vNormal;
          ${glslNoise}
          void main() {
            vNormal = normal;
            vec3 noisePos = position * 1.8;
            float elevation = snoise(noisePos) + 0.5 * snoise(noisePos * 2.0) + 0.25 * snoise(noisePos * 4.0);
            elevation = (elevation + 1.0) / 2.0;
            float displacement = 0.0;
            if (elevation > 0.55) displacement = ((elevation - 0.55) / 0.45) * uDisplacementScale;
            vElevation = elevation;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * displacement, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uDarkness;
          varying float vElevation; varying vec3 vNormal;
          void main() {
            vec3 cOcean = vec3(0.01, 0.02, 0.04);
            vec3 cLand = vec3(0.15, 0.02, 0.02);
            vec3 cPeak = vec3(0.8, 0.1, 0.1);
            vec3 color;
            if (vElevation < 0.55) color = mix(cOcean, vec3(0.02, 0.08, 0.12), vElevation / 0.55);
            else color = mix(cLand, cPeak, (vElevation - 0.55) / 0.45);
            float diff = max(dot(normalize(vNormal), normalize(vec3(1.0, 1.0, 1.0))), 0.0);
            color *= (0.4 + 0.6 * diff);
            float contour = fract(vElevation * 30.0);
            if (contour < 0.05 && vElevation > 0.55) color = vec3(0.8, 0.1, 0.1); 
            if (abs(vElevation - 0.55) < 0.01) color = vec3(0.0, 0.8, 1.0); 
            color *= (1.0 - uDarkness);
            gl_FragColor = vec4(color, 1.0);
          }
        `
      });
      this.terrainMesh = new THREE.Mesh(geo, mat);
      
      this.globeGroup = new THREE.Group();
      this.globeGroup.add(this.terrainMesh);
      this.globeGroup.rotation.x = Math.PI / 6;
      this.globeGroup.rotation.y = -Math.PI / 4;
      this.scene.add(this.globeGroup);
    }

    buildParticles() {
      const pGeo = new THREE.BufferGeometry();
      const pPos = [];
      for(let i=0; i<10000; i++) {
        const lat = Math.random()*180-90;
        const lon = Math.random()*360-180;
        const p = this.getPos(lat, lon, 1.02);
        pPos.push(p.x, p.y, p.z);
      }
      pGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
      this.pMat = new THREE.PointsMaterial({ color: 0xff4444, size: 0.008, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
      this.particles = new THREE.Points(pGeo, this.pMat);
      this.globeGroup.add(this.particles);
    }

    getPos(lat, lon, radius = 1.0) {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (lon + 180) * (Math.PI / 180);
      return new THREE.Vector3(
        -(radius * Math.sin(phi) * Math.cos(theta)),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      );
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

      const seeds = SEED_LOCATIONS.concat(AREA_LABELS);
      // 统一清洗：地点只保留地理字段，历史上的演示任务 task 一律剔除
      const cleanLoc = (it) => {
        const copy = Object.assign({}, it);
        delete copy.task;
        return copy;
      };
      if (store && Array.isArray(store.items)) {
        const removed = Array.isArray(store.removed) ? store.removed : [];
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
      
      document.getElementById('infoClose').onclick = () => {
        document.getElementById('infoPanel').classList.remove('show');
      };

      this.buildMissionMarkers();
      this.setupDock();
    }

    saveMapData() {
      const payload = { v: 2, items: this.labelsData, removed: this._removedIds || [] };
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
      const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const div = document.createElement('div');
      div.className = `map-label label-l${data.level}`;
      div.innerHTML = `
        <div class="label-text">${esc(data.name)}${data.district ? `<span class="label-district">${esc(data.district)}</span>` : ''}</div>
        <div class="label-line"></div>
        <div class="label-dot"></div>
      `;
      div.dataset.id = data.id;

      const label = new CSS2DObject(div);
      label.position.copy(this.getPos(data.lat, data.lon, 1.05));
      label.userData = data;

      div.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onLabelClick(label);
      });

      this.labelGroup.add(label);
      this.labels.push(label);
      return label;
    }

    onLabelClick(label) {
      const data = label.userData;
      document.getElementById('infoTitle').textContent = data.name;
      document.getElementById('infoDesc').textContent = data.desc || '暂无地点描述。';
      const geo = document.getElementById('infoGeo');
      if (geo) {
        geo.textContent = `${data.district ? data.district + ' · ' : ''}L${data.level} · ${Number(data.lat).toFixed(2)}, ${Number(data.lon).toFixed(2)}`;
      }
      document.getElementById('infoPanel').classList.add('show');
      this._activeLoc = data;
      this.renderLocationMissions(data);

      // 旧的「一键接取」按钮不再使用：同一点位允许存在多个委托，统一在任务列表里逐条操作
      const acceptBtn = document.getElementById('btnAcceptTask');
      if (acceptBtn) { acceptBtn.hidden = true; acceptBtn.onclick = null; }

      document.getElementById('btnTrack').onclick = () => {
        this.flyToTarget(label);
      };
    }

    /* ---------- 地点 ↔ 真实委托列表（支持一个地点多条委托） ---------- */
    missionsAt(loc) {
      if (!loc) return [];
      const name = String(loc.name || '').trim();
      return this.getMissions().filter(m => {
        if (m.locationId) return m.locationId === loc.id;
        return String(m.loc || '').trim() === name;
      });
    }

    missionStatusText(m) {
      const left = m.deadline && m.deadline.endsAt ? m.deadline.endsAt - Date.now() : null;
      if (left !== null && left <= 0 && m.status !== 'done') return '已截止';
      return ({
        available: '可接取', active: '进行中', review: '待审批',
        done: '已完成', failed: '已失败', expired: '已截止'
      })[m.status] || m.status || '未知';
    }

    missionRewardText(m) {
      const r = m && m.reward;
      if (!r) return '未设定';
      if (typeof r === 'string') return r;
      if (r.type === 'item') return (r.itemName || '道具') + (r.rarity ? '（' + r.rarity + '）' : '');
      return '计划点 ×' + (Number(r.points) || 0);
    }

    missionDeadlineText(m) {
      const dl = m && m.deadline;
      if (!dl || !dl.endsAt) return '长期有效';
      const d = new Date(dl.endsAt);
      const p = n => String(n).padStart(2, '0');
      return `截止 ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    renderLocationMissions(loc) {
      const box = document.getElementById('infoTaskDesc');
      if (!box) return;
      this._activeLoc = loc;
      const isAdmin = this.userRole === 'admin';
      const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const palette = this.missionPalette();
      const sess = (window.SDJSession && typeof window.SDJSession.current === 'function')
        ? window.SDJSession.current() : null;
      const me = sess ? (sess.username || sess.displayName) : '';

      const list = this.missionsAt(loc);
      const newBtn = isAdmin
        ? `<button class="map-mission-new" data-map-new>＋ 在此地点新增委托</button>` : '';

      if (!list.length) {
        box.innerHTML = `<div class="map-mission-empty">${isAdmin
          ? '该地点暂时没有委托，点下方按钮即可在这里发布。'
          : '等待管理者发布委托。'}</div>${newBtn}`;
        this.bindMissionActions(box);
        return;
      }

      box.innerHTML = `<div class="map-mission-list">${list.map(m => {
        const meta = palette[m.level] || { color: '#ddd', label: m.level };
        const acc = (m.acceptors || []).filter(a => a && a.username);
        const full = acc.length >= (m.slots || 1);
        const accepted = acc.some(a => a.username === me);
        const expired = m.deadline && m.deadline.endsAt && Date.now() > m.deadline.endsAt;
        let ops = '';
        if (isAdmin) {
          const locked = acc.length > 0;
          ops = `<button class="mm-btn ghost" data-map-view="${esc(m.id)}">查看</button>` +
            (locked ? '' : `<button class="mm-btn" data-map-edit="${esc(m.id)}">编辑</button>`);
        } else {
          if (accepted) ops = `<span class="mm-note">已接取</span>`;
          else if (m.status === 'available' && !full && !expired) {
            ops = `<button class="mm-btn" data-map-accept="${esc(m.id)}">接取</button>`;
          } else if (full) ops = `<span class="mm-note">名额已满</span>`;
          else ops = `<span class="mm-note">${esc(this.missionStatusText(m))}</span>`;
        }
        return `<div class="map-mission status-${esc(m.status || 'available')}">
          <div class="mm-head">
            <span class="mm-level" style="color:${meta.color};border-color:${meta.color}">${esc(m.level)}</span>
            <span class="mm-title">${esc(m.title)}</span>
            <span class="mm-state">${esc(this.missionStatusText(m))}</span>
          </div>
          <div class="mm-meta">奖励 ${esc(this.missionRewardText(m))} · 名额 ${acc.length}/${m.slots || 1} · ${esc(this.missionDeadlineText(m))}</div>
          <div class="mm-ops">${ops}</div>
        </div>`;
      }).join('')}</div>${newBtn}`;
      this.bindMissionActions(box);
    }

    bindMissionActions(box) {
      box.querySelectorAll('[data-map-accept]').forEach(btn => {
        btn.onclick = () => {
          if (window.SDJMapActions && typeof window.SDJMapActions.accept === 'function') {
            window.SDJMapActions.accept(btn.dataset.mapAccept, btn);
          }
        };
      });
      box.querySelectorAll('[data-map-edit]').forEach(btn => {
        btn.onclick = () => {
          if (window.SDJMapActions && typeof window.SDJMapActions.edit === 'function') {
            window.SDJMapActions.edit(btn.dataset.mapEdit);
          }
        };
      });
      box.querySelectorAll('[data-map-view]').forEach(btn => {
        btn.onclick = () => {
          if (window.SDJMapActions && typeof window.SDJMapActions.view === 'function') {
            window.SDJMapActions.view(btn.dataset.mapView);
          }
        };
      });
      box.querySelectorAll('[data-map-new]').forEach(btn => {
        btn.onclick = () => {
          const loc = this._activeLoc;
          if (loc && window.SDJMapActions && typeof window.SDJMapActions.create === 'function') {
            window.SDJMapActions.create(loc.id, loc.name);
          }
        };
      });
    }

    // 帖子自定义坐标：地图上没有对应地点时，临时显示一个标记并聚焦
    showTemporaryMarker(loc) {
      if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) return;
      const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      if (this._tempMarker) {
        this.labelGroup.remove(this._tempMarker);
        this._tempMarker = null;
      }
      const div = document.createElement('div');
      div.className = 'map-label label-l3 temp-marker';
      div.innerHTML = `
        <div class="label-text">${esc(loc.name || '帖子标记')}<span class="label-district">帖子位置</span></div>
        <div class="label-line"></div>
        <div class="label-dot"></div>`;
      const label = new CSS2DObject(div);
      label.position.copy(this.getPos(Number(loc.lat), Number(loc.lon), 1.05));
      label.userData = Object.assign({ level: 3, desc: '来自论坛帖子的位置标记。' }, loc);
      div.addEventListener('click', (e) => { e.stopPropagation(); this.onLabelClick(label); });
      this.labelGroup.add(label);
      this._tempMarker = label;
      this.onLabelClick(label);
      this.flyToTarget(label);
    }

    // 🚨 核心修复：使用 getWorldPosition 确保追踪目标准确
    flyToTarget(label) {
      if (this.isAnimating) return;
      this.controls.autoRotate = false;
      
      // 获取真实的实时世界坐标（经过了地球自转和倾斜）
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
      this.controls.addEventListener('start', () => { 
        if (this.isAnimating) {
          this.isAnimating = false;
          this.controls.enabled = true;
        }
        this.controls.autoRotate = false; 
      });

      let addBtn = null;
      if (this.isAdmin) {
        const toolbar = document.getElementById('adminToolbar');
        toolbar.style.display = 'flex';
        addBtn = document.getElementById('btnAddMode');
        
        const setIdle = () => {
          this.isAddMode = false;
          if (addBtn) {
            addBtn.classList.remove('active');
            addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> 添加地点（点击球体）`;
          }
          const hint = document.getElementById('mapHint');
          if (hint) hint.textContent = "点击图钉查看详情 · 滚轮缩放 · 拖拽旋转";
        };
        this._resetAddMode = setIdle;

        addBtn.onclick = () => {
          this.isAddMode = !this.isAddMode;
          if (this.isAddMode) {
            addBtn.classList.add('active');
            addBtn.innerHTML = '点击球体选择位置…';
            const hint = document.getElementById('mapHint');
            hint.textContent = "管理员模式：在地形上点击以创建新地点";
            hint.classList.add('show');
          } else {
            setIdle();
          }
        };
      }

      this.renderer.domElement.addEventListener('click', (e) => {
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
          document.dispatchEvent(new CustomEvent('sdj:map-pick', { detail: { lat, lon } }));
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
      window.addEventListener('resize', this._onResize);
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
      const missions = this.getMissions().filter(m => m.status !== "done");
      const group = new THREE.Group();

      missions.forEach(mission => {
        const loc = this.resolveMissionLocation(mission);
        if (!loc) return;
        const meta = palette[mission.level] || { color: "#ffffff" };
        const pos = this.getPos(Number(loc.lat), Number(loc.lon), 1.06);

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
      const all = this.getMissions().filter(m => m.status !== "done");
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
                <div class="dock-item" data-mid="${a.id}">
                  <span class="dock-dot" style="background:${meta.color}"></span>
                  <span class="dock-name">${a.title}</span>
                  <span class="dock-loc">${a.loc.name}</span>
                </div>`).join("")}
            </div>`;
        }).join("");
      }

      if (unresolved.length) {
        this.dockListEl.innerHTML += `
          <div class="dock-group">
            <div class="dock-group-title warn"><i></i>地点未匹配<span>${unresolved.length}</span></div>
            ${unresolved.map(m => `<div class="dock-item unresolved"><span class="dock-dot"></span><span class="dock-name">${m.title}</span><span class="dock-loc">${m.loc || "未填写"}</span></div>`).join("")}
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
        this.ripples.forEach(r => {
          const k = (clock * 0.55 + r.phase) % 1;
          r.mesh.scale.setScalar(1 + k * 6);
          r.mesh.material.opacity = 0.6 * (1 - k);
        });
      }

      let t = (dist - 1.5) / (3.0 - 1.5);
      t = Math.max(0.0, Math.min(1.0, t));
      this.terrainMesh.material.uniforms.uDarkness.value = t * 0.9;
      this.pMat.opacity = t;

      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);

      this.labels.forEach(label => {
        const level = label.userData.level;
        let targetOpacity = 0;
        let scale = 1.0;

        if (level === 1) {
          if (dist > 2.5) targetOpacity = 1.0;
          else if (dist > 2.3) targetOpacity = (dist - 2.3) / 0.2;
        } else if (level === 2) {
          if (dist > 2.5) targetOpacity = 0;
          else if (dist > 2.3) targetOpacity = (2.5 - dist) / 0.2;
          else if (dist > 1.6) targetOpacity = 1.0;
          else if (dist > 1.4) targetOpacity = (dist - 1.4) / 0.2;
        } else if (level === 3) {
          if (dist > 1.6) targetOpacity = 0;
          else if (dist > 1.4) targetOpacity = (1.6 - dist) / 0.2;
          else if (dist > 1.2) targetOpacity = 1.0;
          else if (dist > 1.1) targetOpacity = (dist - 1.1) / 0.1;
          scale = 0.9;
        } else if (level === 4) {
          if (dist <= 1.2) targetOpacity = 1.0;
          else if (dist < 1.3) targetOpacity = (1.3 - dist) / 0.1;
          scale = 0.8;
        }

        const labelWorldPos = label.getWorldPosition(new THREE.Vector3());
        const dirToLabel = labelWorldPos.clone().sub(this.camera.position).normalize();
        const facing = camDir.dot(dirToLabel);
        
        if (facing < 0.1) targetOpacity *= Math.max(0, (facing + 0.2) / 0.3);

        // 初始 style.opacity 为空，parseFloat 会得到 NaN，必须兜底为 0，否则 LOD 透明度永久失效
        const currentOpacity = parseFloat(label.element.style.opacity) || 0;
        const newOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.15;
        
        label.element.style.opacity = newOpacity;
        
        if (newOpacity < 0.05) {
          label.element.style.pointerEvents = 'none';
          label.element.style.zIndex = -1;
        } else {
          label.element.style.pointerEvents = 'auto';
          label.element.style.zIndex = Math.floor(1000 + (level * 100) - (dist * 100));
        }

        const finalScale = scale * (0.8 + newOpacity * 0.2);
        label.element.style.transform = `translate(-50%, -100%) scale(${finalScale})`;
      });

      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    }

    destroy() {
      this._destroyed = true;
      cancelAnimationFrame(this.animationId);
      clearTimeout(this._dockTimer);
      if (this._onControlsChange) {
        this.controls.removeEventListener('change', this._onControlsChange);
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
        window.removeEventListener('resize', this._onResize);
        this._onResize = null;
      }
      this.controls.dispose();
      this.renderer.dispose();
      this.labelRenderer.domElement.remove();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      // 释放 GPU 资源，避免反复进出地图造成显存泄漏
      if (this.terrainMesh) {
        this.terrainMesh.geometry.dispose();
        this.terrainMesh.material.dispose();
        this.terrainMesh = null;
      }
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
