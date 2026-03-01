// ── Chord Detector — app.js ──────────────────────────────────────────────────

'use strict';

// ── Music constants ──────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Each entry: [display suffix, intervals as pitch-class offsets from root]
const CHORD_TYPES = [
  ['',      [0, 4, 7]],          // Major
  ['m',     [0, 3, 7]],          // Minor
  ['7',     [0, 4, 7, 10]],      // Dominant 7th
  ['maj7',  [0, 4, 7, 11]],      // Major 7th
  ['m7',    [0, 3, 7, 10]],      // Minor 7th
  ['dim',   [0, 3, 6]],          // Diminished
  ['dim7',  [0, 3, 6, 9]],       // Diminished 7th
  ['m7b5',  [0, 3, 6, 10]],      // Half-diminished
  ['aug',   [0, 4, 8]],          // Augmented
  ['sus2',  [0, 2, 7]],          // Sus2
  ['sus4',  [0, 5, 7]],          // Sus4
  ['6',     [0, 4, 7, 9]],       // Major 6th
  ['m6',    [0, 3, 7, 9]],       // Minor 6th
  ['add9',  [0, 2, 4, 7]],       // Add9
  ['5',     [0, 7]],             // Power chord
];

// Build the full library of 180 chords
const CHORD_LIBRARY = [];
for (const [suffix, intervals] of CHORD_TYPES) {
  for (let root = 0; root < 12; root++) {
    const pitchClasses = new Set(intervals.map(i => (root + i) % 12));
    CHORD_LIBRARY.push({ name: NOTE_NAMES[root] + suffix, pitchClasses, intervals });
  }
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const startBtn       = document.getElementById('startBtn');
const stopBtn        = document.getElementById('stopBtn');
const sensitivityEl  = document.getElementById('sensitivity');
const sensitivityVal = document.getElementById('sensitivityVal');
const statusText     = document.getElementById('statusText');
const chordNameEl    = document.getElementById('chordName');
const chordNotesEl   = document.getElementById('chordNotes');
const confidenceEl   = document.getElementById('confidenceLabel');
const historyEl      = document.getElementById('chordHistory');
const canvas         = document.getElementById('spectrum');
const ctx2d          = canvas.getContext('2d');
const noteBubbles    = {};
document.querySelectorAll('.note-bubble').forEach(el => {
  noteBubbles[el.dataset.note] = el;
});

// ── State ────────────────────────────────────────────────────────────────────

let audioCtx      = null;
let analyser      = null;
let micStream     = null;
let rafId         = null;
let threshold     = parseFloat(sensitivityEl.value);
let lastChord     = '';
let chordHistory  = [];
const MAX_HISTORY = 20;

// ── Sensitivity slider ───────────────────────────────────────────────────────

sensitivityEl.addEventListener('input', () => {
  threshold = parseFloat(sensitivityEl.value);
  sensitivityVal.textContent = `${threshold} dB`;
});

// ── Start / Stop ─────────────────────────────────────────────────────────────

startBtn.addEventListener('click', async () => {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    analyser  = audioCtx.createAnalyser();
    analyser.fftSize = 16384;           // ~2.7 Hz/bin @ 44100 Hz
    analyser.smoothingTimeConstant = 0.75;

    const source = audioCtx.createMediaStreamSource(micStream);
    source.connect(analyser);

    startBtn.disabled = true;
    stopBtn.disabled  = false;
    setStatus('Listening… play something!', 'active');
    loop();
  } catch (err) {
    setStatus(`Microphone error: ${err.message}`, 'error');
  }
});

stopBtn.addEventListener('click', () => {
  cleanup();
  setStatus('Stopped — press Start Listening to try again');
});

function cleanup() {
  if (rafId)      { cancelAnimationFrame(rafId); rafId = null; }
  if (micStream)  { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx)   { audioCtx.close(); audioCtx = null; }
  analyser = null;
  startBtn.disabled = false;
  stopBtn.disabled  = true;
  clearNotes();
  chordNameEl.textContent = '—';
  chordNotesEl.textContent = '';
  confidenceEl.textContent = '';
}

