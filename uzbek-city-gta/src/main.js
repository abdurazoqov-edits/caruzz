import * as THREE from 'three';
import {
  loadNormalizedModel,
  createFallbackCar,
  setupVehicleRig,
  applyCarDent,
  repairCarRig
} from './modelLoader.js';

// ==========================================
// 1. SAHNA, RENDERER VA ATMOSFERA (Z-FIGHTING YO'Q)
// ==========================================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 250, 1400);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.5,
  2500
);

// Yorug'lik va soyalar
const hemiLight = new THREE.HemisphereLight(0xdff4ff, 0x4b5563, 1.15);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff5e0, 2.2);
sunLight.position.set(120, 200, 90);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 650;
const d = 140;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);
scene.add(sunLight.target);

// Zaxira yer (shahar yo'llaridan pastda y = -0.4 turadi, pirpirash bo'lmaydi)
const fallbackGround = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.95 })
);
fallbackGround.rotation.x = -Math.PI / 2;
fallbackGround.position.y = -0.4;
fallbackGround.receiveShadow = true;
scene.add(fallbackGround);

// ==========================================
// 2. RAYCASTER ORQALI YO'L BALANDLIGINI TOPISH
// ==========================================
const cityColliderMeshes = [];
const buildingObstacles = [];
const groundRaycaster = new THREE.Raycaster();
const downVec = new THREE.Vector3(0, -1, 0);

function getGroundY(x, z) {
  if (cityColliderMeshes.length === 0) return 0;
  groundRaycaster.set(new THREE.Vector3(x, 220, z), downVec);
  const hits = groundRaycaster.intersectObjects(cityColliderMeshes, true);
  if (hits.length > 0) {
    return hits[0].point.y;
  }
  return 0;
}

// ==========================================
// 3. O'YIN HOLATI VA MOBIL HUD ELEMENTLARI
// ==========================================
const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loading-bar');
const loadingStatus = document.getElementById('loading-status');
const speedVal = document.getElementById('speed-val');
const carHpFill = document.getElementById('car-hp-fill');
const plateHud = document.getElementById('plate-hud');
const enterExitBtn = document.getElementById('enter-exit-btn');
const joystickZone = document.getElementById('joystick-zone');
const joystickStick = document.getElementById('joystick-stick');
const steerControls = document.getElementById('steer-controls');
const pedalsRow = document.getElementById('pedals-row');
const steeringWheelHud = document.getElementById('steering-wheel-hud');
const btnRepair = document.getElementById('btn-repair');
const btnRadio = document.getElementById('btn-radio');
const toastMsg = document.getElementById('toast-msg');

function showToast(msg) {
  toastMsg.textContent = msg;
  toastMsg.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastMsg.classList.remove('show'), 2400);
}

// Mashina musiqasi (./models/7440512639.mp3)
const carAudio = new Audio('./models/7440512639.mp3');
carAudio.loop = true;
carAudio.volume = 0.55;
let radioOn = false;

btnRadio.addEventListener('click', () => {
  radioOn = !radioOn;
  btnRadio.textContent = radioOn ? 'Radio: ON' : 'Radio: OFF';
  btnRadio.classList.toggle('active', radioOn);
  if (radioOn && state.activeCar) {
    carAudio.play().catch(() => {});
  } else {
    carAudio.pause();
  }
});

// ==========================================
// 4. MODELLARNI YUKLASH (SHAHAR, TELEMINORA, REGISTON, PERSONAJ, MASHINALAR)
// ==========================================
const state = {
  player: null,
  playerMixer: null,
  playerWalkAction: null,
  playerPos: new THREE.Vector3(0, 0, 12),
  playerYaw: 0,
  cars: new Map(), // id -> carObj
  activeCar: null,
  selectedCarId: 'gentra',
  cameraYaw: Math.PI,
  cameraPitch: 0.32,
  cameraDist: 7.5,
  npcs: [],
  trafficCars: []
};

