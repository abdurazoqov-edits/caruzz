import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
// Offline APK uchun ./draco/ katalogidan dekoderlarni yuklash
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
    castShadow = true,
    receiveShadow = true,
    centerXZ = true
  } = options;

  const gltf = await gltfLoader.loadAsync(url);
  const inner = gltf.scene;
  inner.rotation.y = rotateY;

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
  // Model tagini aynan y = 0 ga tushirish
  inner.position.y -= scaledBox.min.y;

  inner.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = castShadow;
      obj.receiveShadow = receiveShadow;
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

/**
 * Agar GLB fayl hali yuklanmagan bo'lsa, test uchun sodda 3D mashina yasaydi
 */
export function createFallbackCar(colorHex = '#f8fafc', isVan = false) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.45,
    roughness: 0.35
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.8,
    roughness: 0.15
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.85
  });

  const length = isVan ? 3.9 : 4.4;
  const width = isVan ? 1.6 : 1.85;
  const baseH = isVan ? 0.95 : 0.65;

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(width, baseH, length, 6, 3, 8),
    bodyMat
  );
  chassis.name = 'car_body_chassis';
  chassis.position.y = 0.58;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  root.add(chassis);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.86, isVan ? 0.8 : 0.55, isVan ? length * 0.82 : length * 0.48, 4, 2, 4),
    glassMat
  );
  cabin.name = 'car_glass_cabin';
  cabin.position.set(0, baseH + 0.52, isVan ? -0.1 : -0.15);
  cabin.castShadow = true;
  root.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
  wheelGeo.rotateZ(Math.PI / 2);

  const wheelOffsets = [
    { name: 'wheel_fl', x: -width * 0.48, z: length * 0.32 },
    { name: 'wheel_fr', x: width * 0.48, z: length * 0.32 },
    { name: 'wheel_rl', x: -width * 0.48, z: -length * 0.32 },
    { name: 'wheel_rr', x: width * 0.48, z: -length * 0.32 }
  ];

  wheelOffsets.forEach((w) => {
    const mesh = new THREE.Mesh(wheelGeo, wheelMat);
    mesh.name = w.name;
    mesh.position.set(w.x, 0.34, w.z);
    mesh.castShadow = true;
    root.add(mesh);
  });

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  return { root, inner: root, animations: [], size, box };
}

/**
 * Mashina balonlarini, bo'yaladigan kuzov detallarini va deformatsiya (pachoq) ma'lumotlarini tayyorlaydi.
 */
export function setupVehicleRig(carRoot, initialColor = '#f8fafc') {
  const wheels = [];
  const frontSteerPivots = [];
  const paintMaterials = [];
  const deformableMeshes = [];

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

    // Kuzov vertexlarini pachoq qilish uchun asl koordinatalarini saqlash
    if (obj.geometry && obj.geometry.attributes?.position) {
      if (!obj.geometry.userData.originalPositions) {
        obj.geometry = obj.geometry.clone();
        obj.geometry.userData.originalPositions = Float32Array.from(
          obj.geometry.attributes.position.array
        );
      }
      deformableMeshes.push(obj);
    }

    // Bo'yaladigan materiallarni ajratib olish
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

  // Balonlarni haqiqiy markazi bo'yicha pivot guruhga olish (GLB da origin 0,0,0 bo'lsa ham uchib ketmaydi)
  carRoot.updateMatrixWorld(true);
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
    if (isFront) {
      frontSteerPivots.push(steerPivot);
    }
  });

  // O'zbekiston davlat raqami (old va orqa bamperga)
  const plateData = { region: '01', number: 'A 777 AA' };
  const plateTexture = createUzbekPlateTexture(plateData.region, plateData.number);
  const plateMat = new THREE.MeshBasicMaterial({ map: plateTexture });
  const plateGeo = new THREE.PlaneGeometry(0.54, 0.13);

  const frontPlate = new THREE.Mesh(plateGeo, plateMat);
  frontPlate.position.set(0, Math.max(0.42, size.y * 0.28), box.max.z + 0.02);
  carRoot.add(frontPlate);

  const rearPlate = new THREE.Mesh(plateGeo, plateMat);
  rearPlate.rotation.y = Math.PI;
  rearPlate.position.set(0, Math.max(0.45, size.y * 0.34), box.min.z - 0.02);
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
    deformableMeshes,
    plateData,
    setColor,
    setPlate,
    size
  };
}

/**
 * Mashina urilganda to'qnashuv nuqtasi atrofini pachoq qiladi
 */
export function applyCarDent(rig, localHitPoint, impactStrength = 0.25) {
  if (!rig?.deformableMeshes) return;
  const radius = 1.15;

  rig.deformableMeshes.forEach((mesh) => {
    const posAttr = mesh.geometry.attributes.position;
    if (!posAttr) return;

    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i);
      const dist = v.distanceTo(localHitPoint);
      if (dist < radius) {
        const factor = (1 - dist / radius) * impactStrength;
        v.x *= 1 - factor * 0.45;
        v.z *= 1 - factor * 0.55;
        v.y += (Math.random() - 0.35) * factor * 0.25;
        posAttr.setXYZ(i, v.x, v.y, v.z);
      }
    }
    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  });
}

/**
 * Pachoq bo'lgan mashinani asl holiga qaytaradi
 */
export function repairCarRig(rig) {
  if (!rig?.deformableMeshes) return;
  rig.deformableMeshes.forEach((mesh) => {
    const orig = mesh.geometry.userData.originalPositions;
    const posAttr = mesh.geometry.attributes.position;
    if (orig && posAttr) {
      posAttr.array.set(orig);
      posAttr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  });
}

/**
 * O'zbekiston davlat raqami Canvas teksturasi
 */
export function createUzbekPlateTexture(region = '01', number = 'A 777 AA') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Oq fon va qora ramka
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 118);

  // Region chizig'i
  ctx.beginPath();
  ctx.moveTo(108, 6);
  ctx.lineTo(108, 122);
  ctx.lineWidth = 6;
  ctx.stroke();

  // Hudud kodi (01, 10, 30...)
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 64px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(region.padStart(2, '0'), 56, 66);

  // Asosiy raqam (A 777 AA)
  ctx.font = 'bold 64px monospace';
  ctx.fillText(number.toUpperCase(), 280, 66);

  // O'ng tomonda UZ bayroqcha
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
