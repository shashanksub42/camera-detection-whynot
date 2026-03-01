// ─── Constants ───────────────────────────────────────────────────────────────
const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_TIPS  = [4, 8, 12, 16, 20];
const FINGER_PIPS  = [3, 6, 10, 14, 18];

// Clone spawn slots: nx = x-offset from center (fraction of W),
//                   ny = y top offset (fraction of H), s = scale
const CLONE_SLOTS = [
  { nx: -0.28, ny: 0.00, s: 0.64 },
  { nx:  0.28, ny: 0.00, s: 0.64 },
  { nx: -0.12, ny: 0.02, s: 0.70 },
  { nx:  0.12, ny: 0.02, s: 0.70 },
  { nx: -0.48, ny:-0.02, s: 0.50 },
  { nx:  0.48, ny:-0.02, s: 0.50 },
  { nx: -0.62, ny:-0.05, s: 0.42 },
  { nx:  0.62, ny:-0.05, s: 0.42 },
  { nx: -0.06, ny: 0.00, s: 0.76 },
  { nx:  0.06, ny: 0.00, s: 0.76 },
  { nx: -0.74, ny:-0.08, s: 0.34 },
  { nx:  0.74, ny:-0.08, s: 0.34 },
  { nx: -0.38, ny: 0.02, s: 0.46 },
  { nx:  0.38, ny: 0.02, s: 0.46 },
  { nx:  0.00, ny:-0.14, s: 0.28 },
];
const MAX_CLONES     = 15;
const CLONE_SPAWN_MS = 200; // ms between each clone popping in

// ─── DOM refs ────────────────────────────────────────────────────────────────
const videoEl       = document.getElementById('input-video');
const canvasEl      = document.getElementById('output-canvas');
const ctx           = canvasEl.getContext('2d');
const handCountEl   = document.getElementById('hand-count');
const fpsCounterEl  = document.getElementById('fps-counter');
const handDetailsEl = document.getElementById('hand-details');

// ─── Browser-compatible rounded rect helper ─────────────────────────────────
function roundedRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y,     x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h,     x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y,         x + r, y);
  c.closePath();
}

const personCanvas = document.createElement('canvas');
const personCtx    = personCanvas.getContext('2d');
let   segMask      = null;  // latest segmentation mask

// ─── Jutsu state ─────────────────────────────────────────────────────────────
let jutsuActive      = false;
let jutsuFlashAlpha  = 0;
let jutsuHoldFrames  = 0;
const JUTSU_THRESHOLD = 8;
let activeClones     = 0;
let lastCloneSpawnMs = 0;

// ─── FPS tracking ────────────────────────────────────────────────────────────
let lastTime   = performance.now();
let frameCount = 0;

function updateFPS() {
  frameCount++;
  const now   = performance.now();
  const delta = now - lastTime;
  if (delta >= 500) {
    fpsCounterEl.textContent = `FPS: ${Math.round((frameCount / delta) * 1000)}`;
    frameCount = 0;
    lastTime   = now;
  }
}

// ─── Finger state helpers ────────────────────────────────────────────────────

/**
 * Determine if each finger is extended (up) or curled (down).
 * @param {Array} landmarks  – array of 21 {x,y,z} objects (normalised 0-1)
 * @param {string} handedness – "Left" or "Right" (as labelled by MediaPipe,
 *                               which is mirrored relative to the real hand)
 * @returns {boolean[]} array of 5 booleans [thumb, index, middle, ring, pinky]
 */
function getFingerStates(landmarks, handedness) {
  const states   = [];
  const thumbTip = landmarks[FINGER_TIPS[0]];
  const thumbPip = landmarks[FINGER_PIPS[0]];
  states.push(handedness === 'Right' ? thumbTip.x < thumbPip.x : thumbTip.x > thumbPip.x);
  for (let i = 1; i < 5; i++) {
    states.push(landmarks[FINGER_TIPS[i]].y < landmarks[FINGER_PIPS[i]].y);
  }
  return states;
}

// ─── Rotation-invariant finger extension check ─────────────────────────────
// Uses tip-to-MCP distance normalised by hand size — works for any wrist rotation.
function isFingerExtended(lm, tipIdx, mcpIdx) {
  const wrist  = lm[0];
  const midMCP = lm[9];
  const handSz = Math.hypot(midMCP.x - wrist.x, midMCP.y - wrist.y);
  if (handSz < 0.01) return false;
  const d = Math.hypot(lm[tipIdx].x - lm[mcpIdx].x, lm[tipIdx].y - lm[mcpIdx].y);
  return (d / handSz) > 0.30;
}
function isFingerCurled(lm, tipIdx, mcpIdx) {
  const wrist  = lm[0];
  const midMCP = lm[9];
  const handSz = Math.hypot(midMCP.x - wrist.x, midMCP.y - wrist.y);
  if (handSz < 0.01) return true;
  const d = Math.hypot(lm[tipIdx].x - lm[mcpIdx].x, lm[tipIdx].y - lm[mcpIdx].y);
  return (d / handSz) < 0.22;
}

