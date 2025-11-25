import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.161.0/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'https://unpkg.com/three@0.161.0/examples/jsm/loaders/RGBELoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.161.0/examples/jsm/loaders/DRACOLoader.js';

const container = document.getElementById('viewer');

// Renderer (transparent background)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x000000, 0); // alpha=0 => transparent
container.appendChild(renderer.domElement);

// Scene & Camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 1000);
camera.position.set(0, 1.2, 2.8);

// Controls (OrbitControls rotates view around target / object's center)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.rotateSpeed = 0.8;
controls.autoRotate = true;           // idle rotation
controls.autoRotateSpeed = 0.6;      // feinjustieren
controls.minDistance = 0.6;
controls.maxDistance = 8;

// A group to hold the model (useful to center & apply object-rotation if wanted)
const modelGroup = new THREE.Group();
scene.add(modelGroup);

// Lights fallback (in case HDR not present or fails)
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(5, 10, 7.5);
scene.add(dir);

// Load environment (HDR) and then the model
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

// Pfade: passe diese Dateien in /assets/ an
const HDR_PATH = './assets/hdri/mountain_1.hdr';     // deine HDR-Datei
const GLB_PATH = './assets/models/rock-2.glb';   // dein GLB/GLTF

// Load HDR (optional)
new RGBELoader()
    .setDataType(THREE.UnsignedByteType) // kleinere Dateien; wenn Probleme, nutze FloatType
    .load(HDR_PATH,
        (hdrTexture) => {
            const envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;
            scene.environment = envMap;
            // transparent background; keine scene.background setzen
            hdrTexture.dispose();
            pmremGenerator.dispose();
            // Dann das Modell laden
            loadModel();
        },
        undefined,
        (err) => {
            console.warn('HDR konnte nicht geladen werden, benutze Default-Licht. Fehler:', err);
            loadModel();
        }
    );

function loadModel() {
    const gltfLoader = new GLTFLoader();
    // optional: DRACO falls das GLB dracocompressed ist (entkommentieren falls benötigt)
    // const dracoLoader = new DRACOLoader();
    // dracoLoader.setDecoderPath('https://unpkg.com/three@0.161.0/examples/js/libs/draco/');
    // gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(GLB_PATH,
        (gltf) => {
            // Einfaches Zentrieren & Skalieren:
            const root = gltf.scene || gltf.scenes[0];
            // Optional: compute bounding box to center & fit to view:
            const box = new THREE.Box3().setFromObject(root);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            // shift geometry so center is origin
            root.position.x += (root.position.x - center.x);
            root.position.y += (root.position.y - center.y);
            root.position.z += (root.position.z - center.z);

            // scale to fit (z.B. größte Seitenlänge => 1 unit)
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) {
                const scale = 1.6 / maxDim; // adjust 1.6 für gewünschte Größe
                root.scale.setScalar(scale);
            }

            modelGroup.add(root);

            // Optionale Material-Feinheiten: ensure materials use sRGBEncoding if textures are sRGB
            root.traverse((n) => {
                if (n.isMesh && n.material) {
                    n.material.needsUpdate = true;
                    if (Array.isArray(n.material)) {
                        n.material.forEach(m => { m.side = THREE.DoubleSide; });
                    } else {
                        n.material.side = THREE.DoubleSide;
                    }
                }
            });

            // Positioniere Controls target auf Model-Mittelpunkt
            controls.target.copy(new THREE.Vector3(0, 0, 0));
            controls.update();
        },
        (xhr) => {
            // loading progress
            // console.log(`${(xhr.loaded / xhr.total * 100).toFixed(1)}% geladen`);
        },
        (err) => {
            console.error('GLB konnte nicht geladen werden:', err);
        }
    );
}

// --- Interaction / Idle-Handling ---
let isInteracting = false;
let resumeTimeout = null;
const RESUME_DELAY_MS = 900; // Wartezeit nach letztem pointerup, bevor Idle wieder startet

function onInteractionStart() {
    isInteracting = true;
    if (resumeTimeout) { clearTimeout(resumeTimeout); resumeTimeout = null; }
    controls.autoRotate = false;
}
function onInteractionEnd() {
    isInteracting = false;
    if (resumeTimeout) clearTimeout(resumeTimeout);
    resumeTimeout = setTimeout(() => {
        controls.autoRotate = true;
        resumeTimeout = null;
    }, RESUME_DELAY_MS);
}

// Pointer events (Maus & Touch)
renderer.domElement.addEventListener('pointerdown', onInteractionStart);
renderer.domElement.addEventListener('pointermove', () => { /* interaction ongoing */ }, { passive: true });
renderer.domElement.addEventListener('pointerup', onInteractionEnd);
renderer.domElement.addEventListener('pointercancel', onInteractionEnd);
renderer.domElement.addEventListener('wheel', () => { onInteractionStart(); onInteractionEnd(); }, { passive: true });

// Also listen to controls events (some input methods trigger these)
controls.addEventListener('start', onInteractionStart);
controls.addEventListener('end', onInteractionEnd);

// Resize handling
window.addEventListener('resize', onWindowResize);
function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// Optional: Wenn du anstatt Kameradreh die Objekt-Roll (dritte Achse) erlauben willst,
// du könntest einen Modifier-Key (Shift) benutzen und beim Drag die modelGroup.rotateZ(...) anwenden.
// Diese Funktionalität ist bewusst nicht standardmäßig aktiviert, weil sie das Handling komplizierter macht.

// Render Loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    // controls.autoRotate (falls true) rotiert intern die Kamera; controls.update() animiert Damping.
    controls.update();

    renderer.render(scene, camera);
}
animate();