async function safeLoadCity() {
  loadingBar.style.width = '20%';
  loadingStatus.textContent = 'Shahar xaritasi yuklanmoqda...';
  try {
    const city = await loadNormalizedModel('./models/ccity_building_set_1.glb', {
      targetMaxSize: 420,
      castShadow: true,
      receiveShadow: true
    });
    scene.add(city.root);
    city.root.traverse((obj) => {
      if (obj.isMesh) {
        cityColliderMeshes.push(obj);
        // Binolar bilan to'qnashuv uchun baland obyektlarni ajratish
        const b = new THREE.Box3().setFromObject(obj);
        const s = new THREE.Vector3();
        b.getSize(s);
        if (s.y > 2.4 && s.x < 90 && s.z < 90) {
          buildingObstacles.push(b);
        }
      }
    });
  } catch (err) {
    console.warn('ccity_building_set_1.glb topilmadi, zaxira ko‘cha yaratildi:', err);
    createFallbackCityRoads();
  }

  // Toshkent Teleminorasi
  loadingBar.style.width = '40%';
  loadingStatus.textContent = 'Toshkent Teleminorasi joylashtirilmoqda...';
  try {
    const tower = await loadNormalizedModel('./models/tashkent_tv_tower.glb', {
      targetHeight: 115
    });
    const tx = 65;
    const tz = -75;
    tower.root.position.set(tx, getGroundY(tx, tz), tz);
    scene.add(tower.root);
  } catch (e) {
    console.info('tashkent_tv_tower.glb hali qo‘yilmagan.');
  }

  // Registon majmuasi (ixtiyoriy, 100MB dan kichraytirilgan GLB)
  try {
    const registon = await loadNormalizedModel('./models/registon.glb', {
      targetMaxSize: 70
    });
    const rx = -85;
    const rz = -65;
    registon.root.position.set(rx, getGroundY(rx, rz), rz);
    scene.add(registon.root);
  } catch (e) {
    // Registon qo'yilmagan bo'lsa jim o'tkaziladi
  }
}

function createFallbackCityRoads() {
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.6 });

  const roadNS = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 420), roadMat);
  roadNS.position.set(0, -0.1, 0);
  roadNS.receiveShadow = true;
  scene.add(roadNS);
  cityColliderMeshes.push(roadNS);

  const roadEW = new THREE.Mesh(new THREE.BoxGeometry(420, 0.2, 16), roadMat);
  roadEW.position.set(0, -0.09, 0);
  roadEW.receiveShadow = true;
  scene.add(roadEW);
  cityColliderMeshes.push(roadEW);

  for (let i = -180; i <= 180; i += 16) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 6), lineMat);
    dash.position.set(0, -0.08, i);
    scene.add(dash);
  }
}

async function loadPlayer() {
  loadingBar.style.width = '58%';
  loadingStatus.textContent = 'O‘yinchi personaj yuklanmoqda...';
  try {
    const p = await loadNormalizedModel('./models/cyberpunk_women.glb', {
      targetHeight: 1.75
    });
    state.player = p.root;
    if (p.animations.length > 0) {
      state.playerMixer = new THREE.AnimationMixer(p.inner);
      state.playerWalkAction = state.playerMixer.clipAction(p.animations[0]);
    }
  } catch (e) {
    const fallbackGroup = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.95, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.5 })
    );
    body.position.y = 0.85;
    body.castShadow = true;
    fallbackGroup.add(body);
    state.player = fallbackGroup;
  }

  state.playerPos.y = getGroundY(state.playerPos.x, state.playerPos.z);
  state.player.position.copy(state.playerPos);
  scene.add(state.player);
}