// ─── Shadow Clone Jutsu detection ────────────────────────────────────────────
// Sign: ANY detected hand with index + middle extended, ring + pinky curled.
function isShadowCloneSign(allLandmarks, allHandedness) {
  if (!allLandmarks || allLandmarks.length < 1) return false;
  for (let i = 0; i < allLandmarks.length; i++) {
    const lm = allLandmarks[i];
    if (
      isFingerExtended(lm,  8, 5) &&   // index extended
      isFingerExtended(lm, 12, 9) &&   // middle extended
      isFingerCurled(lm,   16, 13) &&  // ring curled
      isFingerCurled(lm,   20, 17)     // pinky curled
    ) return true;
  }
  return false;
}

// ─── Person extraction ───────────────────────────────────────────────────────
// Uses the segmentation mask to keep only the person pixels (background = transparent)
function updatePersonCanvas(image, W, H) {
  personCanvas.width  = W;
  personCanvas.height = H;
  personCtx.clearRect(0, 0, W, H);
  personCtx.drawImage(image, 0, 0, W, H);
  if (segMask) {
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.drawImage(segMask, 0, 0, W, H);
    personCtx.globalCompositeOperation = 'source-over';
  }
}

// ─── Clone drawing ───────────────────────────────────────────────────────────
// Draws a mirrored, scaled copy of the person only at a given slot position
function drawClone(W, H, slot, alpha) {
  const dw  = W * slot.s;
  const dh  = H * slot.s;
  const cx  = W / 2 + slot.nx * W;   // horizontal center of clone on canvas
  const top = slot.ny * H;            // y top of clone

  // Draw person image (mirrored to match main view)
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx + dw / 2, top);    // anchor at right edge of clone area
  ctx.scale(-1, 1);                   // flip horizontally
  ctx.drawImage(personCanvas, 0, 0, dw, dh);
  ctx.restore();
}

