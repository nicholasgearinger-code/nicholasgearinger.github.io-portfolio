
/* -- LIVE WEBCAM AI: five real computer-vision models, each independently
      toggleable, running entirely client-side. Every model lazy-loads only
      the first time its toggle is switched on, so nothing downloads until
      asked for. All active models run within the same detection loop and
      draw onto the same overlay canvas. Coordinates are manually mirrored
      in code (not via CSS transform) so text labels stay readable instead
      of rendering backwards, same fix as the original single-model build. -- */
(function webcamAI() {
  const video = document.getElementById('webcam-video');
  const overlay = document.getElementById('webcam-overlay');
  const placeholder = document.getElementById('webcam-placeholder');
  const startBtn = document.getElementById('webcam-start');
  const stopBtn = document.getElementById('webcam-stop');
  const flipBtn = document.getElementById('webcam-flip');
  const hudPanel = document.getElementById('webcam-hud');
  const hudRows = document.getElementById('webcam-hud-rows');
  const hudFps = document.getElementById('webcam-hud-fps');
  const filtersEl = document.getElementById('webcam-filters');
  const filterChips = Array.from(document.querySelectorAll('.webcam-filter-chip'));
  const puppetEl = document.getElementById('webcam-puppet');
  const rigEl = document.getElementById('webcam-rig');
  const puppetLoadingEl = document.getElementById('puppet-pip-loading');
  const rigLoadingEl = document.getElementById('rig-pip-loading');
  const puppetViewer = document.getElementById('puppet-viewer');
  const puppetModelSelect = document.getElementById('puppet-model-select');
  let puppetDefaultRadius = null;
  let puppetModelLoaded = false;
  const statEl = document.getElementById('webcam-stat');
  const pillText = document.getElementById('webcam-pill-text');
  const hintEl = document.getElementById('webcam-hint');
  const toggleStatus = document.getElementById('webcam-toggle-status');
  const toggles = {
    face: document.getElementById('toggle-face'),
    landmarks: document.getElementById('toggle-landmarks'),
    objects: document.getElementById('toggle-objects'),
    hands: document.getElementById('toggle-hands'),
    pose: document.getElementById('toggle-pose'),
  };
  if (!video || !startBtn) return;

  const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
  const FACE_LIB_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.esm-nobundle.js';
  const COCO_LIB_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd/dist/coco-ssd.min.js';
  const TFJS_CORE_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
  const HAND_LIB_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/hand-pose-detection/dist/hand-pose-detection.min.js';
  const POSE_LIB_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection/dist/pose-detection.min.js';
  const THREE_LIB_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';

  const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8], [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16], [0,17],[17,18],[18,19],[19,20], [5,9],[9,13],[13,17],
  ];
  const POSE_CONNECTIONS = [
    ['left_shoulder','right_shoulder'],['left_shoulder','left_elbow'],['left_elbow','left_wrist'],
    ['right_shoulder','right_elbow'],['right_elbow','right_wrist'],['left_shoulder','left_hip'],
    ['right_shoulder','right_hip'],['left_hip','right_hip'],['left_hip','left_knee'],
    ['left_knee','left_ankle'],['right_hip','right_knee'],['right_knee','right_ankle'],
  ];

  let stream = null, running = false, rafId = null;
  let activeFilter = 'none';
  let facingMode = 'user', mirrored = true;
  let faceApiReady = false, landmarksReady = false;
  let cocoModel = null, handDetector = null, poseDetector = null;
  let rigReady = false, rigScene = null, rigCamera = null, rigRenderer = null, rigChar = null;
  const loadPromises = {};

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    startBtn.disabled = true;
    if (pillText) pillText.textContent = 'UNSUPPORTED';
    if (hintEl) hintEl.textContent = 'Your browser doesn\u2019t support camera access, so this demo can\u2019t run here.';
    return;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  function setToggleState(name, state) {
    const input = toggles[name];
    if (!input) return;
    const label = input.closest('.webcam-toggle');
    if (!label) return;
    label.classList.remove('loading', 'errored', 'checked');
    if (state === 'loading') label.classList.add('loading');
    else if (state === 'error') label.classList.add('errored');
    else if (input.checked) label.classList.add('checked');
  }
  function announce(msg) { if (toggleStatus) toggleStatus.textContent = msg; }

  let faceApiPromise = null, landmarksPromise = null, objectsPromise = null, handsPromise = null, posePromise = null;

  async function ensureFace() {
    if (faceApiReady) return;
    if (!faceApiPromise) {
      faceApiPromise = (async () => {
        // The nobundle build expects a global `tf` to already exist rather than
        // importing its own copy — this is what actually avoids the duplicate
        // WebGL-kernel-registration conflict seen when combining face-api.js
        // with the separately-loaded official TF.js models. Loading it
        // explicitly here (rather than relying on some other feature to have
        // loaded it first) guarantees the ordering regardless of which model
        // toggle the person happens to turn on first.
        if (typeof window.tf === 'undefined') await loadScript(TFJS_CORE_URL);
        if (typeof faceapi === 'undefined') {
          window.faceapi = await import(FACE_LIB_URL);
        }
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(FACE_MODEL_URL),
        ]);
        faceApiReady = true;
      })().finally(() => { faceApiPromise = null; });
    }
    return faceApiPromise;
  }
  async function ensureLandmarks() {
    await ensureFace();
    if (landmarksReady) return;
    if (!landmarksPromise) {
      landmarksPromise = faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL)
        .then(() => { landmarksReady = true; })
        .finally(() => { landmarksPromise = null; });
    }
    return landmarksPromise;
  }
  async function ensureObjects() {
    if (cocoModel) return;
    if (!objectsPromise) {
      objectsPromise = (async () => {
        // coco-ssd's standard dist build expects a pre-loaded `tf` global
        // (it's a peer dependency, not bundled in) — load it explicitly
        // rather than relying on some other feature happening to load it first.
        if (typeof tf === 'undefined') await loadScript(TFJS_CORE_URL);
        if (typeof cocoSsd === 'undefined') await loadScript(COCO_LIB_URL);
        cocoModel = await cocoSsd.load();
      })().finally(() => { objectsPromise = null; });
    }
    return objectsPromise;
  }
  const MEDIAPIPE_HANDS_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands';

  async function ensureHands() {
    if (handDetector) return;
    if (!handsPromise) {
      handsPromise = (async () => {
        if (puppetViewer && !puppetViewer.src) puppetViewer.src = puppetModelSelect ? puppetModelSelect.value : 'steampunk_girl-optimized.glb';
        if (typeof handPoseDetection === 'undefined') await loadScript(HAND_LIB_URL);
        // The 'mediapipe' runtime needs @mediapipe/hands/hands.js loaded
        // separately first — it exposes a global `Hands` constructor that
        // hand-pose-detection instantiates internally. solutionPath alone only
        // tells it where to fetch the WASM/model binaries from, not the JS glue.
        if (typeof Hands === 'undefined') await loadScript(MEDIAPIPE_HANDS_URL + '/hands.js');
        // Deliberately NOT using runtime:'tfjs' here — it has a known, documented
        // bug (tensorflow/tfjs#7204) where it returns NaN for every x/y
        // coordinate while still reporting a plausible hand structure. The
        // 'mediapipe' runtime runs its own separate WASM pipeline instead of
        // sharing the page's TF.js backend, which sidesteps the bug entirely.
        handDetector = await handPoseDetection.createDetector(
          handPoseDetection.SupportedModels.MediaPipeHands,
          { runtime: 'mediapipe', solutionPath: MEDIAPIPE_HANDS_URL, modelType: 'lite', maxHands: 2 }
        );
      })().finally(() => { handsPromise = null; });
    }
    return handsPromise;
  }
  // Builds a simple jointed humanoid from primitive shapes — no skinning,
  // just a hierarchy of THREE.Group "joints" each holding a mesh, so
  // rotating a joint group rigidly carries everything below it (a real
  // parent/child rig, just built from boxes instead of a skinned model).
  function buildRigCharacter(T) {
    const cyan = 0x22D3EE, magenta = 0xE879F9, white = 0xF0F8FF, slate = 0x64748B;
    const mat = (color) => new T.MeshStandardMaterial({ color, roughness: .55, metalness: .1 });
    const root = new T.Group();

    const torso = new T.Mesh(new T.BoxGeometry(0.9, 1.3, 0.45), mat(slate));
    torso.position.y = 0.65;
    root.add(torso);

    const head = new T.Mesh(new T.SphereGeometry(0.32, 16, 16), mat(white));
    head.position.y = 1.3 + 0.4;
    root.add(head);

    // A limb segment is itself a pivot group containing the visible mesh
    // offset downward by half its length — that offset is what makes
    // rotating the *pivot* swing the mesh like a real hinge instead of
    // spinning it in place around its own center.
    function buildSegment(length, thickness, color) {
      const pivot = new T.Group();
      const mesh = new T.Mesh(new T.BoxGeometry(thickness, length, thickness), mat(color));
      mesh.position.y = -length / 2;
      pivot.add(mesh);
      return pivot;
    }

    function buildArm(side) {
      const shoulderPivot = new T.Group();
      shoulderPivot.position.set(side * 0.52, 1.15, 0);
      const upperArm = buildSegment(0.55, 0.16, cyan);
      shoulderPivot.add(upperArm);
      const elbowPivot = new T.Group();
      elbowPivot.position.y = -0.55;
      upperArm.add(elbowPivot);
      const lowerArm = buildSegment(0.5, 0.13, cyan);
      elbowPivot.add(lowerArm);
      root.add(shoulderPivot);
      return { shoulderPivot, elbowPivot };
    }
    function buildLeg(side) {
      const hipPivot = new T.Group();
      hipPivot.position.set(side * 0.22, 0, 0);
      const upperLeg = buildSegment(0.62, 0.19, magenta);
      hipPivot.add(upperLeg);
      const kneePivot = new T.Group();
      kneePivot.position.y = -0.62;
      upperLeg.add(kneePivot);
      const lowerLeg = buildSegment(0.58, 0.16, magenta);
      kneePivot.add(lowerLeg);
      root.add(hipPivot);
      return { hipPivot, kneePivot };
    }

    return {
      root,
      leftArm: buildArm(-1), rightArm: buildArm(1),
      leftLeg: buildLeg(-1), rightLeg: buildLeg(1),
    };
  }

  async function ensureRig() {
    if (rigReady) return;
    if (typeof THREE === 'undefined') await loadScript(THREE_LIB_URL);
    const canvas = document.getElementById('rig-canvas');
    if (!canvas) return;
    const w = canvas.clientWidth || 150, h = canvas.clientHeight || 150;
    rigRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    rigRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rigRenderer.setSize(w, h, false);

    rigScene = new THREE.Scene();
    rigCamera = new THREE.PerspectiveCamera(38, w / h, 0.1, 20);
    rigCamera.position.set(0, 1.05, 3.4);
    rigCamera.lookAt(0, 0.85, 0);

    rigScene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(1.5, 3, 2);
    rigScene.add(dirLight);

    rigChar = buildRigCharacter(THREE);
    rigScene.add(rigChar.root);
    rigRenderer.render(rigScene, rigCamera);
    rigReady = true;
  }

  // The PIP's on-screen size can change after setup — rotating the phone,
  // or resizing a desktop window — but the WebGL renderer's internal
  // resolution and the camera's aspect ratio don't update on their own.
  // Without this, the rig would render stretched/squashed after an
  // orientation change instead of just re-fitting to the new box.
  function resizeRig() {
    if (!rigReady || !rigRenderer || !rigCamera) return;
    const canvas = document.getElementById('rig-canvas');
    if (!canvas) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return; // panel currently hidden — nothing to resize
    rigRenderer.setSize(w, h, false);
    rigCamera.aspect = w / h;
    rigCamera.updateProjectionMatrix();
    rigRenderer.render(rigScene, rigCamera);
  }
  window.addEventListener('resize', resizeRig);
  window.addEventListener('orientationchange', () => setTimeout(resizeRig, 250));

  async function ensurePose() {
    if (poseDetector) return;
    if (!posePromise) {
      posePromise = (async () => {
        // MoveNet's default runtime is 'tfjs', which — like coco-ssd — expects
        // the tf global to already exist rather than bundling it.
        if (typeof tf === 'undefined') await loadScript(TFJS_CORE_URL);
        if (typeof poseDetection === 'undefined') await loadScript(POSE_LIB_URL);
        poseDetector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet);
        await ensureRig();
      })().finally(() => { posePromise = null; });
    }
    return posePromise;
  }

  const ENSURERS = { face: ensureFace, landmarks: ensureLandmarks, objects: ensureObjects, hands: ensureHands, pose: ensurePose };
  const LABELS = { face: 'Face + Expression', landmarks: 'Facial Landmarks', objects: 'Objects', hands: 'Hands', pose: 'Body Pose' };

  Object.keys(toggles).forEach((name) => {
    const input = toggles[name];
    if (!input) return;
    input.addEventListener('change', async () => {
      if (!input.checked) { setToggleState(name, 'idle'); announce(''); return; }
      if (!running) { announce('Start the camera first.'); input.checked = false; return; }
      setToggleState(name, 'loading');
      announce('Loading ' + LABELS[name] + '\u2026');
      if (window.setCursorBusy) window.setCursorBusy(true);
      try {
        await ENSURERS[name]();
        setToggleState(name, 'ready');
        announce(LABELS[name] + ' ready.');
      } catch (err) {
        console.error('[webcam-ai]', name, err.message);
        input.checked = false;
        setToggleState(name, 'error');
        announce('Couldn\u2019t load ' + LABELS[name] + ' \u2014 check your connection and try again.');
      } finally {
        if (window.setCursorBusy) window.setCursorBusy(false);
      }
    });
  });

  filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      activeFilter = chip.getAttribute('data-filter');
      filterChips.forEach((c) => c.classList.toggle('active', c === chip));
    });
  });

  if (puppetViewer) {
    // Each model has its own natural scale (a tiny sculpt vs. a car
    // engine), so "zoomed all the way out" has to mean something
    // different per model. Rather than hardcoding a distance, capture
    // model-viewer's own ideal auto-computed radius once each model
    // finishes loading, and scale zoom as a multiplier of *that*.
    puppetViewer.addEventListener('load', () => {
      puppetModelLoaded = true;
      try {
        const orbit = puppetViewer.getCameraOrbit ? puppetViewer.getCameraOrbit() : null;
        puppetDefaultRadius = orbit && orbit.radius ? orbit.radius : null;
      } catch (_) { puppetDefaultRadius = null; }
    });
  }
  if (puppetModelSelect) {
    puppetModelSelect.addEventListener('change', () => {
      puppetDefaultRadius = null;
      puppetModelLoaded = false;
      if (puppetViewer) puppetViewer.src = puppetModelSelect.value;
    });
  }

  function syncSize() { overlay.width = video.videoWidth || 480; overlay.height = video.videoHeight || 360; }
  function mirrorX(x, w) { return mirrored ? overlay.width - x - w : x; }

  async function start() {
    startBtn.disabled = true;
    if (pillText) pillText.textContent = 'STARTING\u2026';
    if (window.setCursorBusy) window.setCursorBusy(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360, facingMode: { ideal: facingMode } }, audio: false });
    } catch (err) {
      if (pillText) pillText.textContent = 'CAMERA DENIED';
      if (hintEl) hintEl.textContent = 'Camera access was denied or unavailable \u2014 this demo needs it to work.';
      startBtn.disabled = false;
      if (window.setCursorBusy) window.setCursorBusy(false);
      return;
    }

    video.srcObject = stream;
    await video.play();
    placeholder.hidden = true;
    stopBtn.hidden = false;
    running = true;

    const ctx = overlay.getContext('2d');
    video.addEventListener('loadedmetadata', syncSize, { once: true });
    syncSize();

    // Phones with a front + back camera get a flip button; anything with
    // just one camera (or a browser that can't enumerate before permission)
    // never sees it. Device labels/count are only reliable after
    // getUserMedia has already been granted, so this has to run here.
    if (flipBtn && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices()
        .then((devices) => { flipBtn.hidden = devices.filter((d) => d.kind === 'videoinput').length < 2; })
        .catch(() => {});
    }

    // Face + expression (and optionally landmarks) is on by default — load it now.
    if (toggles.face && toggles.face.checked) {
      setToggleState('face', 'loading');
      try { await ensureFace(); setToggleState('face', 'ready'); }
      catch (err) { toggles.face.checked = false; setToggleState('face', 'error'); }
    }
    if (pillText) pillText.textContent = 'DETECTING';
    if (window.setCursorBusy) window.setCursorBusy(false);

    // Detections are cached and drawn every frame regardless of whether a
    // *new* detection has finished yet — inference is comparatively slow,
    // so without this, each result would only be on-screen for the instant
    // between finishing and the next clear, easy to miss entirely.
    let cache = { face: [], objects: [], hands: [], pose: [] };

    // Draws the currently-selected AR filter over one detected face, using
    // whichever landmark regions it needs. Deliberately simple shapes
    // (ellipses/curves) rather than image assets — no extra downloads,
    // and they track the face's scale and rotation-in-plane reasonably
    // well just from eye/mouth span.
    function drawFaceFilter(d) {
      if (activeFilter === 'none' || !d.landmarks) return;
      const mirrorPt = (p) => ({ x: mirrorX(p.x, 0), y: p.y });
      const avg = (pts) => ({
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      });
      const spanX = (pts) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));

      if (activeFilter === 'sunglasses') {
        const leftEye = d.landmarks.getLeftEye().map(mirrorPt);
        const rightEye = d.landmarks.getRightEye().map(mirrorPt);
        const lc = avg(leftEye), rc = avg(rightEye);
        const lensW = Math.max(spanX(leftEye), spanX(rightEye)) * 2.1;
        const lensH = lensW * 0.62;
        ctx.fillStyle = 'rgba(8,12,20,.94)';
        [lc, rc].forEach((c) => {
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, lensW / 2, lensH / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.strokeStyle = 'rgba(8,12,20,.94)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(lc.x, lc.y); ctx.lineTo(rc.x, rc.y); ctx.stroke();
      } else if (activeFilter === 'hat') {
        const box = d.detection.box;
        const boxCenterX = mirrorX(box.x, box.width) + box.width / 2;
        const hatW = box.width * 1.25;
        const brimY = box.y - hatW * 0.05;
        const crownH = hatW * 0.55;
        ctx.fillStyle = 'rgba(15,15,18,.96)';
        ctx.beginPath();
        ctx.ellipse(boxCenterX, brimY, hatW / 2, hatW * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        const crownX = boxCenterX - hatW * 0.32, crownY = brimY - crownH, crownW = hatW * 0.64;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(crownX, crownY, crownW, crownH, 6);
        else ctx.rect(crownX, crownY, crownW, crownH);
        ctx.fill();
      } else if (activeFilter === 'mustache') {
        const mouth = d.landmarks.getMouth().map(mirrorPt);
        const mc = avg(mouth);
        const w = spanX(mouth) * 1.3;
        const topY = mc.y - spanX(mouth) * 0.5;
        ctx.fillStyle = 'rgba(28,18,12,.95)';
        ctx.beginPath();
        ctx.moveTo(mc.x - w / 2, topY + w * 0.12);
        ctx.quadraticCurveTo(mc.x - w / 4, topY - w * 0.14, mc.x, topY + w * 0.04);
        ctx.quadraticCurveTo(mc.x + w / 4, topY - w * 0.14, mc.x + w / 2, topY + w * 0.12);
        ctx.quadraticCurveTo(mc.x + w / 4, topY + w * 0.2, mc.x, topY + w * 0.12);
        ctx.quadraticCurveTo(mc.x - w / 4, topY + w * 0.2, mc.x - w / 2, topY + w * 0.12);
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawFace() {
      let faceCount = 0;
      cache.face.forEach((d) => {
        const { x: rawX, y, width, height } = d.detection.box;
        const x = mirrorX(rawX, width);
        faceCount++;
        ctx.strokeStyle = '#22D3EE'; ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(34,211,238,.12)';
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);

        const top = Object.entries(d.expressions).sort((a, b) => b[1] - a[1])[0];
        const label = top[0] + ' ' + Math.round(top[1] * 100) + '%';
        ctx.font = '14px monospace';
        const textW = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(3,8,17,.85)';
        ctx.fillRect(x, Math.max(0, y - 20), textW + 10, 20);
        ctx.fillStyle = '#22D3EE';
        ctx.fillText(label, x + 5, Math.max(14, y - 5));

        if (d.landmarks) {
          ctx.fillStyle = '#E879F9';
          d.landmarks.positions.forEach((p) => {
            ctx.beginPath();
            ctx.arc(mirrorX(p.x, 0), p.y, 1.6, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        drawFaceFilter(d);
      });
      if (statEl) statEl.innerHTML = 'faces detected: <strong>' + faceCount + '</strong>';
    }

    function drawObjects() {
      cache.objects.forEach((p) => {
        const [rawX, y, w, h] = p.bbox;
        const x = mirrorX(rawX, w);
        ctx.strokeStyle = '#F59E0B'; ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        const label = p.class + ' ' + Math.round(p.score * 100) + '%';
        ctx.font = '13px monospace';
        const textW = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(3,8,17,.85)';
        ctx.fillRect(x, Math.max(0, y - 18), textW + 8, 18);
        ctx.fillStyle = '#F59E0B';
        ctx.fillText(label, x + 4, Math.max(13, y - 5));
      });
    }
    function drawHands() {
      cache.hands.forEach((hand) => {
        const pts = hand.keypoints.map((k) => ({ x: mirrorX(k.x, 0), y: k.y }));
        ctx.strokeStyle = '#7DD3FC'; ctx.lineWidth = 2;
        HAND_CONNECTIONS.forEach(([a, b]) => {
          if (!pts[a] || !pts[b]) return;
          ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); ctx.stroke();
        });
        ctx.fillStyle = '#7DD3FC';
        pts.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); });
      });
    }
    function drawPose() {
      cache.pose.forEach((pose) => {
        const byName = {};
        pose.keypoints.forEach((k) => { byName[k.name] = k; });
        ctx.strokeStyle = '#818CF8'; ctx.lineWidth = 2;
        POSE_CONNECTIONS.forEach(([a, b]) => {
          const ka = byName[a], kb = byName[b];
          if (!ka || !kb || ka.score < 0.3 || kb.score < 0.3) return;
          ctx.beginPath();
          ctx.moveTo(mirrorX(ka.x, 0), ka.y);
          ctx.lineTo(mirrorX(kb.x, 0), kb.y);
          ctx.stroke();
        });
        ctx.fillStyle = '#818CF8';
        pose.keypoints.forEach((k) => {
          if (k.score < 0.3) return;
          ctx.beginPath(); ctx.arc(mirrorX(k.x, 0), k.y, 3, 0, Math.PI * 2); ctx.fill();
        });
      });
    }

    let fpsFrameCount = 0, fpsLastUpdate = performance.now();

    function updateHud() {
      if (!hudPanel) return;
      const faceOn = (toggles.face && toggles.face.checked) || (toggles.landmarks && toggles.landmarks.checked);
      const objOn = toggles.objects && toggles.objects.checked;
      const handOn = toggles.hands && toggles.hands.checked;
      const poseOn = toggles.pose && toggles.pose.checked;
      if (!faceOn && !objOn && !handOn && !poseOn) { hudPanel.hidden = true; return; }
      hudPanel.hidden = false;

      const rows = [];
      if (faceOn) {
        const n = cache.face.length;
        let detail = '\u2014';
        if (n && cache.face[0].expressions) {
          const top = Object.entries(cache.face[0].expressions).sort((a, b) => b[1] - a[1])[0];
          detail = top[0] + ' ' + Math.round(top[1] * 100) + '%';
        }
        rows.push('<div class="webcam-hud-row"><span class="webcam-hud-label">FACE</span><span class="webcam-hud-count">' + n + '</span><span class="webcam-hud-detail">' + detail + '</span></div>');
      }
      if (objOn) {
        const n = cache.objects.length;
        const labels = Array.from(new Set(cache.objects.map((o) => o.class))).slice(0, 3).join(', ') || '\u2014';
        rows.push('<div class="webcam-hud-row"><span class="webcam-hud-label">OBJ</span><span class="webcam-hud-count">' + n + '</span><span class="webcam-hud-detail">' + labels + '</span></div>');
      }
      if (handOn) {
        const n = cache.hands.length;
        const sides = cache.hands.map((h) => h.handedness || '').filter(Boolean).join('/') || '\u2014';
        rows.push('<div class="webcam-hud-row"><span class="webcam-hud-label">HAND</span><span class="webcam-hud-count">' + n + '</span><span class="webcam-hud-detail">' + sides + '</span></div>');
      }
      if (poseOn) {
        const n = cache.pose.length;
        let conf = '\u2014';
        if (n) {
          const scores = cache.pose[0].keypoints.map((k) => k.score || 0);
          conf = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) + '%';
        }
        rows.push('<div class="webcam-hud-row"><span class="webcam-hud-label">POSE</span><span class="webcam-hud-count">' + n + '</span><span class="webcam-hud-detail">' + conf + '</span></div>');
      }
      if (hudRows) hudRows.innerHTML = rows.join('');
    }

    // Shows/hides the filter picker and the two puppeteering panels to
    // match whichever toggles are actually on right now — checked every
    // frame (like updateHud) so it stays correct no matter what changed
    // the toggle state (user click, a load error un-checking it, etc).
    // Hands drives the 3D model-viewer puppet; Body Pose drives the
    // jointed rig instead — two different characters, two different
    // tracking sources, two different panels.
    function updatePanels() {
      if (filtersEl) filtersEl.hidden = !(toggles.landmarks && toggles.landmarks.checked);
      if (puppetEl) puppetEl.hidden = !(toggles.hands && toggles.hands.checked);
      if (rigEl) rigEl.hidden = !(toggles.pose && toggles.pose.checked);
      if (puppetLoadingEl) puppetLoadingEl.hidden = puppetEl.hidden || puppetModelLoaded;
      if (rigLoadingEl) rigLoadingEl.hidden = rigEl.hidden || rigReady;
    }

    // Whichever hand keypoint is driving the model-viewer puppet's camera
    // right now. Shared by updatePuppet() (moves the camera) and
    // drawPuppetIndicator() (marks it visibly in the webcam view) so the
    // two can never disagree about where "the control point" actually is.
    function getPuppetControlPoint() {
      if (!puppetEl || puppetEl.hidden || !cache.hands || !cache.hands.length) return null;
      const hand = cache.hands[0];
      const rawX = hand.keypoints.reduce((s, k) => s + k.x, 0) / hand.keypoints.length;
      const py = hand.keypoints.reduce((s, k) => s + k.y, 0) / hand.keypoints.length;
      return { x: mirrorX(rawX, 0), y: py };
    }

    // Pinch (thumb tip to index fingertip) drives zoom — only available
    // from hand tracking, not pose, since pose doesn't resolve individual
    // fingers. Distance is normalized against the hand's own palm length
    // (wrist to middle-finger knuckle) so it stays meaningful regardless
    // of how close the hand is to the camera.
    function getPuppetPinch() {
      if (!puppetEl || puppetEl.hidden || !cache.hands || !cache.hands.length) return null;
      const kp = cache.hands[0].keypoints;
      const thumb = kp[4], index = kp[8], wrist = kp[0], palmRef = kp[9];
      if (!thumb || !index || !wrist || !palmRef) return null;
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const palmSize = dist(wrist, palmRef) || 1;
      return {
        thumb: { x: mirrorX(thumb.x, 0), y: thumb.y },
        index: { x: mirrorX(index.x, 0), y: index.y },
        ratio: dist(thumb, index) / palmSize,
      };
    }

    function updatePuppet() {
      if (!puppetViewer) return;
      const pt = getPuppetControlPoint();
      if (!pt) return;
      const normX = Math.min(1, Math.max(0, pt.x / overlay.width));
      const normY = Math.min(1, Math.max(0, pt.y / overlay.height));
      // Flipped from (normX - 0.5): moving your hand toward one side of
      // the frame now orbits the camera the other way around, which
      // matches how it's meant to feel — reverse this back if it now
      // feels backwards instead.
      const theta = (0.5 - normX) * 360;
      const phi = Math.min(115, Math.max(45, 70 + (normY - 0.5) * 70));

      let radiusStr = 'auto';
      const pinch = getPuppetPinch();
      if (pinch && puppetDefaultRadius) {
        const zoom = Math.min(1.6, Math.max(0.4, pinch.ratio));
        radiusStr = (puppetDefaultRadius * zoom).toFixed(2) + 'm';
      }
      puppetViewer.cameraOrbit = theta.toFixed(1) + 'deg ' + phi.toFixed(1) + 'deg ' + radiusStr;
    }

    // A pulsing crosshair + label right on the tracked point, so it's
    // obvious in the webcam view itself which hand/wrist is actually
    // steering the 3D model rather than that connection being invisible.
    // When hands are on, also draws the thumb–index pinch line so the
    // zoom gesture itself is visible, not just its effect on the model.
    function drawPuppetIndicator() {
      const pt = getPuppetControlPoint();
      if (!pt) return;
      const pulse = 2 * Math.sin(performance.now() / 260);
      const r = 16 + pulse;
      ctx.save();
      ctx.strokeStyle = '#E879F9'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pt.x - r - 8, pt.y); ctx.lineTo(pt.x - r + 4, pt.y);
      ctx.moveTo(pt.x + r - 4, pt.y); ctx.lineTo(pt.x + r + 8, pt.y);
      ctx.moveTo(pt.x, pt.y - r - 8); ctx.lineTo(pt.x, pt.y - r + 4);
      ctx.moveTo(pt.x, pt.y + r - 4); ctx.lineTo(pt.x, pt.y + r + 8);
      ctx.stroke();

      const label = '🎮 controlling model';
      ctx.font = '11px monospace';
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(3,8,17,.85)';
      ctx.fillRect(pt.x - textW / 2 - 5, pt.y + r + 10, textW + 10, 18);
      ctx.fillStyle = '#E879F9';
      ctx.textAlign = 'center';
      ctx.fillText(label, pt.x, pt.y + r + 23);
      ctx.textAlign = 'left';
      ctx.restore();

      const pinch = getPuppetPinch();
      if (pinch) {
        ctx.save();
        ctx.strokeStyle = '#7DD3FC'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pinch.thumb.x, pinch.thumb.y);
        ctx.lineTo(pinch.index.x, pinch.index.y);
        ctx.stroke();
        ctx.fillStyle = '#7DD3FC';
        [pinch.thumb, pinch.index].forEach((p) => {
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
        });
        const midX = (pinch.thumb.x + pinch.index.x) / 2;
        const midY = (pinch.thumb.y + pinch.index.y) / 2;
        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(3,8,17,.85)';
        ctx.fillRect(midX - 18, midY - 20, 36, 15);
        ctx.fillStyle = '#7DD3FC';
        ctx.textAlign = 'center';
        ctx.fillText('zoom', midX, midY - 9);
        ctx.textAlign = 'left';
        ctx.restore();
      }
    }

    // Drives the rig's actual joint rotations from MoveNet's 2D keypoints
    // and renders the scene. MoveNet only reports x/y (no depth), so this
    // is honestly a 2D-plane retargeting — each limb's rotation is the
    // angle it makes in the camera image, applied as a single rotation
    // around the screen-facing axis. That's enough to genuinely track
    // "arm raised, elbow bent, leg lifted" in real time; it won't capture
    // motion toward/away from the camera, since a single 2D camera view
    // can't recover that on its own.
    //
    // No left/right swap needed here: the webcam view is already
    // CSS-mirrored (scaleX(-1)) to feel like a normal selfie mirror, and
    // mirrorX() re-projects MoveNet's raw coordinates to match that —
    // so "right_wrist" already lands on the right side of the screen.
    function updateRig() {
      if (!rigReady || !rigChar || !rigRenderer || !rigEl || rigEl.hidden) return;
      const pose = cache.pose && cache.pose[0];
      if (pose) {
        const byName = {};
        pose.keypoints.forEach((k) => { byName[k.name] = k; });
        const pt = (name) => {
          const k = byName[name];
          if (!k || (k.score || 0) < 0.3) return null;
          return { x: mirrorX(k.x, 0), y: k.y };
        };
        const angleOf = (a, b) => (a && b) ? Math.atan2(b.x - a.x, b.y - a.y) : null;

        function applyLimb(shoulderPivot, elbowPivot, shoulderPt, elbowPt, wristPt) {
          const upperAngle = angleOf(shoulderPt, elbowPt);
          if (upperAngle !== null) shoulderPivot.rotation.z = upperAngle;
          const lowerAngle = angleOf(elbowPt, wristPt);
          if (upperAngle !== null && lowerAngle !== null) elbowPivot.rotation.z = lowerAngle - upperAngle;
        }
        // Direct mapping, no swap: the video is already CSS-mirrored
        // (scaleX(-1)) to feel like a normal selfie mirror, and mirrorX()
        // re-projects MoveNet's raw coordinates to match that already-
        // mirrored display. That means "right_wrist" already lands on the
        // right side of the screen — swapping it here would just cancel
        // that back out and put controls on the wrong side.
        applyLimb(rigChar.rightArm.shoulderPivot, rigChar.rightArm.elbowPivot,
          pt('right_shoulder'), pt('right_elbow'), pt('right_wrist'));
        applyLimb(rigChar.leftArm.shoulderPivot, rigChar.leftArm.elbowPivot,
          pt('left_shoulder'), pt('left_elbow'), pt('left_wrist'));
        applyLimb(rigChar.rightLeg.hipPivot, rigChar.rightLeg.kneePivot,
          pt('right_hip'), pt('right_knee'), pt('right_ankle'));
        applyLimb(rigChar.leftLeg.hipPivot, rigChar.leftLeg.kneePivot,
          pt('left_hip'), pt('left_knee'), pt('left_ankle'));
      }
      rigRenderer.render(rigScene, rigCamera);
    }

    // Rendering and inference are deliberately decoupled. Inference (face,
    // objects, hands, pose) is comparatively slow — tens to hundreds of ms
    // per cycle — and running clearRect+draw only after each slow await
    // resolved meant every result was only actually painted for about one
    // frame before being cleared again, making it flicker in and out far
    // too fast to reliably see. The render loop below repaints the latest
    // cached results on every animation frame regardless of whether
    // inference has produced anything new since the last paint; the
    // inference loop below that just keeps `cache` updated in the
    // background at whatever pace the models can manage.
    function renderLoop() {
      if (!running) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      try { drawFace(); } catch (err) { console.error('[webcam-ai] drawFace failed:', err); }
      try { drawObjects(); } catch (err) { console.error('[webcam-ai] drawObjects failed:', err); }
      try { drawHands(); } catch (err) { console.error('[webcam-ai] drawHands failed:', err); }
      try { drawPose(); } catch (err) { console.error('[webcam-ai] drawPose failed:', err); }
      try { drawPuppetIndicator(); } catch (err) { console.error('[webcam-ai] drawPuppetIndicator failed:', err); }

      fpsFrameCount++;
      const now = performance.now();
      if (now - fpsLastUpdate >= 500) {
        if (hudFps) hudFps.textContent = Math.round((fpsFrameCount * 1000) / (now - fpsLastUpdate));
        fpsFrameCount = 0;
        fpsLastUpdate = now;
      }
      try { updateHud(); } catch (err) { console.error('[webcam-ai] updateHud failed:', err); }
      try { updatePanels(); } catch (err) { console.error('[webcam-ai] updatePanels failed:', err); }
      try { updatePuppet(); } catch (err) { console.error('[webcam-ai] updatePuppet failed:', err); }
      try { updateRig(); } catch (err) { console.error('[webcam-ai] updateRig failed:', err); }

      // However bad this frame was, there's always a next one — the loop
      // itself must never die from a single frame's failure.
      rafId = requestAnimationFrame(renderLoop);
    }

    function nextFrame() { return new Promise((resolve) => requestAnimationFrame(resolve)); }

    async function inferenceLoop() {
      while (running) {
        if (video.readyState < 2) { await nextFrame(); continue; }

        const faceWanted = (toggles.face && toggles.face.checked) || (toggles.landmarks && toggles.landmarks.checked);
        if (faceWanted && faceApiReady) {
          try {
            let query = faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }));
            if (toggles.landmarks && toggles.landmarks.checked && landmarksReady) query = query.withFaceLandmarks();
            query = query.withFaceExpressions();
            cache.face = await query;
          } catch (err) { console.error('[webcam-ai] face detection failed:', err); }
        } else {
          cache.face = [];
        }

        if (toggles.objects && toggles.objects.checked && cocoModel) {
          try {
            cache.objects = await cocoModel.detect(video);
          } catch (err) { console.error('[webcam-ai] objects detection failed:', err); }
        } else {
          cache.objects = [];
        }

        if (toggles.hands && toggles.hands.checked && handDetector) {
          try {
            cache.hands = await handDetector.estimateHands(video);
          } catch (err) { console.error('[webcam-ai] hands detection failed:', err); }
        } else {
          cache.hands = [];
        }

        if (toggles.pose && toggles.pose.checked && poseDetector) {
          try {
            cache.pose = await poseDetector.estimatePoses(video);
          } catch (err) { console.error('[webcam-ai] pose detection failed:', err); }
        } else {
          cache.pose = [];
        }

        // Yield to the browser between inference cycles instead of hammering
        // it back-to-back with zero gap.
        await nextFrame();
      }
    }

    renderLoop();
    inferenceLoop();
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    video.srcObject = null;
    placeholder.hidden = false;
    stopBtn.hidden = true;
    startBtn.disabled = false;
    if (flipBtn) flipBtn.hidden = true;
    if (hudPanel) hudPanel.hidden = true;
    if (hudFps) hudFps.textContent = '--';
    if (filtersEl) filtersEl.hidden = true;
    if (puppetEl) puppetEl.hidden = true;
    if (rigEl) rigEl.hidden = true;
    if (pillText) pillText.textContent = 'IDLE';
    if (statEl) statEl.innerHTML = 'faces detected: <strong>0</strong>';
    announce('');
  }

  async function flipCamera() {
    if (!running) return;
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    // The back camera isn't mirrored — mirroring only makes sense for a
    // "look at yourself" front-facing feed, and detection boxes need to
    // track whichever way the raw frame actually reads.
    mirrored = facingMode === 'user';
    video.style.transform = mirrored ? '' : 'none';
    if (window.setCursorBusy) window.setCursorBusy(true);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360, facingMode: { ideal: facingMode } }, audio: false });
      video.srcObject = stream;
      video.addEventListener('loadedmetadata', syncSize, { once: true });
      await video.play();
      syncSize();
    } catch (err) {
      console.error('[webcam-ai] camera flip failed:', err);
      // Couldn't get the other camera — flip the state back so the UI
      // stays consistent with whatever's actually still running.
      facingMode = facingMode === 'user' ? 'environment' : 'user';
      mirrored = facingMode === 'user';
      video.style.transform = mirrored ? '' : 'none';
    } finally {
      if (window.setCursorBusy) window.setCursorBusy(false);
    }
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  if (flipBtn) flipBtn.addEventListener('click', flipCamera);
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) stop(); });
})();