async function spawnCars() {
  loadingBar.style.width = '78%';
  loadingStatus.textContent = 'Gentra, Nexia 2 va Damas joylashtirilmoqda...';

  const specs = [
    {
      id: 'gentra',
      label: 'Chevrolet Gentra',
      url: './models/gentra.glb',
      pos: new THREE.Vector3(-4.5, 0, 4),
      color: '#f8fafc',
      plate: { region: '01', number: 'A 777 AA' },
      maxSpeed: 25,
      accel: 12,
      rotateY: 0, // Agar model teskari bo'lsa Math.PI qiling
      isVan: false
    },
    {
      id: 'nexia',
      label: 'Daewoo Nexia 2',
      url: './models/daewoo_nexia_2.glb',
      pos: new THREE.Vector3(4.5, 0, -4),
      color: '#94a3b8',
      plate: { region: '01', number: 'O 070 OO' },
      maxSpeed: 23,
      accel: 11,
      rotateY: 0,
      isVan: false
    },
    {
      id: 'damas',
      label: 'Chevrolet Damas',
      url: './models/chevrolet_damas.glb',
      pos: new THREE.Vector3(-5, 0, -14),
      color: '#f8fafc',
      plate: { region: '30', number: 'D 505 DA' },
      maxSpeed: 18,
      accel: 8.5,
      rotateY: 0,
      isVan: true
    },
    {
      id: 'cobalt',
      label: 'Chevrolet Cobalt',
      url: './models/chevrolet_cobalt_ltz.glb',
      pos: new THREE.Vector3(5, 0, 14),
      color: '#2563eb',
      plate: { region: '10', number: 'C 333 CC' },
      maxSpeed: 24,
      accel: 11.5,
      rotateY: 0,
      isVan: false,
      optional: true
    }
  ];

  for (const spec of specs) {
    let model;
    try {
      model = await loadNormalizedModel(spec.url, {
        targetMaxSize: 4.5,
        rotateY: spec.rotateY
      });
      if (spec.id === 'cobalt') {
        document.getElementById('btn-cobalt').style.display = 'inline-flex';
      }
    } catch (e) {
      if (spec.optional) continue;
      model = createFallbackCar(spec.color, spec.isVan);
    }

    const rig = setupVehicleRig(model.root, spec.color);
    rig.setPlate(spec.plate.region, spec.plate.number);

    const gy = getGroundY(spec.pos.x, spec.pos.z);
    model.root.position.set(spec.pos.x, gy, spec.pos.z);
    scene.add(model.root);

    state.cars.set(spec.id, {
      ...spec,
      mesh: model.root,
      rig,
      speed: 0,
      steerAngle: 0,
      yaw: 0,
      hp: 100,
      radius: 2.15
    });
  }
}

function spawnNPCsAndTraffic() {
  loadingBar.style.width = '92%';
  loadingStatus.textContent = 'Shahar NPC va trafik qo‘shilmoqda...';

  // Piyoda NPC lar
  for (let i = 0; i < 8; i++) {
    let npcRoot;
    if (state.player) {
      npcRoot = state.player.clone();
    } else {
      npcRoot = new THREE.Group();
    }
    const x = (Math.random() - 0.5) * 80;
    const z = (Math.random() - 0.5) * 80;
    npcRoot.position.set(x, getGroundY(x, z), z);
    scene.add(npcRoot);

    state.npcs.push({
      mesh: npcRoot,
      angle: Math.random() * Math.PI * 2,
      speed: 1.4 + Math.random() * 0.8,
      turnTimer: 2 + Math.random() * 4
    });
  }

  // Trafik mashinalari (yo'l bo'ylab yuradi)
  const trafficColors = ['#dc2626', '#2563eb', '#f59e0b', '#059669'];
  for (let i = 0; i < 4; i++) {
    const tc = createFallbackCar(trafficColors[i % trafficColors.length], i === 3);
    const rig = setupVehicleRig(tc.root, trafficColors[i % trafficColors.length]);
    rig.setPlate('01', `T ${100 + i * 111} UZ`);
    const zPos = -70 + i * 40;
    const xPos = i % 2 === 0 ? 3.2 : -3.2;
    tc.root.position.set(xPos, getGroundY(xPos, zPos), zPos);
    tc.root.rotation.y = i % 2 === 0 ? 0 : Math.PI;
    scene.add(tc.root);

    state.trafficCars.push({
      mesh: tc.root,
      rig,
      yaw: tc.root.rotation.y,
      speed: 8.5,
      radius: 2.15
    });
  }
}

