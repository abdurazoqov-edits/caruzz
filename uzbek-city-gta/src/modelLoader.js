import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

/**
 * GLB modelni yuklab, Box3 yordamida avtomatik masshtablaydi va y = 0 tekisligiga qo'yadi.
 */
export async function loadNormalizedModel(url, options = {}) {
  const {
    targetHeight = null,
    targetMaxSize = null,
    rotateY = 0,
    autoAlignZ = false,
    centerXZ = true
  } = options;

  const gltf = await gltfLoader.loadAsync(url);
  const inner = gltf.scene;
  inner.rotation.y = rotateY;

  // Agar mashina yonbosh eksport qilingan bo'lsa (kengligi uzunligidan katta), avtomatik 90° burish
  if (autoAlignZ) {
    inner.updateMatrixWorld(true);
    const preBox = new THREE.Box3().setFromObject(inner);
    const preSize = new THREE.Vector3();
    preBox.getSize(preSize);
    if (preSize.x > preSize.z * 1.12) {
      inner.rotation.y += Math.PI / 2;
    }
  }

  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const size = new THREE.Vector3();
  box.getSize(size);

  let scale = 1;
  if (targetHeight && size.y > 0.0001) {
    scale = targetHeight / size.y;
  } else if (targetMaxSize) {
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0.0001) scale = targetMaxSize / maxDim;
  }

  inner.scale.multiplyScalar(scale);
  inner.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(inner);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);

  if (centerXZ) {
    inner.position.x -= center.x;
    inner.position.z -= center.z;
  }
  inner.position.y -= scaledBox.min.y;

  inner.traverse((obj) => {
    if (obj.isMesh) {
      obj.frustumCulled = true;
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        });
      }
    }
  });

  const root = new THREE.Group();
  root.add(inner);

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);

  return {
    root,
    inner,
    animations: gltf.animations || [],
    size: finalSize,
    box: finalBox
  };
}