// ── Main analysis loop ───────────────────────────────────────────────────────

function loop() {
  if (!analyser) return;
  rafId = requestAnimationFrame(loop);

  const bufLen   = analyser.frequencyBinCount;        // fftSize / 2
  const freqData = new Float32Array(bufLen);
  analyser.getFloatFrequencyData(freqData);            // values in dB

  const sampleRate = audioCtx.sampleRate;
  const fftSize    = analyser.fftSize;

  // 1. Build per-pitch-class energy (max across octaves C2–C7)
  const pcEnergy = computePitchClassEnergies(freqData, sampleRate, fftSize);

  // 2. Find noise floor (median of 12 pitch class energies)
  const sorted    = [...pcEnergy].filter(e => isFinite(e)).sort((a, b) => a - b);
  const noiseFloor = sorted.length ? sorted[Math.floor(sorted.length * 0.3)] : -90;
  const cutoff     = Math.max(threshold, noiseFloor + 12);  // at least 12 dB above floor

  // 3. Determine which pitch classes are active
  const activeSet = new Set();
  for (let pc = 0; pc < 12; pc++) {
    if (pcEnergy[pc] >= cutoff) activeSet.add(pc);
  }

  // 4. Update note bubbles
  updateNoteBubbles(activeSet);

  // 5. Detect chord
  if (activeSet.size >= 2) {
    const { name, confidence, noteNames } = detectChord(activeSet, pcEnergy);
    updateChordDisplay(name, confidence, noteNames);
  } else {
    chordNameEl.textContent = '—';
    chordNotesEl.textContent = '';
    confidenceEl.textContent = '';
  }

  // 6. Draw spectrum
  drawSpectrum(freqData, sampleRate, fftSize, activeSet, cutoff);
}

// ── Pitch-class energy from FFT data ─────────────────────────────────────────