// ==========================================
// 5. MULTI-TOUCH BOSHQARUV (JOYSTIK + 360° KAMERA + RUL/PEDAL)
// ==========================================
const input = {
  joyX: 0,
  joyY: 0,
  joyTouchId: null,
  camTouchId: null,
  camLastX: 0,
  camLastY: 0,
  gas: false,
  brake: false,
  steerLeft: false,
  steerRight: false,
  keys: new Set()
};

// Chap Joystik: dy < 0 (barmoq tepaga) => OLDINGA yuradi!
joystickZone.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    if (input.joyTouchId !== null) return;
    const t = e.changedTouches[0];
    input.joyTouchId = t.identifier;
    updateJoystick(t);
  },
  { passive: false }
);

joystickZone.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === input.joyTouchId) {
        updateJoystick(t);
      }
    }
  },
  { passive: false }
);

const endJoystick = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === input.joyTouchId) {
      input.joyTouchId = null;
      input.joyX = 0;
      input.joyY = 0;
      joystickStick.style.transform = 'translate(0px, 0px)';
    }
  }
};
joystickZone.addEventListener('touchend', endJoystick);
joystickZone.addEventListener('touchcancel', endJoystick);

function updateJoystick(touch) {
  const rect = joystickZone.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxR = 44;
  let dx = touch.clientX - cx;
  let dy = touch.clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxR) {
    dx = (dx / dist) * maxR;
    dy = (dy / dist) * maxR;
  }
  joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
  input.joyX = dx / maxR;
  input.joyY = dy / maxR; // Tepaga surganda dy < 0!
}

// O'ng tomon bo'sh joy: multi-touch 360° kamera aylanishi
const camZone = document.getElementById('camera-touch-zone');
camZone.addEventListener(
  'touchstart',
  (e) => {
    if (input.camTouchId !== null) return;
    const t = e.changedTouches[0];
    input.camTouchId = t.identifier;
    input.camLastX = t.clientX;
    input.camLastY = t.clientY;
  },
  { passive: true }
);

camZone.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === input.camTouchId) {
        const dx = t.clientX - input.camLastX;
        const dy = t.clientY - input.camLastY;
        input.camLastX = t.clientX;
        input.camLastY = t.clientY;
        state.cameraYaw -= dx * 0.0065;
        state.cameraPitch = THREE.MathUtils.clamp(state.cameraPitch + dy * 0.005, 0.08, 1.15);
      }
    }
  },
  { passive: false }
);

const endCamTouch = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === input.camTouchId) {
      input.camTouchId = null;
    }
  }
};
camZone.addEventListener('touchend', endCamTouch);
camZone.addEventListener('touchcancel', endCamTouch);

// Mouse orqali ham 360 kamera test qilish (kompyuter brauzeri uchun)
let mouseDragging = false;
camZone.addEventListener('mousedown', (e) => {
  mouseDragging = true;
  input.camLastX = e.clientX;
  input.camLastY = e.clientY;
});
window.addEventListener('mousemove', (e) => {
  if (!mouseDragging) return;
  const dx = e.clientX - input.camLastX;
  const dy = e.clientY - input.camLastY;
  input.camLastX = e.clientX;
  input.camLastY = e.clientY;
  state.cameraYaw -= dx * 0.006;
  state.cameraPitch = THREE.MathUtils.clamp(state.cameraPitch + dy * 0.0045, 0.08, 1.15);
});
window.addEventListener('mouseup', () => {
  mouseDragging = false;
});

// Haydash tugmalari (Gaz, Tormoz, Chap, O'ng)
function bindHoldBtn(el, key) {
  const down = (e) => {
    e.preventDefault();
    input[key] = true;
    el.classList.add('pressed');
  };
  const up = (e) => {
    e.preventDefault();
    input[key] = false;
    el.classList.remove('pressed');
  };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up);
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

bindHoldBtn(document.getElementById('btn-gas'), 'gas');
bindHoldBtn(document.getElementById('btn-brake'), 'brake');
bindHoldBtn(document.getElementById('btn-steer-left'), 'steerLeft');
bindHoldBtn(document.getElementById('btn-steer-right'), 'steerRight');