// ─── Jutsu reference box ─────────────────────────────────────────────────────
function drawJutsuBox(W, H, active, holdProgress) {
  const bW = 120, bH = 96;
  const bX  = W / 2 - bW / 2;
  const bY  = H - bH - 10;
  const col = active ? '#88ccff' : '#888888';

  // Panel background
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle   = active ? 'rgba(20,60,200,0.88)' : 'rgba(0,0,0,0.70)';
  ctx.strokeStyle = active ? '#88bbff' : '#444';
  ctx.lineWidth   = active ? 2.5 : 1.5;
  roundedRect(ctx, bX, bY, bW, bH, 9);
  ctx.fill();
  ctx.stroke();

  // Charge progress bar
  if (!active && holdProgress > 0) {
    ctx.fillStyle = 'rgba(80,150,255,0.55)';
    roundedRect(ctx, bX, bY + bH - 5, bW * holdProgress, 5, 3);
    ctx.fill();
  }

  // ── Shadow Clone Seal illustration ─────────────────────────────────────────
  // Left hand (in front):  edge-on, two fingers pointing UPWARD   (vertical)
  // Right hand (behind):   edge-on, two fingers pointing SIDEWAYS (horizontal)
  // Fingers cross perpendicularly in the centre

  const cx = bX + bW / 2;
  const cy = bY + 12 + (bH - 24) / 2; // vertical centre of drawing area

  const fingerLen = 22;  // how long each finger appears
  const fingerGap = 6;   // gap between index and middle on same hand
  const palmW     = 8;   // width of the edge-on palm (very thin since rotated)
  const palmH     = fingerGap + 8;

  ctx.globalAlpha = active ? 1.0 : 0.60;
  ctx.strokeStyle = col;
  ctx.fillStyle   = col;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  // —— RIGHT hand (behind): two fingers pointing LEFT→RIGHT (horizontal) ——
  // Draw first so left hand appears in front
  const rBase = cx + 4;   // horizontal start of right-hand fingers (palm side)
  const rY1   = cy - fingerGap / 2;
  const rY2   = cy + fingerGap / 2;

  // Palm stub — edge-on so it's a thin vertical rect
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = active ? 0.65 : 0.38;
  roundedRect(ctx, rBase - palmW / 2, cy - palmH / 2, palmW, palmH, 3);
  ctx.stroke();

  // Two fingers going right
  ctx.lineWidth = 3;
  ctx.globalAlpha = active ? 0.90 : 0.55;
  ctx.beginPath(); ctx.moveTo(rBase, rY1); ctx.lineTo(rBase + fingerLen, rY1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rBase, rY2); ctx.lineTo(rBase + fingerLen, rY2); ctx.stroke();
  // Fingertips
  ctx.globalAlpha = active ? 1.0 : 0.60;
  ctx.beginPath(); ctx.arc(rBase + fingerLen + 1, rY1, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(rBase + fingerLen + 1, rY2, 2, 0, Math.PI * 2); ctx.fill();
  // Curled fingers hint (bumps going right from palm bottom)
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = active ? 0.38 : 0.22;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(rBase - palmW / 2 - 4, cy - palmH / 2 + 4 + k * 5, 2.5, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
  }

  // —— LEFT hand (in front): two fingers pointing UP (vertical) ——
  const lBaseY = cy + 6;  // bottom anchor of left-hand fingers (palm side)
  const lX1    = cx - fingerGap / 2;
  const lX2    = cx + fingerGap / 2;

  // Palm stub — edge-on so it's a thin horizontal rect
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = active ? 0.65 : 0.38;
  roundedRect(ctx, cx - palmH / 2, lBaseY - palmW / 2, palmH, palmW, 3);
  ctx.stroke();

  // Two fingers going up
  ctx.lineWidth = 3;
  ctx.globalAlpha = active ? 0.90 : 0.55;
  ctx.beginPath(); ctx.moveTo(lX1, lBaseY); ctx.lineTo(lX1, lBaseY - fingerLen); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(lX2, lBaseY); ctx.lineTo(lX2, lBaseY - fingerLen); ctx.stroke();
  // Fingertips
  ctx.globalAlpha = active ? 1.0 : 0.60;
  ctx.beginPath(); ctx.arc(lX1, lBaseY - fingerLen - 1, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(lX2, lBaseY - fingerLen - 1, 2, 0, Math.PI * 2); ctx.fill();
  // Curled fingers hint (bumps going down from palm bottom)
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = active ? 0.38 : 0.22;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(cx - palmH / 2 + 4 + k * 5, lBaseY + palmW / 2 + 4, 2.5, 0, Math.PI);
    ctx.stroke();
  }

  // Glow dot at the crossing point
  ctx.globalAlpha = active ? 1.0 : 0.45;
  ctx.fillStyle   = active ? '#ffffff' : col;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.globalAlpha = active ? 1 : 0.50;
  ctx.fillStyle   = active ? '#ffffff' : '#999';
  ctx.font        = 'bold 8.5px sans-serif';
  ctx.textAlign   = 'center';
  ctx.fillText('SHADOW CLONE SEAL', cx, bY + bH - 7);
  ctx.restore();
}

/**
 * Count raised fingers and return a simple gesture label.
 */
function getGestureLabel(states) {
  const count = states.filter(Boolean).length;
  if (states.every(s => !s))  return '✊ Fist';
  if (states.every(s => s))   return '🖐 Open Hand';
  if (!states[0] && states[1] && !states[2] && !states[3] && !states[4]) return '☝️ Pointing';
  if (!states[0] && states[1] && states[2] && !states[3] && !states[4]) return '🫰 Clone Seal!';
  if (states[0]  && states[1] && !states[2] && !states[3] && !states[4]) return '🤙 Call Me';
  if (!states[0] && states[1] && states[2] && states[3] && states[4])    return '🤟 Four Fingers';
  return `${count} finger${count !== 1 ? 's' : ''} up`;
}

// ─── Result rendering ────────────────────────────────────────────────────────
function renderHandCards(results) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    handDetailsEl.innerHTML = '';
    return;
  }
  let html = '';
  results.multiHandLandmarks.forEach((landmarks, i) => {
    const handLabel    = results.multiHandedness[i].label;
    const states       = getFingerStates(landmarks, handLabel);
    const gesture      = getGestureLabel(states);
    const displayLabel = handLabel === 'Right' ? 'Left Hand' : 'Right Hand';
    html += `<div class="hand-card">
      <h3>${displayLabel}</h3>
      <p style="margin-bottom:8px;font-size:1rem;">${gesture}</p>`;
    FINGER_NAMES.forEach((name, fi) => {
      html += `<div class="finger-row">
        <span class="finger-name">${name}</span>
        <span class="finger-state ${states[fi] ? 'up' : 'down'}">${states[fi] ? 'Up' : 'Down'}</span>
      </div>`;
    });
    html += `</div>`;
  });
  handDetailsEl.innerHTML = html;
}