function computePitchClassEnergies(freqData, sampleRate, fftSize) {
  const pcLinear = new Float64Array(12).fill(0);   // sum of linear power

  // Analyse C2 (MIDI 36) through C7 (MIDI 84)
  for (let midi = 36; midi <= 84; midi++) {
    const pc      = midi % 12;
    const fCenter = midiToHz(midi);
    const fLow    = fCenter * Math.pow(2, -1 / 24);
    const fHigh   = fCenter * Math.pow(2,  1 / 24);

    const binLow  = Math.max(1, Math.round(fLow  * fftSize / sampleRate));
    const binHigh = Math.min(freqData.length - 1, Math.round(fHigh * fftSize / sampleRate));

    let sum = 0;
    let n   = 0;
    for (let b = binLow; b <= binHigh; b++) {
      // freqData is in dB (negative) – convert to linear power
      sum += Math.pow(10, freqData[b] / 10);
      n++;
    }
    if (n > 0) pcLinear[pc] += sum / n;
  }

  // Convert summed linear power back to dB
  return pcLinear.map(v => (v > 0 ? 10 * Math.log10(v) : -Infinity));
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── Chord matching ────────────────────────────────────────────────────────────

function detectChord(activeSet, pcEnergy) {
  let bestScore = -Infinity;
  let best      = null;

  for (const chord of CHORD_LIBRARY) {
    const score = scoreChord(activeSet, chord);
    if (score > bestScore) {
      bestScore = score;
      best      = chord;
    }
  }

  // Confidence: 0–100 (based on F-score-like measure)
  const confidence = Math.round(Math.min(100, bestScore * 100));

  // Note names of the matched chord
  const noteNames = [...best.pitchClasses]
    .sort((a, b) => a - b)
    .map(pc => NOTE_NAMES[pc])
    .join(' – ');

  return { name: best.name, confidence, noteNames };
}

/**
 * Score how well a set of active pitch classes matches a chord.
 * Returns a value in [0, 1].
 */
function scoreChord(detectedSet, chord) {
  const chordPCs = chord.pitchClasses;

  let hits = 0;
  for (const pc of chordPCs) if (detectedSet.has(pc)) hits++;
  if (hits === 0) return 0;

  // Power chords need extra caution — require at least the root + 5th
  if (chordPCs.size === 2 && hits < 2) return 0;

  const recall    = hits / chordPCs.size;                      // how many chord tones heard
  const extra     = [...detectedSet].filter(pc => !chordPCs.has(pc)).length;
  const precision = hits / (hits + extra);                     // how few ghost notes

  // Weighted F-score: emphasise recall (prefer full chords over partials)
  const beta = 1.5;
  return ((1 + beta * beta) * precision * recall) /
         (beta * beta * precision + recall + 1e-9);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function updateNoteBubbles(activeSet) {
  for (let pc = 0; pc < 12; pc++) {
    const el = noteBubbles[NOTE_NAMES[pc]];
    if (!el) continue;
    if (activeSet.has(pc)) {
      el.classList.remove('inactive');
      el.classList.add('active');
    } else {
      el.classList.remove('active');
      el.classList.add('inactive');
    }
  }
}

function clearNotes() {
  Object.values(noteBubbles).forEach(el => {
    el.classList.remove('active');
    el.classList.add('inactive');
  });
}

function updateChordDisplay(name, confidence, noteNames) {
  if (!name) return;

  chordNameEl.textContent  = name;
  chordNotesEl.textContent = noteNames;
  confidenceEl.textContent = `${confidence}% match`;

  // Add to history only if chord changed and confidence is reasonable
  if (name !== lastChord && confidence >= 45) {
    lastChord = name;
    pushHistory(name);
  }
}

function pushHistory(name) {
  chordHistory.unshift(name);
  if (chordHistory.length > MAX_HISTORY) chordHistory.pop();

  // Rebuild history chips
  historyEl.innerHTML = '';
  chordHistory.forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'history-chip';
    chip.textContent = c;
    historyEl.appendChild(chip);
  });
}

function setStatus(msg, cls = '') {
  statusText.textContent = msg;
  statusText.className   = cls;
}

// ── Spectrum visualiser ───────────────────────────────────────────────────────

function drawSpectrum(freqData, sampleRate, fftSize, activeSet, cutoff) {
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width  = W;
    canvas.height = H;
  }

  const c = ctx2d;
  c.clearRect(0, 0, W, H);

  // Draw frequency bars (20 Hz – 4000 Hz on a log scale)
  const fMin = 20, fMax = 4000;
  const logMin = Math.log10(fMin), logMax = Math.log10(fMax);

  // Draw bars
  const barW = Math.max(1, W / 200);
  for (let i = 0; i < 200; i++) {
    const logF = logMin + (i / 200) * (logMax - logMin);
    const freq  = Math.pow(10, logF);
    const bin   = Math.round(freq * fftSize / sampleRate);
    if (bin >= freqData.length) continue;

    const db  = freqData[bin];
    const dbN = Math.max(0, (db + 100) / 70); // normalise -100...-30 to 0...1
    const bH  = dbN * H;
    const x   = (i / 200) * W;

    // Colour note frequencies specially
    const closestMidi = Math.round(69 + 12 * Math.log2(freq / 440));
    const pc          = ((closestMidi % 12) + 12) % 12;
    const isActive    = activeSet.has(pc);
    c.fillStyle = isActive
      ? `rgba(124,106,247,${0.4 + 0.6 * dbN})`
      : `rgba(74,207,172,${0.15 + 0.4 * dbN})`;

    c.fillRect(x, H - bH, barW, bH);
  }

  // Threshold line
  const threshY = H - Math.max(0, (cutoff + 100) / 70) * H;
  c.strokeStyle = 'rgba(240,106,106,0.4)';
  c.setLineDash([4, 6]);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, threshY);
  c.lineTo(W, threshY);
  c.stroke();
  c.setLineDash([]);
}