window.addEventListener('keydown', (e) => input.keys.add(e.code));
window.addEventListener('keyup', (e) => input.keys.delete(e.code));

// ==========================================
// 6. MASHINAGA MINISH / TUSHISH VA TANLASH
// ==========================================
function enterCar(car) {
  if (!car) return;
  state.activeCar = car;
  state.selectedCarId = car.id;
  if (state.player) state.player.visible = false;

  joystickZone.style.display = 'none';
  steerControls.style.display = 'flex';
  pedalsRow.style.display = 'flex';
  steeringWheelHud.style.display = 'flex';
  enterExitBtn.textContent = 'TUSHISH';
  enterExitBtn.classList.add('visible');

  updateCarHud(car);
  updateTopCarButtons(car.id);

  if (radioOn) {
    carAudio.play().catch(() => {});
  }
  showToast(`${car.label} rulidasiz!`);
}

function exitCar() {
  if (!state.activeCar) return;
  const car = state.activeCar;
  car.speed *= 0.2;

  const sideOffset = new THREE.Vector3(-2.3, 0, 0).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    car.yaw
  );
  state.playerPos.copy(car.mesh.position).add(sideOffset);
  state.playerPos.y = getGroundY(state.playerPos.x, state.playerPos.z);

  if (state.player) {
    state.player.position.copy(state.playerPos);
    state.player.visible = true;
  }

  state.activeCar = null;
  joystickZone.style.display = 'block';
  steerControls.style.display = 'none';
  pedalsRow.style.display = 'none';
  steeringWheelHud.style.display = 'none';
  enterExitBtn.textContent = 'MINISH';
  speedVal.textContent = '0';
  carAudio.pause();
}

function updateCarHud(car) {
  carHpFill.style.width = `${Math.max(0, car.hp)}%`;
  carHpFill.style.background =
    car.hp > 60 ? '#10b981' : car.hp > 30 ? '#f59e0b' : '#ef4444';
  plateHud.textContent = `${car.rig.plateData.region} ${car.rig.plateData.number}`;
  btnRepair.style.display = car.hp < 100 ? 'inline-flex' : 'none';
}

function updateTopCarButtons(activeId) {
  document.querySelectorAll('#car-select-group .hud-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.car === activeId);
  });
}

// Tepadan mashina tanlash tugmalari
document.querySelectorAll('#car-select-group .hud-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.car;
    const car = state.cars.get(id);
    if (!car) return;
    if (state.activeCar && state.activeCar !== car) {
      exitCar();
    }
    enterCar(car);
  });
});

// Yaqinlashganda "MINISH" / "TUSHISH" tugmasi
let nearestCarCache = null;
enterExitBtn.addEventListener('click', () => {
  if (state.activeCar) {
    exitCar();
  } else if (nearestCarCache) {
    enterCar(nearestCarCache);
  }
});

// Ta'mirlash tugmasi
btnRepair.addEventListener('click', () => {
  const car = state.activeCar || state.cars.get(state.selectedCarId);
  if (!car) return;
  car.hp = 100;
  repairCarRig(car.rig);
  updateCarHud(car);
  showToast('Mashina ta’mirlandi!');
});

// ==========================================
// 7. NOMER VA RANG ALMASHTIRISH MENYUSI
// ==========================================
const tuningModal = document.getElementById('tuning-modal');
const inputRegion = document.getElementById('input-region');
const inputPlate = document.getElementById('input-plate');
const previewRegion = document.getElementById('preview-region');
const previewPlate = document.getElementById('preview-plate');
let chosenColor = '#f8fafc';

document.getElementById('btn-tuning').addEventListener('click', () => {
  const car = state.activeCar || state.cars.get(state.selectedCarId);
  if (car) {
    inputRegion.value = car.rig.plateData.region;
    inputPlate.value = car.rig.plateData.number;
    previewRegion.textContent = car.rig.plateData.region;
    previewPlate.textContent = car.rig.plateData.number;
    chosenColor = car.color;
  }
  tuningModal.classList.add('open');
});

document.getElementById('btn-close-tuning').addEventListener('click', () => {
  tuningModal.classList.remove('open');
});