// ─── Main render callback ────────────────────────────────────────────────────
function onResults(results) {
  updateFPS();

  const W = results.image.width;
  const H = results.image.height;
  canvasEl.width  = W;
  canvasEl.height = H;

  // 1. Extract person silhouette every frame (used when clones are active)
  updatePersonCanvas(results.image, W, H);

  // 2. Detect jutsu sign
  const signDetected = isShadowCloneSign(
    results.multiHandLandmarks,
    results.multiHandedness
  );

  if (signDetected) {
    jutsuHoldFrames = Math.min(jutsuHoldFrames + 1, JUTSU_THRESHOLD);
    if (jutsuHoldFrames >= JUTSU_THRESHOLD && !jutsuActive) {
      jutsuActive      = true;
      jutsuFlashAlpha  = 1.0;
      activeClones     = 0;
      lastCloneSpawnMs = performance.now();
    }
  } else {
    jutsuHoldFrames = Math.max(jutsuHoldFrames - 2, 0);
    if (jutsuHoldFrames === 0) {
      jutsuActive  = false;
      activeClones = 0;
    }
  }

  // 3. Tick clone spawning (one new clone every CLONE_SPAWN_MS)
  const now = performance.now();
  if (jutsuActive && activeClones < MAX_CLONES && now - lastCloneSpawnMs >= CLONE_SPAWN_MS) {
    activeClones++;
    lastCloneSpawnMs = now;
  }

  // 4. Draw main background (mirrored camera frame)
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(results.image, 0, 0, W, H);
  ctx.restore();

  // 5. Draw clones on top (person-only, no background)
  for (let i = 0; i < activeClones; i++) {
    drawClone(W, H, CLONE_SLOTS[i], 0.82);
  }

  // 6. Draw hand landmarks on top of everything
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  if (results.multiHandLandmarks) {
    for (const landmarks of results.multiHandLandmarks) {
      drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00d4ff', lineWidth: 2 });
      drawLandmarks(ctx, landmarks, { color: '#ffffff', fillColor: '#00d4ff', lineWidth: 1, radius: 4 });
    }
  }
  ctx.restore();

  // 7. Chakra flash on activation
  if (jutsuFlashAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = jutsuFlashAlpha * 0.45;
    ctx.fillStyle   = '#1a4aff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    jutsuFlashAlpha = Math.max(0, jutsuFlashAlpha - 0.05);
  }

  // 8. Banner text
  if (jutsuActive) {
    ctx.save();
    ctx.font        = 'bold 36px sans-serif';
    ctx.textAlign   = 'center';
    ctx.lineWidth   = 6;
    ctx.strokeStyle = '#000022';
    ctx.strokeText('影分身の術！', W / 2, 58);
    ctx.fillStyle   = '#88ccff';
    ctx.fillText('影分身の術！', W / 2, 58);
    ctx.font        = 'bold 16px sans-serif';
    ctx.strokeText('Kage Bunshin no Jutsu!', W / 2, 82);
    ctx.fillStyle   = '#ffffff';
    ctx.fillText('Kage Bunshin no Jutsu!', W / 2, 82);
    ctx.restore();
  }

  // 9. Reference symbol box + charge bar
  drawJutsuBox(W, H, jutsuActive, jutsuHoldFrames / JUTSU_THRESHOLD);

  // Update sidebar
  const count = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
  handCountEl.textContent = `Hands detected: ${count}`;
  renderHandCards(results);
}

// ─── MediaPipe Selfie Segmentation ───────────────────────────────────────────
const selfieSegmentation = new SelfieSegmentation({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
});
selfieSegmentation.setOptions({ modelSelection: 1 }); // 1 = landscape model
selfieSegmentation.onResults((segResults) => {
  segMask = segResults.segmentationMask;
});

// ─── MediaPipe Hands setup ────────────────────────────────────────────────────
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.6,
});
hands.onResults(onResults);

// ─── Camera setup ────────────────────────────────────────────────────────────
const camera = new Camera(videoEl, {
  onFrame: async () => {
    // Run hands first (drives the main render loop)
    await hands.send({ image: videoEl });
    // Segmentation is fire-and-forget — a failure/delay must never block the camera
    selfieSegmentation.send({ image: videoEl }).catch(() => {});
  },
  width: 1280,
  height: 720,
});
camera.start().catch((err) => {
  alert(
    'Could not access webcam.\n\nPlease allow camera permissions and reload the page.\n\nError: ' + err.message
  );
});