let sharedShadowTex = null;
export function createContactShadow(width = 2.2, length = 4.4) {
  if (!sharedShadowTex) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    sharedShadowTex = new THREE.CanvasTexture(canvas);
  }
  const mat = new THREE.MeshBasicMaterial({
    map: sharedShadowTex,
    transparent: true,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.04;
  return mesh;
}

/**
 * Personaj uchun animatsiya:
 * 1) Agar GLB da clip bo'lsa AnimationMixer ishlaydi
 * 2) Agar bitta mesh bo'lsa (masalan cyberpunk_women.glb), GPU vertex shader orqali qo'l va oyoqlar qimirlaydi!
 */
export function setupCharacterRig(charRoot, inner, animations = []) {
  let mixer = null;
  let walkAction = null;

  if (animations && animations.length > 0) {
    mixer = new THREE.AnimationMixer(inner);
    const walkClip =
      animations.find((c) => /walk|run|move/i.test(c.name)) || animations[0];
    walkAction = mixer.clipAction(walkClip);
  }

  const shaderUniforms = {
    uWalkPhase: { value: 0 },
    uWalkAmp: { value: 0 },
    uCharInvMatrix: { value: new THREE.Matrix4() },
    uCharMatrix: { value: new THREE.Matrix4() }
  };

  if (!walkAction) {
    inner.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const patched = mats.map((mat) => {
        const m = mat.clone();
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uWalkPhase = shaderUniforms.uWalkPhase;
          shader.uniforms.uWalkAmp = shaderUniforms.uWalkAmp;
          shader.uniforms.uCharInvMatrix = shaderUniforms.uCharInvMatrix;
          shader.uniforms.uCharMatrix = shaderUniforms.uCharMatrix;

          shader.vertexShader =
            `uniform float uWalkPhase;
             uniform float uWalkAmp;
             uniform mat4 uCharInvMatrix;
             uniform mat4 uCharMatrix;\n` + shader.vertexShader;

          shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             if (uWalkAmp > 0.001) {
               vec3 cp = (uCharInvMatrix * modelMatrix * vec4(transformed, 1.0)).xyz;
               float s = sin(uWalkPhase);

               // Oyoqlar (y < 0.88)
               float legMask = smoothstep(0.92, 0.65, cp.y);
               float legSide = cp.x < 0.0 ? 1.0 : -1.0;
               float legArmLen = max(0.0, 0.88 - cp.y);
               float legDZ = s * 0.48 * legSide * uWalkAmp * legMask * legArmLen;

               // Qo'llar (0.72 < y < 1.44 va |x| > 0.13)
               float armMask = smoothstep(0.11, 0.21, abs(cp.x))
                             * smoothstep(0.68, 0.86, cp.y)
                             * smoothstep(1.52, 1.36, cp.y);
               float armSide = cp.x < 0.0 ? -1.0 : 1.0;
               float armLen = max(0.0, 1.38 - cp.y);
               float armDZ = s * 0.62 * armSide * uWalkAmp * armMask * armLen;

               vec3 charDelta = vec3(0.0, abs(s) * 0.04 * uWalkAmp, legDZ + armDZ);
               vec3 localDelta = (inverse(modelMatrix) * uCharMatrix * vec4(charDelta, 0.0)).xyz;
               transformed += localDelta;
             }`
          );
        };
        return m;
      });
      obj.material = Array.isArray(obj.material) ? patched : patched[0];
    });
  }

  let walkPhase = Math.random() * Math.PI * 2;
  let walkAmp = 0;

  return {
    animate(dt, isMoving) {
      if (mixer && walkAction) {
        if (isMoving) {
          if (!walkAction.isRunning()) walkAction.play();
          mixer.update(dt);
        } else if (walkAction.isRunning()) {
          walkAction.stop();
        }
        return;
      }

      if (isMoving) {
        walkPhase += dt * 11.0;
        walkAmp = THREE.MathUtils.lerp(walkAmp, 1.0, dt * 10);
      } else {
        walkAmp = THREE.MathUtils.lerp(walkAmp, 0.0, dt * 10);
      }

      charRoot.updateMatrixWorld();
      shaderUniforms.uWalkPhase.value = walkPhase;
      shaderUniforms.uWalkAmp.value = walkAmp;
      shaderUniforms.uCharMatrix.value.copy(charRoot.matrixWorld);
      shaderUniforms.uCharInvMatrix.value.copy(charRoot.matrixWorld).invert();
    }
  };
}

export function createFallbackCharacter(colorHex = '#00e5ff') {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: colorHex });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xfde68a });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.56, 0.22), mat);
  torso.position.y = 1.08;
  inner.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
  head.position.y = 1.54;
  inner.add(head);

  const armGeo = new THREE.BoxGeometry(0.12, 0.52, 0.12);
  const leftArm = new THREE.Mesh(armGeo, mat);
  leftArm.position.set(-0.24, 1.08, 0);
  inner.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, mat);
  rightArm.position.set(0.24, 1.08, 0);
  inner.add(rightArm);

  const legGeo = new THREE.BoxGeometry(0.14, 0.72, 0.14);
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.set(-0.1, 0.36, 0);
  inner.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.position.set(0.1, 0.36, 0);
  inner.add(rightLeg);

  root.add(inner);
  return { root, inner, animations: [] };
}

export function createFallbackCar(colorHex = '#f8fafc', isVan = false) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x0f172a });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111827 });

  const length = isVan ? 3.8 : 4.3;
  const width = isVan ? 1.65 : 1.85;
  const baseH = isVan ? 0.95 : 0.65;

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(width, baseH, length), bodyMat);
  chassis.name = 'car_body_chassis';
  chassis.position.y = 0.58;
  inner.add(chassis);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.85, isVan ? 0.78 : 0.54, isVan ? length * 0.8 : length * 0.48),
    glassMat
  );
  cabin.name = 'car_glass_cabin';
  cabin.position.set(0, baseH + 0.5, isVan ? -0.05 : -0.15);
  inner.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
  wheelGeo.rotateZ(Math.PI / 2);

  [
    { name: 'wheel_fl', x: -width * 0.48, z: length * 0.32 },
    { name: 'wheel_fr', x: width * 0.48, z: length * 0.32 },
    { name: 'wheel_rl', x: -width * 0.48, z: -length * 0.32 },
    { name: 'wheel_rr', x: width * 0.48, z: -length * 0.32 }
  ].forEach((w) => {
    const mesh = new THREE.Mesh(wheelGeo, wheelMat);
    mesh.name = w.name;
    mesh.position.set(w.x, 0.34, w.z);
    inner.add(mesh);
  });

  root.add(inner);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { root, inner, animations: [], size, box };
}

/**
 * Mashina balonlari, bo'yaladigan kuzov, nomer va tezkor pachoq rigi (geometriya klonlanmaydi -> 0 lag).
 */
export function setupVehicleRig(carRoot, carInner, initialColor = '#f8fafc') {
  const wheels = [];
  const frontSteerPivots = [];
  const paintMaterials = [];

  carRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(carRoot);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const wheelRegex = /(wheel|tire|tyre|rim|balon|koleso|disk|fl|fr|rl|rr)/i;
  const ignorePaintRegex = /(wheel|tire|tyre|glass|window|windshield|mirror|chrome|light|lamp|plate|black|interior|seat|chassis_bottom)/i;
  const detectedWheelMeshes = [];

  carRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    if (wheelRegex.test(obj.name)) {
      detectedWheelMeshes.push(obj);
      return;
    }

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const clonedMats = mats.map((mat) => {
      if (!mat) return mat;
      const matName = `${obj.name}_${mat.name || ''}`;
      if (!ignorePaintRegex.test(matName) && !mat.transparent) {
        const cloned = mat.clone();
        paintMaterials.push(cloned);
        return cloned;
      }
      return mat;
    });
    obj.material = Array.isArray(obj.material) ? clonedMats : clonedMats[0];
  });

  const allSteerPivots = [];
  detectedWheelMeshes.forEach((wheelObj) => {
    const wheelBox = new THREE.Box3().setFromObject(wheelObj);
    const wheelWorldCenter = new THREE.Vector3();
    wheelBox.getCenter(wheelWorldCenter);

    const wheelLocalCenter = carRoot.worldToLocal(wheelWorldCenter.clone());
    const isFront = wheelLocalCenter.z > center.z;

    const steerPivot = new THREE.Group();
    steerPivot.position.copy(wheelLocalCenter);
    carRoot.add(steerPivot);

    const spinPivot = new THREE.Group();
    steerPivot.add(spinPivot);

    steerPivot.updateMatrixWorld(true);
    spinPivot.attach(wheelObj);

    wheels.push(spinPivot);
    allSteerPivots.push(steerPivot);
    if (isFront) frontSteerPivots.push(steerPivot);
  });

  const rotateDetachedWheels = (deltaY) => {
    const c = Math.cos(deltaY);
    const s = Math.sin(deltaY);
    frontSteerPivots.length = 0;
    allSteerPivots.forEach((sp) => {
      const x = sp.position.x;
      const z = sp.position.z;
      sp.position.x = x * c + z * s;
      sp.position.z = -x * s + z * c;
      sp.children.forEach((spinP) => {
        spinP.children.forEach((w) => {
          w.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), deltaY);
        });
      });
      if (sp.position.z > 0) frontSteerPivots.push(sp);
    });
  };

  carRoot.add(createContactShadow(size.x * 1.15, size.z * 1.12));

  // O'zbekiston davlat raqami
  const plateData = { region: '01', number: 'A 777 AA' };
  const plateTexture = createUzbekPlateTexture(plateData.region, plateData.number);
  const plateMat = new THREE.MeshBasicMaterial({ map: plateTexture });
  const plateGeo = new THREE.PlaneGeometry(0.52, 0.12);

  const frontPlate = new THREE.Mesh(plateGeo, plateMat);
  frontPlate.position.set(0, Math.max(0.4, size.y * 0.28), box.max.z + 0.02);
  carRoot.add(frontPlate);

  const rearPlate = new THREE.Mesh(plateGeo, plateMat);
  rearPlate.rotation.y = Math.PI;
  rearPlate.position.set(0, Math.max(0.44, size.y * 0.34), box.min.z - 0.02);
  carRoot.add(rearPlate);

  const setColor = (hex) => {
    paintMaterials.forEach((m) => {
      if (m && m.color) m.color.set(hex);
    });
  };
  setColor(initialColor);

  const setPlate = (region, number) => {
    plateData.region = region;
    plateData.number = number;
    const newTex = createUzbekPlateTexture(region, number);
    plateMat.map?.dispose();
    plateMat.map = newTex;
    plateMat.needsUpdate = true;
  };

  return {
    wheels,
    frontSteerPivots,
    plateData,
    setColor,
    setPlate,
    setDentFactor(hp) {
      const dmg = Math.max(0, (100 - hp) / 100);
      carInner.scale.set(1 + dmg * 0.04, 1 - dmg * 0.05, 1 - dmg * 0.09);
      carInner.rotation.z = dmg * 0.04;
    },
    rotate90() {
      carInner.rotation.y += Math.PI / 2;
      rotateDetachedWheels(Math.PI / 2);
    },
    flip180() {
      carInner.rotation.y += Math.PI;
      rotateDetachedWheels(Math.PI);
    },
    size
  };
}

export function createUzbekPlateTexture(region = '01', number = 'A 777 AA') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 118);

  ctx.beginPath();
  ctx.moveTo(108, 6);
  ctx.lineTo(108, 122);
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 64px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(region.padStart(2, '0'), 56, 66);
  ctx.fillText(number.toUpperCase(), 280, 66);

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(450, 18, 44, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(450, 32, 44, 14);
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(450, 46, 44, 14);
  ctx.fillStyle = '#0284c7';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('UZ', 472, 92);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