inputRegion.addEventListener('input', () => {
  previewRegion.textContent = inputRegion.value.replace(/\D/g, '').slice(0, 2) || '01';
});
inputPlate.addEventListener('input', () => {
  previewPlate.textContent = (inputPlate.value || 'A 777 AA').toUpperCase();
});

document.querySelectorAll('.color-swatch').forEach((sw) => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
    sw.classList.add('selected');
    chosenColor = sw.dataset.color;
  });
});

document.getElementById('btn-apply-tuning').addEventListener('click', () => {
  const car = state.activeCar || state.cars.get(state.selectedCarId);
  if (car) {
    const reg = (inputRegion.value.replace(/\D/g, '') || '01').padStart(2, '0');
    const num = (inputPlate.value || 'A 777 AA').toUpperCase();
    car.color = chosenColor;
    car.rig.setColor(chosenColor);
    car.rig.setPlate(reg, num);
    updateCarHud(car);
    showToast(`Nomer: ${reg} ${num} saqlandi!`);
  }
  tuningModal.classList.remove('open');
});

// ==========================================
// 8. ASOSIY O'YIN TSIKLI (FIZIKA, TO'QNASHUV, PACHOQ, NPC, KAMERA)
// ==========================================
const clock = new THREE.Clock();

function updatePlayer(dt) {
  if (state.activeCar || !state.player) return;

  let moveX = input.joyX;
  let moveY = input.joyY; // Tepaga surganda manfiy (dy < 0)

  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) moveY = -1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) moveY = 1;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) moveX = -1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) moveX = 1;

  const mag = Math.hypot(moveX, moveY);
  if (mag > 0.08) {
    // Kameraga nisbatan oldinga yurish: dy < 0 bo'lganda kamera qarab turgan tomonga yuradi!
    const forward = new THREE.Vector3(-Math.sin(state.cameraYaw), 0, -Math.cos(state.cameraYaw));
    const right = new THREE.Vector3(Math.cos(state.cameraYaw), 0, -Math.sin(state.cameraYaw));

    const moveDir = new THREE.Vector3()
      .addScaledVector(forward, -moveY)
      .addScaledVector(right, moveX)
      .normalize();

    const walkSpeed = 6.2;
    state.playerPos.addScaledVector(moveDir, walkSpeed * Math.min(mag, 1) * dt);
    state.playerYaw = Math.atan2(moveDir.x, moveDir.z);

    if (state.playerWalkAction && !state.playerWalkAction.isRunning()) {
      state.playerWalkAction.play();
    }
  } else if (state.playerWalkAction && state.playerWalkAction.isRunning()) {
    state.playerWalkAction.stop();
  }

  state.playerPos.y = getGroundY(state.playerPos.x, state.playerPos.z);
  state.player.position.copy(state.playerPos);
  state.player.rotation.y = state.playerYaw;

  if (state.playerMixer) state.playerMixer.update(dt);

  // Yaqin mashinani tekshirish ("MINISH" tugmasi)
  let closest = null;
  let bestDist = 4.6;
  state.cars.forEach((car) => {
    const dist = car.mesh.position.distanceTo(state.playerPos);
    if (dist < bestDist) {
      bestDist = dist;
      closest = car;
    }
  });
  nearestCarCache = closest;
  enterExitBtn.classList.toggle('visible', Boolean(closest));
}

function updateActiveCar(dt) {
  const car = state.activeCar;
  if (!car) return;

  const gas = input.gas || input.keys.has('KeyW') || input.keys.has('ArrowUp');
  const brake = input.brake || input.keys.has('KeyS') || input.keys.has('ArrowDown');
  const left = input.steerLeft || input.keys.has('KeyA') || input.keys.has('ArrowLeft');
  const right = input.steerRight || input.keys.has('KeyD') || input.keys.has('ArrowRight');

  // Realistik tezlanish va tormozlanish
  if (gas) {
    car.speed += car.accel * dt;
  } else if (brake) {
    if (car.speed > 0.5) {
      car.speed -= car.accel * 1.9 * dt;
    } else {
      car.speed -= car.accel * 0.75 * dt;
    }
  } else {
    // Tabiiy ishqalanish
    car.speed *= Math.pow(0.28, dt);
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
  }

  car.speed = THREE.MathUtils.clamp(car.speed, -9, car.maxSpeed);

  // Rul va oldingi balonlar burilishi
  const targetSteer = (left ? 1 : 0) - (right ? 1 : 0);
  car.steerAngle = THREE.MathUtils.lerp(car.steerAngle, targetSteer * 0.52, dt * 8);
  steeringWheelHud.style.transform = `translateX(-50%) rotate(${-car.steerAngle * 95}deg)`;

  car.rig.frontSteerPivots.forEach((pivot) => {
    pivot.rotation.y = car.steerAngle;
  });

  // Barcha 4 balonning aylanishi
  const wheelSpin = (car.speed * dt) / 0.34;
  car.rig.wheels.forEach((w) => {
    w.rotation.x += wheelSpin;
  });

  // Burilish fizikasi
  if (Math.abs(car.speed) > 0.25) {
    const dirSign = car.speed >= 0 ? 1 : -1;
    const speedFactor = Math.min(Math.abs(car.speed) / 7, 1);
    car.yaw += car.steerAngle * 2.1 * speedFactor * dirSign * dt;
  }

  const forwardVec = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
  const nextPos = car.mesh.position.clone().addScaledVector(forwardVec, car.speed * dt);

  // To'qnashuv va Pachoq tekshiruvi (boshqa mashinalar va trafik bilan)
  let collided = false;
  const checkCollisionWith = (otherPos, otherRadius) => {
    const dx = nextPos.x - otherPos.x;
    const dz = nextPos.z - otherPos.z;
    const dist = Math.hypot(dx, dz);
    const minDist = car.radius + otherRadius;
    if (dist < minDist && dist > 0.001) {
      collided = true;
      const push = new THREE.Vector3(dx / dist, 0, dz / dist);
      nextPos.addScaledVector(push, minDist - dist);

      const impact = Math.abs(car.speed);
      if (impact > 4.5) {
        const localHit = car.mesh.worldToLocal(otherPos.clone());
        localHit.y = 0.65;
        applyCarDent(car.rig, localHit, Math.min(0.45, impact * 0.02));
        car.hp = Math.max(10, car.hp - impact * 1.4);
        updateCarHud(car);
        showToast('To‘qnashuv! Mashina pachoq bo‘ldi!');
      }
      car.speed *= -0.32;
    }
  };

  state.cars.forEach((other) => {
    if (other !== car) checkCollisionWith(other.mesh.position, other.radius);
  });
  state.trafficCars.forEach((t) => checkCollisionWith(t.mesh.position, t.radius));

  // Bino devorlari bilan gorizontal Raycaster to'qnashuvi (birlashgan GLB xaritalar uchun ham ishlaydi)
  if (!collided && cityColliderMeshes.length > 0 && Math.abs(car.speed) > 0.2) {
    const moveDir = forwardVec.clone().multiplyScalar(car.speed >= 0 ? 1 : -1);
    const rayOrigin = car.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0));
    groundRaycaster.set(rayOrigin, moveDir);
    groundRaycaster.far = 2.6;
    const wallHits = groundRaycaster.intersectObjects(cityColliderMeshes, true);
    groundRaycaster.far = Infinity;
    if (wallHits.length > 0 && wallHits[0].face) {
      const normalY = Math.abs(wallHits[0].face.normal.y);
      if (normalY < 0.5) {
        collided = true;
        if (Math.abs(car.speed) > 5) {
          applyCarDent(car.rig, new THREE.Vector3(0, 0.6, car.speed >= 0 ? 1.8 : -1.8), 0.25);
          car.hp = Math.max(10, car.hp - Math.abs(car.speed) * 1.1);
          updateCarHud(car);
          showToast('Devorga urildi! Mashina pachoq bo‘ldi!');
        }
        nextPos.copy(car.mesh.position);
        car.speed *= -0.35;
      }
    }
  }

  // Bino qutilari bilan to'qnashuv
  for (const box of buildingObstacles) {
    if (
      nextPos.x > box.min.x - 1.5 &&
      nextPos.x < box.max.x + 1.5 &&
      nextPos.z > box.min.z - 1.5 &&
      nextPos.z < box.max.z + 1.5
    ) {
      collided = true;
      if (Math.abs(car.speed) > 5) {
        applyCarDent(car.rig, new THREE.Vector3(0, 0.6, 1.8), 0.25);
        car.hp = Math.max(10, car.hp - Math.abs(car.speed) * 1.1);
        updateCarHud(car);
      }
      nextPos.copy(car.mesh.position);
      car.speed *= -0.35;
      break;
    }
  }

  if (!collided) {
    nextPos.y = getGroundY(nextPos.x, nextPos.z);
  } else {
    nextPos.y = getGroundY(nextPos.x, nextPos.z);
  }

  car.mesh.position.copy(nextPos);
  car.mesh.rotation.y = car.yaw;
  // Burilishda kuzovning yengil egilishi
  car.mesh.rotation.z = THREE.MathUtils.lerp(
    car.mesh.rotation.z,
    -car.steerAngle * (car.speed / car.maxSpeed) * 0.09,
    dt * 6
  );

  speedVal.textContent = Math.round(Math.abs(car.speed) * 3.6).toString();
}

function updateNPCsAndTraffic(dt) {
  state.npcs.forEach((npc) => {
    npc.turnTimer -= dt;
    if (npc.turnTimer <= 0) {
      npc.angle += (Math.random() - 0.5) * 2.2;
      npc.turnTimer = 2.5 + Math.random() * 4;
    }
    npc.mesh.position.x += Math.sin(npc.angle) * npc.speed * dt;
    npc.mesh.position.z += Math.cos(npc.angle) * npc.speed * dt;
    if (Math.abs(npc.mesh.position.x) > 120 || Math.abs(npc.mesh.position.z) > 120) {
      npc.angle += Math.PI;
    }
    npc.mesh.position.y = getGroundY(npc.mesh.position.x, npc.mesh.position.z);
    npc.mesh.rotation.y = npc.angle;
  });

  state.trafficCars.forEach((t) => {
    t.mesh.position.x += Math.sin(t.yaw) * t.speed * dt;
    t.mesh.position.z += Math.cos(t.yaw) * t.speed * dt;
    if (t.mesh.position.z > 130) t.mesh.position.z = -130;
    if (t.mesh.position.z < -130) t.mesh.position.z = 130;
    t.mesh.position.y = getGroundY(t.mesh.position.x, t.mesh.position.z);
    t.rig.wheels.forEach((w) => {
      w.rotation.x += (t.speed * dt) / 0.34;
    });
  });
}

function updateCamera(dt) {
  const targetPos = state.activeCar
    ? state.activeCar.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0))
    : state.playerPos.clone().add(new THREE.Vector3(0, 1.45, 0));

  const dist = state.activeCar ? 8.2 : 5.4;
  const horiz = dist * Math.cos(state.cameraPitch);
  const camPos = new THREE.Vector3(
    targetPos.x + Math.sin(state.cameraYaw) * horiz,
    targetPos.y + dist * Math.sin(state.cameraPitch) + 0.6,
    targetPos.z + Math.cos(state.cameraYaw) * horiz
  );

  camera.position.lerp(camPos, Math.min(1, dt * 10));
  camera.lookAt(targetPos);

  // Quyosh soyasi o'yinchini kuzatib boradi
  sunLight.position.set(targetPos.x + 90, targetPos.y + 160, targetPos.z + 70);
  sunLight.target.position.copy(targetPos);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function init() {
  await safeLoadCity();
  await loadPlayer();
  await spawnCars();
  spawnNPCsAndTraffic();

  loadingBar.style.width = '100%';
  loadingStatus.textContent = 'Tayyor!';
  setTimeout(() => loadingScreen.classList.add('hidden'), 350);

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    updatePlayer(dt);
    updateActiveCar(dt);
    updateNPCsAndTraffic(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
  }
  animate();
}

init();
