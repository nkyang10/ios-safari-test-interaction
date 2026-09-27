// iOS Safari 27.x interaction/ML capability harness.
// Everything runs on-device. No telemetry. Report stays in localStorage for crash forensics.

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

// ---------------------------------------------------------------- report store
const R = {
  meta: {},
  env: {},
  caps: [],
  motion: {},
  camera: {},
  wasm: {},
  webgl: {},
  webgpu: {},
  ml: {},
  probes: {},
};
const STORE_KEY = 'iosbt.lastReport';
const STAGE_KEY = 'iosbt.stage';

function setStage(s) {
  try {
    if (s) sessionStorage.setItem(STAGE_KEY, s);
    else sessionStorage.removeItem(STAGE_KEY);
  } catch (e) { /* private mode */ }
}
function getStage() {
  try { return sessionStorage.getItem(STAGE_KEY); } catch (e) { return null; }
}
function stashReport() {
  try {
    if ($('#auto-store').checked) localStorage.setItem(STORE_KEY, JSON.stringify(R));
  } catch (e) { /* quota */ }
}
function loadStash() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
}

// ---------------------------------------------------------------- ui helpers
const BADGE = { ok: ['b-ok', 'OK'], warn: ['b-warn', 'WARN'], bad: ['b-bad', 'BAD'], na: ['b-na', 'N/A'], info: ['b-info', 'INFO'] };

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function block(outSel, title) {
  const out = $(outSel);
  const wrap = document.createElement('div');
  const h = document.createElement('div');
  h.style.cssText = 'font-weight:700;margin:12px 0 6px;color:#6aa6ff';
  h.textContent = title;
  wrap.appendChild(h);
  out.appendChild(wrap);
  return wrap;
}
function note(parent, text, cls = 'hint') {
  const d = document.createElement('div');
  d.className = cls;
  d.style.margin = '4px 0';
  d.textContent = text;
  parent.appendChild(d);
}
function table(parent, headers, rows) {
  const t = document.createElement('table');
  const thead = document.createElement('tr');
  headers.forEach((hh) => {
    const th = document.createElement('th');
    th.textContent = hh;
    thead.appendChild(th);
  });
  t.appendChild(thead);
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    r.forEach((c, i) => {
      const td = document.createElement('td');
      if (i === 0) td.style.fontWeight = '600';
      if (c && c.nodeType) td.appendChild(c);
      else td.innerHTML = c === null || c === undefined ? '—' : String(c);
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
  parent.appendChild(t);
  return t;
}
function badge(kind, text) {
  const s = document.createElement('span');
  s.className = `badge ${BADGE[kind][0]}`;
  s.textContent = text === undefined ? BADGE[kind][1] : text;
  return s;
}
function kvTable(parent, obj) {
  const rows = Object.entries(obj).map(([k, v]) => {
    if (v && v.nodeType) return [k, v];
    if (typeof v === 'object' && v !== null) return [k, JSON.stringify(v)];
    return [k, v === undefined ? '—' : String(v)];
  });
  return table(parent, ['key', 'value'], rows);
}
function stat(parent, label, value) { return table(parent, [label], [[String(value)]]); }

function verdict(outSel, kind, text) {
  const v = $('#' + outSel);
  v.innerHTML = '';
  v.appendChild(badge(kind));
  v.appendChild(document.createTextNode(' ' + text));
}

// ---------------------------------------------------------------- tabs
$$('#tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    $$('#tabs button').forEach((x) => x.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    b.classList.add('active');
    $('#' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'report') refreshReport();
  });
});

// ---------------------------------------------------------------- motion state
  const M = { streaming: false, zero: { beta: 0, gamma: 0 }, last: null, lastBeta: 0, lastGamma: 0, events: 0, sumInterval: 0, gaps: [], lat: [], raw: null, shakeCount: 0, peakJerk: 0, prevG: null, demo: false };

// ================================================================ 1. ENVIRONMENT
function uaInfo() {
  const ua = navigator.userAgent;
  const m = ua.match(/Version\/([\d.]+)/);
  return {
    ua,
    safariVersion: m ? m[1] : 'unknown',
    platform: navigator.platform || 'unknown',
    vendor: navigator.vendor || '',
    isIOS: /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)),
    isWebView: !/Safari/.test(ua) && /AppleWebKit/.test(ua),
    uaFreezesOS: /OS 1[89]_/.test(ua) ? 'likely (UA shows frozen OS 18_x on iOS 26+)' : 'unknown',
  };
}

async function runEnv() {
  clear($('#env-out'));
  const u = uaInfo();
  R.meta = {
    startedAt: new Date().toISOString(),
    ...u,
    iOSversionManual: $('#iosver').value || null,
    deviceModelManual: $('#devmodel').value || null,
    url: location.href,
    secureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGB: navigator.deviceMemory || null,
    touchPoints: navigator.maxTouchPoints,
    screen: `${screen.width}x${screen.height}@${screen.pixelRatio}x dpr`,
    orientation: screen.orientation ? screen.orientation.type : 'n/a',
    maxTouchPoints: navigator.maxTouchPoints,
  };

  const w = block('#env-out', 'Identity');
  kvTable(w, {
    'Safari version': u.safariVersion,
    'iOS version': R.meta.iOSversionManual || '(fill in manually — UA is frozen on iOS 26+)',
    'Device model': R.meta.deviceModelManual || '(fill in manually)',
    'iOS UA': u.isIOS ? 'yes' : 'no',
    'WebView (no Safari token)': u.isWebView ? 'YES — ' + u.vendor : 'no',
    'User agent': `<code style="word-break:break-all">${u.ua}</code>`,
    'Page URL': `<code style="word-break:break-all">${location.href}</code>`,
    'Timestamp': R.meta.startedAt,
  });

  const s = block('#env-out', 'Runtime environment');
  const audio = await (async () => {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const v = { sampleRate: ac.sampleRate, baseLatency: ac.baseLatency, outputLatency: ac.outputLatency ?? null, state: ac.state };
      ac.close();
      return v;
    } catch (e) { return { error: String(e) }; }
  })();
  R.env.audio = audio;
  kvTable(s, {
    'Secure context (required for motion/camera)': String(window.isSecureContext),
    'crossOriginIsolated (SAB + wasm threads)': String(window.crossOriginIsolated),
    'hardwareConcurrency': navigator.hardwareConcurrency || 'n/a',
    'deviceMemory (GB)': navigator.deviceMemory || 'n/a (not exposed in Safari)',
    'Touch points': navigator.maxTouchPoints,
    'Screen': R.meta.screen,
    'Orientation': R.meta.orientation,
    'AudioContext': audio,
    'Storage estimate': await estStorage(),
  });

  const g = block('#env-out', 'Game-basics quick check');
  const fps = await measureRafHz(1000);
  R.env.rafHz = fps.hz;
  R.env.longTasks = fps.longTasks;
  table(g, ['check', 'value', 'status'], [
    ['requestAnimationFrame rate', fmt(fps.hz, 1) + ' Hz', badge(fps.hz > 90 ? 'warn' : 'ok', fps.hz > 90 ? 'PRO — above 60, verify the Feature Flag' : '60 Hz cap expected')],
    ['Long tasks (>50 ms) in 1 s', fps.longTasks, badge(fps.longTasks === 0 ? 'ok' : 'warn')],
    ['Vibration API', 'navigator.vibrate' in navigator, badge('navigator.vibrate' in navigator ? 'ok' : 'na', 'navigator.vibrate' in navigator ? '' : 'not in Safari')],
    ['Fullscreen API', !!document.documentElement.requestFullscreen, badge(document.documentElement.requestFullscreen ? 'ok' : 'bad')],
    ['Pointer lock', 'requestPointerLock' in Element.prototype, badge('na', 'not in iOS Safari')],
    ['Wake Lock', !!navigator.wakeLock, badge(navigator.wakeLock ? 'ok' : 'bad', navigator.wakeLock ? '' : 'needs 18.4+')],
    ['Gamepad API', 'getGamepads' in navigator, badge('info', 'enumerate in Motion tab')],
  ]);

  R.env.rVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  R.env.offscreen = typeof OffscreenCanvas !== 'undefined';
  stashReport();
  refreshReport();
}

async function estStorage() {
  try {
    const e = await navigator.storage.estimate();
    return `${fmt(e.usage / 1048576, 1)} MB used / ${fmt(e.quota / 1048576, 0)} MB quota`;
  } catch (e) { return 'n/a'; }
}

async function measureRafHz(ms = 1000) {
  let frames = 0, longTasks = 0;
  let po;
  try {
    po = new PerformanceObserver((l) => { longTasks += l.getEntries().length; });
    po.observe({ entryTypes: ['longtask'] });
  } catch (e) { /* longtask unsupported on Safari */ }
  const t0 = now();
  await new Promise((res) => {
    const step = () => { frames++; (now() - t0 < ms) ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  });
  if (po) po.disconnect();
  const elapsed = now() - t0;
  return { hz: (frames / elapsed) * 1000, longTasks, ms: elapsed };
}

// ================================================================ 2. CAPABILITIES
function capRow(name, actual, expect, kind) {
  R.caps.push({ name, actual, expect, status: kind });
  return [name, String(actual), String(expect), badge(kind)];
}

async function runCaps() {
  clear($('#caps-out'));
  R.caps = [];
  const rows = [];
  const u = uaInfo();
  const jspi = 'Suspending' in WebAssembly;
  const has = (k, o) => (o ? (k in o) : false);
  const gl = (() => { try { return document.createElement('canvas').getContext('webgl2'); } catch (e) { return null; } })();

  const push = (name, actual, expect, kind) => rows.push(capRow(name, actual, expect, kind));

  push('User agent', u.safariVersion, '27.x (iOS 27 → Safari 27)', /^27\./.test(u.safariVersion) ? 'ok' : 'warn');
  push('Secure context (HTTPS/localhost)', String(window.isSecureContext), 'true', window.isSecureContext ? 'ok' : 'bad');
  push('devicemotion events', 'DeviceMotionEvent' in window, 'iOS 4.2+', 'DeviceMotionEvent' in window ? 'ok' : 'bad');
  push('DeviceMotionEvent.requestPermission', typeof DeviceMotionEvent?.requestPermission === 'function', 'iOS 14.5+', typeof DeviceMotionEvent?.requestPermission === 'function' ? 'ok' : 'bad');
  push('deviceorientation events', 'DeviceOrientationEvent' in window, 'iOS 4.2+', 'DeviceOrientationEvent' in window ? 'ok' : 'bad');
  push('deviceorientationabsolute (true north)', 'deviceorientationabsolute' in window, 'NOT supported on iOS', 'deviceorientationabsolute' in window ? 'warn' : 'na');
  push('Generic Sensor API (Gyroscope etc.)', 'Gyroscope' in window, 'NOT in Safari', 'Gyroscope' in window ? 'warn' : 'na');
  push('SharedArrayBuffer', typeof SharedArrayBuffer !== 'undefined', '15.2+ (needs isolation)', typeof SharedArrayBuffer !== 'undefined' ? 'ok' : 'bad');
  push('crossOriginIsolated', String(window.crossOriginIsolated), 'true only with COOP+COEP', window.crossOriginIsolated ? 'ok' : 'warn');
  push('WebAssembly SIMD', WebAssembly.validate(SIMD_PROBE()), 'true', WebAssembly.validate(SIMD_PROBE()) ? 'ok' : 'bad');
  push('WebAssembly threads (shared memory)', WebAssembly.validate(new Uint8Array(SHARED_MEM_PROBE())), 'needs isolation', window.crossOriginIsolated ? 'info' : 'na');
  push('WebAssembly JSPI', String(jspi), 'true on Safari 27+', jspi ? 'ok' : 'warn');
  push('navigator.gpu (WebGPU)', 'gpu' in navigator, 'Safari 26+', 'gpu' in navigator ? 'ok' : 'bad');
  push('WebGL2', !!gl, 'true', gl ? 'ok' : 'bad');
  push('EXT_color_buffer_float (WebGL2)', gl ? !!gl.getExtension('EXT_color_buffer_float') : false, 'true', gl && gl.getExtension('EXT_color_buffer_float') ? 'ok' : 'warn');
  push('MediaStreamTrackProcessor', typeof MediaStreamTrackProcessor !== 'undefined', 'Safari 18+ (worker)', typeof MediaStreamTrackProcessor !== 'undefined' ? 'ok' : 'bad');
  push('VideoFrame', typeof VideoFrame !== 'undefined', '16.4+', typeof VideoFrame !== 'undefined' ? 'ok' : 'bad');
  push('OffscreenCanvas', typeof OffscreenCanvas !== 'undefined', 'true', typeof OffscreenCanvas !== 'undefined' ? 'ok' : 'bad');
  push('requestVideoFrameCallback', 'requestVideoFrameCallback' in HTMLVideoElement.prototype, '15.4+', 'requestVideoFrameCallback' in HTMLVideoElement.prototype ? 'ok' : 'bad');
  push('ImageCapture.grabFrame', typeof ImageCapture !== 'undefined' && 'grabFrame' in ImageCapture.prototype, '26+', typeof ImageCapture !== 'undefined' && 'grabFrame' in ImageCapture.prototype ? 'ok' : 'warn');
  push('WebCodecs VideoDecoder', typeof VideoDecoder !== 'undefined', '16.4+', typeof VideoDecoder !== 'undefined' ? 'ok' : 'bad');
  push('Wake Lock', !!navigator.wakeLock, '18.4+', navigator.wakeLock ? 'ok' : 'bad');
  push('WebNN (navigator.ml)', 'ml' in navigator, 'NOT in Safari', 'ml' in navigator ? 'info' : 'na');
  push('BarcodeDetector', 'BarcodeDetector' in window, '17+', 'BarcodeDetector' in window ? 'ok' : 'warn');
  push('getUserMedia', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), 'true', navigator.mediaDevices?.getUserMedia ? 'ok' : 'bad');
  push('Presentation API (2nd screen)', 'Presentation' in window, 'NOT in Safari', 'Presentation' in window ? 'warn' : 'na');
  push('Pointer lock', 'requestPointerLock' in Element.prototype, 'NOT in iOS', 'requestPointerLock' in Element.prototype ? 'warn' : 'na');
  push('Vibration API', 'vibrate' in navigator, 'NOT in iOS', 'vibrate' in navigator ? 'warn' : 'na');
  push('Haptics (Gamepad actuators)', 'hapticActuators' in (navigator.getGamepads?.() || [{}])[0] ? 'maybe' : 'no', 'not in iOS', 'na');
  push('WebXR', 'xr' in navigator, 'visionOS only', 'xr' in navigator ? 'warn' : 'na');
  push('Navigator.gpu.requestAdapter', 'gpu' in navigator ? typeof navigator.gpu.requestAdapter : 'n/a', 'function', 'gpu' in navigator ? 'ok' : 'bad');
  push('MediaRecorder + webm', typeof MediaRecorder !== 'undefined', 'true', typeof MediaRecorder !== 'undefined' ? 'ok' : 'bad');
  push('WebSocket over HTTP/2/3', typeof WebSocket !== 'undefined', '27+ feature', typeof WebSocket !== 'undefined' ? 'ok' : 'bad');
  push('ReadableStream async iteration', 'Symbol' in window, '27+', 'ok');
  push('Service worker', 'serviceWorker' in navigator, 'true', 'serviceWorker' in navigator ? 'ok' : 'warn');

  const w = block('#caps-out', 'Capability matrix');
  table(w, ['capability', 'detected', 'expected on iOS Safari 27.x', ''], rows);
  const bad = R.caps.filter((c) => c.status === 'bad').length;
  note(w, bad === 0 ? 'No blocking gaps for the motion + camera plan.' : `${bad} blocking gap(s) — see the table.`, bad ? 'bad' : 'ok');
  stashReport();
  refreshReport();
}

// tiny wasm probes (no big allocations)
function SIMD_PROBE() {
  // (module (func (result v128) i32.const 0 i32x4.splat))
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 0x60, 0, 1, 0x7b, 3, 2, 1, 0, 10, 8, 1, 6, 0, 0x41, 0, 0xfd, 0x11, 0x0b]);
}
function SHARED_MEM_PROBE() {
  // (module (memory 1 1 shared))
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 3, 1, 1]);
}

// ================================================================ 3. MOTION
async function requestMotion() {
  const out = $('#motion-out');
  clear(out);
  const w = block('#motion-out', 'Permission');
  let res = 'n/a';
  try {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      res = await DeviceMotionEvent.requestPermission();
      try { res = await DeviceOrientationEvent.requestPermission(); } catch (e) { /* ignore */ }
    } else {
      res = 'no requestPermission() — not iOS 14.5+, or an insecure context';
    }
  } catch (e) { res = 'error: ' + e; }
  kvTable(w, {
    'DeviceMotionEvent.requestPermission()': res,
    'Secure context': String(window.isSecureContext),
    'HTTPS': location.protocol,
  });
  const b = badge(res === 'granted' ? 'ok' : 'bad', res === 'granted' ? 'granted' : 'not granted');
  w.appendChild(b);
  if (res === 'granted') {
    $('#btn-motion-run').disabled = false;
    $('#btn-motion-cal').disabled = false;
    $('#btn-motion-demo').disabled = false;
    if (!M.on) startMotionStream();
  }
  R.motion.permission = res;
  stashReport();
}

function startMotionStream() {
  if (M.streaming) return;
  M.streaming = true;
  M.zero = M.zero || { beta: 0, gamma: 0 };
  M.events = 0; M.sumInterval = 0; M.gaps = []; M.lat = []; M.last = null;
  M.shakeCount = 0; M.peakJerk = 0; M.prevG = null;
  window.addEventListener('devicemotion', onMotionData);
}

function stopMotionStream() {
  window.removeEventListener('devicemotion', onMotionData);
  M.streaming = false;
}

function onMotionData(e) {
  const t = now();
  M.events++;
  if (M.last !== null) {
    const d = t - M.last;
    M.sumInterval += e.interval || d;
    M.gaps.push(d);
    M.lat.push(Math.max(0, t - (e.timeStamp || t)));
  }
  M.last = t;
  M.raw = {
    interval: e.interval,
    acceleration: e.acceleration ? { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z } : null,
    accelInclGravity: e.accelerationIncludingGravity ? { x: e.accelerationIncludingGravity.x, y: e.accelerationIncludingGravity.y, z: e.accelerationIncludingGravity.z } : null,
    rotationRate: e.rotationRate ? { alpha: e.rotationRate.alpha, beta: e.rotationRate.beta, gamma: e.rotationRate.gamma } : null,
  };
  if (onMotionData.ui) onMotionData.ui(e);
}

async function runMotionCapture() {
  const secs = 10;
  const out = $('#motion-out');
  clear(out);
  const w = block('#motion-out', `Motion capture (${secs} s)`);
  M.events = 0; M.sumInterval = 0; M.gaps = []; M.lat = [];
  M.last = null;
  const btn = $('#btn-motion-run');
  btn.disabled = true;
  const raf = await measureRafHz(secs * 1000);
  btn.disabled = false;
  const secsActual = raf.ms / 1000;
  const hz = M.events / secsActual;
  const ivals = M.gaps.slice().sort((a, b) => a - b);
  const p = (q) => (ivals.length ? ivals[Math.min(ivals.length - 1, Math.floor(ivals.length * q))] : NaN);
  const lats = M.lat.slice().sort((a, b) => a - b);
  const lat = (q) => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(lats.length * q))] : NaN);

  // shake detection from the last sample stream
  const shakes = M.shakeCount || 0;

  const verdictKind = hz >= 50 ? 'ok' : hz >= 25 ? 'warn' : 'bad';
  table(w, ['metric', 'value', 'target / note'], [
    ['Events received', M.events, '—'],
    ['Event rate', fmt(hz, 1) + ' Hz', badge(verdictKind, hz >= 50 ? 'good for a game' : 'too low')],
    ['Reported e.interval', fmt(M.sumInterval / Math.max(1, M.gaps.length), 2) + ' ms', 'device-reported interval'],
    ['Gap p50 / p90 / max', `${fmt(p(0.5), 1)} / ${fmt(p(0.9), 1)} / ${fmt(ivals[ivals.length - 1], 1)} ms`, 'jitter = stutter risk'],
    ['Handler latency p50 / p90', `${fmt(lat(0.5), 1)} / ${fmt(lat(0.9), 1)} ms`, 'performance.now() − e.timeStamp'],
    ['rAF rate during capture', fmt(raf.hz, 1) + ' Hz', raf.hz > 90 ? 'above 60 — Feature Flag on?' : '60 Hz cap expected'],
    ['Long tasks during capture', raf.longTasks, badge(raf.longTasks === 0 ? 'ok' : 'warn')],
    ['Shakes detected (thresh 18 m/s²)', shakes, 'game-feel check'],
  ]);
  const last = block('#motion-out', 'Last sample');
  kvTable(last, M.raw || { 'no data': 'did devicemotion fire? check permission' });
  R.motion.capture = {
    secs: secsActual, events: M.events, hz,
    gapP50: p(0.5), gapP90: p(0.9), gapMax: ivals[ivals.length - 1],
    latencyP50: lat(0.5), latencyP90: lat(0.9),
    rafHz: raf.hz, longTasks: raf.longTasks, shakes, lastSample: M.raw,
  };
  stashReport();
  refreshReport();
}

// live UI + shake + tilt pad
function attachMotionUI() {
  onMotionData.ui = (e) => {
    const g = e.accelerationIncludingGravity || {};
    const a = e.acceleration || {};
    const rr = e.rotationRate || {};
    const line = document.getElementById('mlive');
    if (line) {
      line.textContent = `a(${fmt(a.x, 2)}, ${fmt(a.y, 2)}, ${fmt(a.z, 2)})  g(${fmt(g.x, 1)}, ${fmt(g.y, 1)}, ${fmt(g.z, 1)})  rot(${fmt(rr.alpha, 1)}, ${fmt(rr.beta, 1)}, ${fmt(rr.gamma, 1)})  ${M.events} ev`;
    }
    // shake: jerk magnitude of g
    if (M.prevG) {
      const d = Math.hypot(g.x - M.prevG.x, g.y - M.prevG.y, g.z - M.prevG.z);
      M.peakJerk = Math.max(M.peakJerk || 0, d);
      if (d > 18) { M.shakeCount = (M.shakeCount || 0) + 1; M.lastJerk = d; }
    }
    M.prevG = { x: g.x, y: g.y, z: g.z };

    if (M.demo) {
      const beta = (M.lastBeta || 0) - (M.zero?.beta || 0);
      const gamma = (M.lastGamma || 0) - (M.zero?.gamma || 0);
      const ball = $('#tiltball');
      ball.style.transform = `translate(${Math.max(-70, Math.min(70, gamma * 1.2))}px, ${Math.max(-70, Math.min(70, beta * 1.2))}px)`;
    }
  };
}

function attachMotionUI() {
  onMotionData.ui = (e) => {
    const g = e.accelerationIncludingGravity || {};
    const a = e.acceleration || {};
    const rr = e.rotationRate || {};
    const line = document.getElementById('mlive');
    if (line) {
      line.textContent = `a(${fmt(a.x, 2)}, ${fmt(a.y, 2)}, ${fmt(a.z, 2)})  g(${fmt(g.x, 1)}, ${fmt(g.y, 1)}, ${fmt(g.z, 1)})  rot(${fmt(rr.alpha, 1)}, ${fmt(rr.beta, 1)}, ${fmt(rr.gamma, 1)})  ${M.events} ev`;
    }
    // shake: jerk magnitude of the gravity vector
    if (M.prevG) {
      const d = Math.hypot(g.x - M.prevG.x, g.y - M.prevG.y, g.z - M.prevG.z);
      M.peakJerk = Math.max(M.peakJerk || 0, d);
      if (d > 18) { M.shakeCount = (M.shakeCount || 0) + 1; M.lastJerk = d; }
    }
    M.prevG = { x: g.x, y: g.y, z: g.z };
  };
  // deviceorientation is handled separately so it never pollutes devicemotion stats
  window.addEventListener('deviceorientation', (e) => {
    M.lastBeta = e.beta; M.lastGamma = e.gamma;
    if (M.demo) {
      const beta = (e.beta || 0) - (M.zero?.beta || 0);
      const gamma = (e.gamma || 0) - (M.zero?.gamma || 0);
      const ball = $('#tiltball');
      ball.style.transform = `translate(${Math.max(-70, Math.min(70, gamma * 1.2))}px, ${Math.max(-70, Math.min(70, beta * 1.2))}px)`;
    }
  });
}

function calibrate() {
  const h = block('#motion-out', 'Calibration');
  note(h, 'Hold the device in your neutral play position, then tap Zero tilt.', 'hint');
  M.zero = M.zero || { beta: 0, gamma: 0 };
  M.zero.beta = M.lastBeta || 0;
  M.zero.gamma = M.lastGamma || 0;
  note(h, `Zero point: beta=${fmt(M.zero.beta, 1)}° gamma=${fmt(M.zero.gamma, 1)}°`, 'ok');
  R.motion.zero = M.zero;
  stashReport();
}

// ================================================================ 4. CAMERA
let camStream = null, camTrack = null;

async function startCamera() {
  const w = block('#camera-out', 'Camera');
  const fm = $('#cam-facemode').value, res = $('#cam-res').value, fps = $('#cam-fps').value;
  const video = { facingMode: fm };
  if (res !== 'any') { const [width, height] = res.split('x').map(Number); video.width = { ideal: width }; video.height = { ideal: height }; }
  if (fps !== 'any') video.frameRate = { ideal: Number(fps) };
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    note(w, 'getUserMedia failed: ' + e.name + ' — ' + e.message, 'bad');
    R.camera.error = String(e);
    stashReport();
    return;
  }
  camTrack = camStream.getVideoTracks()[0];
  const v = $('#cam');
  v.srcObject = camStream;
  await v.play().catch(() => {});
  const s = camTrack.getSettings ? camTrack.getSettings() : {};
  const caps = camTrack.getCapabilities ? camTrack.getCapabilities() : {};
  kvTable(w, { 'Track settings': s, 'Track capabilities': caps, 'Label': camTrack.label });
  R.camera.settings = s;
  R.camera.capabilities = caps;
  $('#btn-cam-stop').disabled = false;
  $('#btn-cam-fps').disabled = false;
  $('#btn-cam-mstp').disabled = typeof MediaStreamTrackProcessor === 'undefined';
  $('#btn-cam-grab').disabled = !(typeof ImageCapture !== 'undefined' && 'grabFrame' in ImageCapture.prototype);
  const c = $('#camcanvas'), ctx = c.getContext('2d');
  const loop = () => {
    if (!camStream) return;
    if ($('#cam-log').checked && v.videoWidth) {
      ctx.drawImage(v, 0, 0, c.width, c.height);
    }
    requestAnimationFrame(loop);
  };
  loop();
  stashReport();
}

function stopCamera() {
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null; camTrack = null;
  $('#cam').srcObject = null;
  ['btn-cam-stop', 'btn-cam-fps', 'btn-cam-mstp', 'btn-cam-grab'].forEach((id) => ($('#' + id).disabled = true));
}

function nextVideoFrame(v) {
  return new Promise((res) => {
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => res());
    else setTimeout(res, 33);
  });
}

async function measureCamFps(ms = 2000) {
  const w = block('#camera-out', 'Frame delivery');
  const v = $('#cam');
  const counts = { rvfc: 0, currentTime: 0, raf: 0 };
  let lastCT = -1;
  const t0 = now();
  let stop = false;
  const onCT = () => { counts.currentTime++; };
  const pump = async () => {
    while (!stop && now() - t0 < ms) {
      await nextVideoFrame(v);
      counts.rvfc++;
    }
  };
  const raf = () => { if (!stop) { counts.raf++; requestAnimationFrame(raf); } };
  v.addEventListener('timeupdate', onCT);
  requestAnimationFrame(raf);
  await pump();
  stop = true;
  v.removeEventListener('timeupdate', onCT);
  const secs = (now() - t0) / 1000;
  const hz = counts.rvfc / secs;
  table(w, ['source', 'rate'], [
    ['requestVideoFrameCallback (camera frames)', fmt(hz, 1) + ' Hz', badge(hz >= 24 ? 'ok' : 'warn', hz >= 24 ? '30 Hz class' : 'below 30 — downscale before ML')],
    ['video.currentTime (timeupdate)', fmt(counts.currentTime / secs, 1) + ' Hz', badge('info', 'coarse, ~1-4 Hz on iOS')],
    ['rAF (render loop)', fmt(counts.raf / secs, 1) + ' Hz', badge('info', 'display rate, not camera')],
  ]);
  R.camera.frameDelivery = { hz, secs, timeupdate: counts.currentTime / secs, raf: counts.raf / secs };
  stashReport();
  refreshReport();
}

async function mstpPump(ms = 2000) {
  const w = block('#camera-out', 'MediaStreamTrackProcessor (worker-style zero-copy path)');
  if (typeof MediaStreamTrackProcessor === 'undefined') { note(w, 'Not available (needs Safari 18+).', 'bad'); return; }
  let frames = 0, copyMs = 0, err = null, fmt0 = null;
  const t0 = now();
  try {
    const proc = new MediaStreamTrackProcessor({ track: camTrack });
    const reader = proc.readable.getReader();
    const done = (async () => {
      while (now() - t0 < ms) {
        const { value, done: d } = await Promise.race([reader.read(), sleep(ms).then(() => ({ done: true }))]);
        if (d || !value) break;
        frames++;
        if (!fmt0) fmt0 = value.format;
        const c0 = now();
        try { await value.copyTo(new Uint8Array(4)); } catch (e) { /* size mismatch is fine, timing only */ }
        copyMs += now() - c0;
        value.close();
      }
      try { reader.cancel(); } catch (e) {}
    })();
    await done;
  } catch (e) { err = String(e); }
  const secs = (now() - t0) / 1000;
  const hz = frames / secs;
  table(w, ['metric', 'value'], [
    ['Frames delivered', frames],
    ['Delivery rate', fmt(hz, 1) + ' Hz', badge(hz >= 24 ? 'ok' : 'warn')],
    ['Pixel format', fmt0 || 'n/a'],
    ['copyTo cost (mean)', fmt(copyMs / Math.max(1, frames), 2) + ' ms/frame'],
    ['Error', err || 'none'],
  ]);
  if (err) note(w, 'This is the path MediaPipe should run in. Failures here mean keep inference on the main thread.', 'bad');
  R.camera.mstp = { frames, hz, copyMsPerFrame: copyMs / Math.max(1, frames), format: fmt0, error: err };
  stashReport();
  refreshReport();
}

async function testGrabFrame() {
  const w = block('#camera-out', 'ImageCapture.grabFrame');
  try {
    const ic = new ImageCapture(camTrack);
    const t0 = now();
    const bmp = await ic.grabFrame();
    const ms = now() - t0;
    table(w, ['metric', 'value'], [['Latency', fmt(ms, 1) + ' ms'], ['Size', `${bmp.width}x${bmp.height}`], ['Format', bmp.format || 'n/a']]);
    bmp.close && bmp.close();
    R.camera.grabFrame = { ms, ok: true };
  } catch (e) {
    note(w, 'grabFrame failed: ' + e, 'warn');
    R.camera.grabFrame = { ok: false, error: String(e) };
  }
  stashReport();
}

// ================================================================ 5. WASM
function leb(n) { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n); return b; }

// One exported wasm function (`f`) whose *body* is ~targetBytes of real
// arithmetic on a single i32 local, so the body compiles into a large B3 graph
// with long live ranges. WebKit tiers wasm up to its OMG optimizer after warm
// calls, and 304810 is a runaway in OMG's stack-colouring pass
// (JSC::B3::GraphColoringStackAllocator) on huge function bodies.
// This approximates the shape; it is not a byte-for-byte repro of the ORT
// asyncify binary that triggered the report.
const BODY_ITER_BYTES = 7; // local.get, local.get, i32.add, local.set
function makeBigFunctionWasm(targetBytes) {
  const head = 3;                                 // 1 local group, 1 x i32
  const tail = 1;                                 // end opcode
  const iters = Math.max(1, Math.floor((targetBytes - head - tail) / BODY_ITER_BYTES));
  const bodyLen = head + iters * BODY_ITER_BYTES + tail;
  const lebBody = leb(bodyLen);
  const codePayload = 1 + lebBody.length + bodyLen;
  const lebCode = leb(codePayload);
  const header = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
  const typeSec = [1, 4, 0x01, 0x60, 0x00, 0x00];
  const funcSec = [3, 2, 0x01, 0x00];
  const exportSec = [7, 5, 0x01, 0x01, 0x66, 0x00, 0x00]; // export func 0 as "f"
  const total = header.length + typeSec.length + funcSec.length + exportSec.length + 1 + lebCode.length + codePayload;
  const u = new Uint8Array(total);
  let p = 0;
  u.set(header, p); p += header.length;
  u.set(typeSec, p); p += typeSec.length;
  u.set(funcSec, p); p += funcSec.length;
  u.set(exportSec, p); p += exportSec.length;
  u[p++] = 10;
  for (const b of lebCode) u[p++] = b;
  u[p++] = 1;
  for (const b of lebBody) u[p++] = b;
  u[p++] = 0x01; u[p++] = 0x01; u[p++] = 0x7f;    // (local i32)
  for (let i = 0; i < iters; i++) {
    u[p++] = 0x20; u[p++] = 0x00;                // local.get 0
    u[p++] = 0x20; u[p++] = 0x00;                // local.get 0
    u[p++] = 0x6a;                              // i32.add
    u[p++] = 0x21; u[p++] = 0x00;                // local.set 0
  }
  u[p++] = 0x0b;                                // end
  return u;
}

async function runWasm() {
  clear($('#wasm-out'));
  const w = block('#wasm-out', 'WASM capabilities');
  const simd = WebAssembly.validate(SIMD_PROBE());
  const sharedOk = window.crossOriginIsolated && WebAssembly.validate(new Uint8Array(SHARED_MEM_PROBE()));
  const jspi = 'Suspending' in WebAssembly;
  table(w, ['capability', 'value', 'status'], [
    ['SIMD', String(simd), badge(simd ? 'ok' : 'bad')],
    ['crossOriginIsolated', String(window.crossOriginIsolated), badge(window.crossOriginIsolated ? 'ok' : 'warn', window.crossOriginIsolated ? '' : 'no COOP/COEP → threads unavailable')],
    ['Shared memory (threads) proposal', String(sharedOk), badge(sharedOk ? 'ok' : 'na', sharedOk ? '' : 'needs isolation')],
    ['JSPI (Safari 27+)', String(jspi), badge(jspi ? 'ok' : 'warn', jspi ? 'use the jspi wasm build, never asyncify' : 'fall back to non-asyncify wasm')],
  ]);

  const t = block('#wasm-out', 'Shared-memory sanity (only when isolated)');
  if (window.crossOriginIsolated) {
    try {
      const sab = new SharedArrayBuffer(1024);
      const i32 = new Int32Array(sab);
      const src = `self.onmessage=()=>{const i=new Int32Array(self.data);Atomics.add(i,0,1);postMessage(Atomics.load(i,0));};`;
      const wk = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const roundtrip = await new Promise((res) => {
        const to = setTimeout(() => res(-1), 3000);
        wk.onmessage = (e) => { clearTimeout(to); res(e.data); };
        wk.postMessage(sab, [sab]);
      });
      note(t, `Worker + SAB round-trip counter: ${roundtrip} (expect 1). Proves wasm threads can work.`, roundtrip === 1 ? 'ok' : 'bad');
      wk.terminate();
      R.wasm.threads = { ok: roundtrip === 1, roundtrip };
    } catch (e) { note(t, 'Shared memory test failed: ' + e, 'bad'); R.wasm.threads = { ok: false, error: String(e) }; }
  } else {
    note(t, 'Skipped. Serve this folder with `node server.mjs` (sets COOP+COEP) or any header-capable host to test threads.', 'hint');
    R.wasm.threads = { ok: false, reason: 'not cross-origin isolated' };
  }

  const m = block('#wasm-out', 'Memory growth behaviour');
  try {
    const mem = new WebAssembly.Memory({ initial: 17 });
    const before = mem.buffer.byteLength;
    mem.grow(1);
    const after = mem.buffer.byteLength;
    table(m, ['step', 'value'], [['initial 17 pages', before + ' B'], ['after grow(1)', after + ' B'], ['growth', (after - before) + ' B']]);
    R.wasm.memory = { grew: true, before, after };
    note(m, 'Growable memory works. On iOS 26.2 it was implicated in corruption with threads; on 27.x the underlying WebKit bug was fixed, but fixed memory is still cheaper.', 'hint');
  } catch (e) { note(m, 'Memory.grow failed: ' + e, 'warn'); R.wasm.memory = { grew: false, error: String(e) }; }

  // compile + call a realistic small module to time JIT warmup
  const c = block('#wasm-out', 'Compile timing (small module)');
  const bytes = makeBigFunctionWasm(1024);
  const t0 = now();
  const { instance } = await WebAssembly.instantiate(bytes);
  instance.exports.f();
  const ms = now() - t0;
  table(c, ['module', 'size', 'compile + first call'], [['1 KB function body', fmt(bytes.length / 1024, 1) + ' KB', fmt(ms, 1) + ' ms']]);
  R.wasm.smallCompileMs = ms;
  stashReport();
  refreshReport();
}

// ================================================================ 6. WEBGL2
async function runWebGL() {
  clear($('#webgl-out'));
  const w = block('#webgl-out', 'WebGL2');
  const cv = $('#glcanvas');
  const gl = cv.getContext('webgl2', { antialias: false });
  if (!gl) { note(w, 'No WebGL2 context. MediaPipe GPU delegate is unavailable.', 'bad'); R.webgl = { ok: false }; return; }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const info = {
    version: gl.getParameter(gl.VERSION),
    glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER),
    unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
    unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'n/a',
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    maxComputeWorkGroupSize: gl.getParameter(gl.MAX_COMPUTE_WORK_GROUP_SIZE_X) ?? 'n/a',
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    floatBlend: !!gl.getExtension('EXT_float_blend'),
    textureFloatLinear: !!gl.getExtension('OES_texture_float_linear'),
  };
  kvTable(w, info);
  // render loop fps
  const prog = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, '#version 300 es\nvoid main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[gl_VertexID],0,1);}');
  gl.compileShader(vs); gl.attachShader(prog, vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, '#version 300 es\nprecision highp float;out vec4 o;void main(){o=vec4(0.1,0.4,0.9,1);}');
  gl.compileShader(fs); gl.attachShader(prog, fs);
  gl.linkProgram(prog); gl.useProgram(prog);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  let frames = 0; const t0 = now();
  await new Promise((res) => {
    const step = () => {
      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(0.05, 0.06, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frames++;
      (now() - t0 < 2000) ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
  const hz = frames / ((now() - t0) / 1000);
  table(w, ['metric', 'value'], [['render loop', fmt(hz, 1) + ' Hz'], ['float render targets', info.colorBufferFloat ? 'yes' : 'no']]);
  R.webgl = { ok: true, ...info, renderHz: hz };
  stashReport();
  refreshReport();
}

// ================================================================ 7. WEBGPU
const WGPU = { adapter: null, device: null };

async function runWebGPU() {
  clear($('#webgpu-out'));
  const w = block('#webgpu-out', 'WebGPU');
  if (!('gpu' in navigator)) { note(w, 'navigator.gpu missing — needs Safari 26+.', 'bad'); R.webgpu = { ok: false }; return; }
  const t0 = now();
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); }
  catch (e) { note(w, 'requestAdapter threw: ' + e, 'bad'); }
  if (!adapter) { note(w, 'requestAdapter returned null (no compatible GPU or blocklisted).', 'bad'); R.webgpu = { ok: false, adapter: null }; return; }
  WGPU.adapter = adapter;
  const lim = adapter.limits;
  const limits = {
    maxBufferSize: lim.maxBufferSize,
    maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: lim.maxStorageBuffersPerShaderStage,
    maxStorageBuffersInFragmentStage: lim.maxStorageBuffersInFragmentStage,
    maxComputeInvocationsPerWorkgroup: lim.maxComputeInvocationsPerWorkgroup,
    maxComputeWorkgroupSizeX: lim.maxComputeWorkgroupSizeX,
    maxComputeWorkgroupsPerDimension: lim.maxComputeWorkgroupsPerDimension,
    maxTextureDimension2D: lim.maxTextureDimension2D,
  };
  const adapterInfo = adapter.info || null;
  const deviceInfo = adapterInfo ? {} : {};
  let device = null;
  try { device = await adapter.requestDevice(); } catch (e) { note(w, 'requestDevice failed: ' + e, 'bad'); }
  WGPU.device = device;
  const deviceAdapterInfo = device ? device.adapterInfo : null;
  const hasSubgroup = !!(deviceAdapterInfo && (deviceAdapterInfo.subgroupMinSize !== undefined || adapterInfo?.subgroupMinSize !== undefined));

  table(w, ['check', 'value', 'status'], [
    ['requestAdapter', 'ok (' + fmt(now() - t0, 0) + ' ms)', badge('ok')],
    ['requestDevice', device ? 'ok' : 'failed', badge(device ? 'ok' : 'bad')],
    ['adapter.info present', String(!!adapterInfo), badge(adapterInfo ? 'ok' : 'warn', adapterInfo ? '' : 'absent')],
    ['device.adapterInfo present', String(!!deviceAdapterInfo), badge(deviceAdapterInfo ? 'ok' : 'bad', deviceAdapterInfo ? '' : 'onnxruntime-web needs this')],
    ['subgroupMinSize/MaxSize', deviceAdapterInfo ? `${deviceAdapterInfo.subgroupMinSize}/${deviceAdapterInfo.subgroupMaxSize}` : 'missing', badge(hasSubgroup ? 'ok' : 'bad', hasSubgroup ? '' : 'ML runtimes will refuse to init')],
    ['adapter features', (adapter.features ? Array.from(adapter.features) : []).join(', ') || 'none', badge('info')],
    ['preferred canvas format', navigator.gpu.getPreferredCanvasFormat ? navigator.gpu.getPreferredCanvasFormat() : 'n/a', badge('info')],
  ]);
  kvTable(w, limits);
  note(w, hasSubgroup
    ? 'WebGPU looks complete here: native WebGPU EP / ML compute paths are worth testing.'
    : 'MISSING adapterInfo/subgroups. Do not build a WebGPU ML path on this device — use WASM instead. Do not polyfill it: it has been reported to hard-crash a real iPhone mid-inference.',
    hasSubgroup ? 'ok' : 'bad');

  if (device) {
    $('#btn-webgpu-compute').disabled = false;
    device.lost.then((info2) => {
      note($('#webgpu-out'), 'device.lost fired: ' + info2.reason + ' — ' + info2.message, 'bad');
      R.webgpu.deviceLost = { reason: info2.reason, message: info2.message };
      stashReport(); refreshReport();
    });
  }
  R.webgpu = { ...(R.webgpu || {}), ok: !!device, limits, adapterInfo: !!adapterInfo, deviceAdapterInfo: !!deviceAdapterInfo, hasSubgroup, features: adapter.features ? Array.from(adapter.features) : [] };
  stashReport();
  refreshReport();
}

const WGSL_ADD = `
@group(0) @binding(0) var<storage, read> input : array<f32>;
@group(0) @binding(1) var<storage, read_write> output : array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i < arrayLength(&input)) { output[i] = input[i] + 1.0; }
}`;

async function webgpuCompute() {
  const w = block('#webgpu-out', 'Compute smoke test');
  const device = WGPU.device;
  if (!device) { note(w, 'no device', 'bad'); return; }
  const N = 4096;
  const module = device.createShaderModule({ code: WGSL_ADD });
  const ci = await module.getCompilationInfo ? await module.getCompilationInfo() : { messages: [] };
  const errs = (ci.messages || []).filter((m) => m.type === 'error');
  if (errs.length) { note(w, 'WGSL errors: ' + errs.map((m) => m.message).join('; '), 'bad'); R.webgpu.compute = { ok: false, errs: errs.map((m) => m.message) }; return; }
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const inBuf = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const outBuf = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeBuffer(inBuf, 0, new Float32Array(N).fill(1.5));
  const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: outBuf } }] });
  const t0 = now();
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(N / 64)); pass.end();
  enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * 4);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  const ms = now() - t0;
  const ok = Math.abs(out[0] - 2.5) < 1e-5 && Math.abs(out[N - 1] - 2.5) < 1e-5;
  table(w, ['metric', 'value', 'status'], [
    ['N elements', N, ''],
    ['wall time (submit→readback)', fmt(ms, 2) + ' ms', badge('info')],
    ['result[0], result[N-1]', `${out[0]}, ${out[N - 1]}`, badge(ok ? 'ok' : 'bad', ok ? 'correct' : 'WRONG — WGSL/driver problem')],
  ]);
  inBuf.destroy(); outBuf.destroy(); readBuf.destroy();
  R.webgpu.compute = { ok, ms, N };
  stashReport(); refreshReport();
}

// ================================================================ 8. MEDIAPIPE
const MP = {
  stream: null, task: null, stop: false, lat: [], results: [], started: 0,
};
const MP_MODELS = {
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  gesture: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  object: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/latest/efficientdet_lite0.tflite',
  face: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
  segment: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
};

async function loadTasksVision(ver) {
  const bases = [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ver}`,
    `https://unpkg.com/@mediapipe/tasks-vision@${ver}`,
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest',
  ];
  const tried = [];
  for (const b of bases) {
    for (const entry of ['/vision_bundle.mjs', '']) {
      const url = b + entry;
      try {
        const mod = await import(/* webpackIgnore: true */ url);
        if (mod.FilesetResolver) return { mod, url, wasmBase: b + '/wasm' };
      } catch (e) { tried.push(url + ' → ' + e.message); }
    }
  }
  throw new Error('could not load @mediapipe/tasks-vision. Tried:\n' + tried.join('\n'));
}

function mlWarning(delegate, task) {
  const lines = [];
  if (delegate === 'GPU') {
    lines.push('GPU delegate on iOS Safari has a known wrong-output bug (ImageSegmenter categories scrambled). Always run CPU as well and compare.');
  }
  if (task === 'segment') {
    lines.push('Expected category ids for selfie_multiclass_256x256: 0 background, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 accessories. If the histogram looks permuted, you have hit the bug.');
  }
  if (!('Suspending' in WebAssembly)) {
    lines.push('No JSPI: avoid asyncify/JSPI wasm builds — Asyncify + large wasm functions is what triggers WebKit 304810 (CPU/memory runaway → process kill).');
  }
  if (!window.crossOriginIsolated) {
    lines.push('Not cross-origin isolated → WASM runs single-threaded. Expect ~2-4x slower than a COOP/COEP host (GitHub Pages cannot set those headers).');
  }
  return lines;
}

async function runML() {
  const task = $('#mp-task').value;
  const delegate = $('#mp-delegate').value;
  const ver = $('#mp-ver').value;
  const secs = Math.max(2, Number($('#mp-secs').value) || 10);
  clear($('#ml-out'));
  verdict('ml-verdict', 'info', 'loading…');
  $('#ml-warning').textContent = mlWarning(delegate, task).join('  •  ');
  const w = block('#ml-out', 'MediaPipe benchmark');
  note(w, `task=${task} delegate=${delegate} duration=${secs}s`);

  setStage(`ml:${task}/${delegate}@${ver}`);
  let vision = null, mod = null, urlUsed = null;
  try {
    const r = await loadTasksVision(ver);
    mod = r.mod; urlUsed = r.url;
    kvTable(w, { 'loaded from': urlUsed, wasm: r.wasmBase });
    const t0 = now();
    vision = await mod.FilesetResolver.forVisionTasks(r.wasmBase);
    note(w, 'wasm fileset resolved in ' + fmt(now() - t0, 0) + ' ms', 'hint');
  } catch (e) {
    note(w, 'Load failed: ' + e.message, 'bad');
    verdict('ml-verdict', 'bad', 'load failed');
    setStage(null);
    R.ml = { ok: false, error: String(e) };
    stashReport(); refreshReport();
    return;
  }

  // camera
  const v = $('#mlvid');
  try {
    MP.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false });
    v.srcObject = MP.stream;
    await v.play();
  } catch (e) {
    note(w, 'camera failed: ' + e, 'bad');
    setStage(null);
    R.ml = { ok: false, error: 'camera ' + e };
    stashReport(); refreshReport();
    return;
  }
  const canvas = $('#mlcanvas');
  const ctx = canvas.getContext('2d');

  // create task
  const model = MP_MODELS[task];
  const opts = { baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO' };
  if (task === 'hand') opts.numHands = 2;
  const tCreate = now();
  let T = null;
  try {
    if (task === 'hand') T = await mod.HandLandmarker.createFromOptions(vision, opts);
    else if (task === 'gesture') T = await mod.GestureRecognizer.createFromOptions(vision, opts);
    else if (task === 'object') T = await mod.ObjectDetector.createFromOptions(vision, { ...opts, scoreThreshold: 0.4 });
    else if (task === 'face') T = await mod.FaceDetector.createFromOptions(vision, opts);
    else if (task === 'segment') T = await mod.ImageSegmenter.createFromOptions(vision, { ...opts, outputCategoryMask: true, outputConfidenceMasks: false });
    else throw new Error('unknown task');
  } catch (e) {
    note(w, 'createFromOptions failed: ' + e, 'bad');
    setStage(null);
    R.ml = { ok: false, error: String(e), urlUsed, model };
    stashReport(); refreshReport();
    return;
  }
  MP.task = T;
  const createMs = now() - tCreate;
  note(w, 'task created in ' + fmt(createMs, 0) + ' ms', 'hint');

  // warmup
  for (let i = 0; i < 5; i++) { await nextVideoFrame(v); const ts = now(); try { runOnce(task, T, v, ts); } catch (e) {} }

  // measure
  MP.stop = false; MP.lat = []; MP.results = []; MP.signatures = new Set();
  MP.hist = new Array(8).fill(0); MP.histTotal = 0;
  $('#btn-mp-stop').disabled = false;
  const t0 = now();
  let errors = 0, lastErr = null;
  const raf = [];
  while (!MP.stop && now() - t0 < secs * 1000) {
    await nextVideoFrame(v);
    const ts = now();
    const a = now();
    try {
      const r = runOnce(task, T, v, ts);
      MP.lat.push(now() - a);
      captureResult(task, r);
    } catch (e) { errors++; lastErr = String(e); }
    // draw
    if (v.videoWidth) { ctx.drawImage(v, 0, 0, canvas.width, canvas.height); drawOverlay(task, ctx, MP.last, canvas); }
    if (raf.length < 200) raf.push(now());
  }
  const elapsed = (now() - t0) / 1000;
  MP.stop = true;
  $('#btn-mp-stop').disabled = true;
  try { T.close && T.close(); } catch (e) {}
  MP.stream.getTracks().forEach((t) => t.stop());
  MP.stream = null; v.srcObject = null;
  setStage(null);

  const lat = MP.lat.slice().sort((a, b) => a - b);
  const q = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : NaN);
  const hz = MP.lat.length / elapsed;

  const stat = {
    ok: true, task, delegate, version: ver, urlUsed, model,
    createMs, secs: elapsed, frames: MP.lat.length,
    latP50: q(0.5), latP90: q(0.9), latMax: lat[lat.length - 1],
    hz, errors, lastErr,
    peakJerk: M.peakJerk || 0,
    rafHz: MP.rafHz || null,
    distinctResults: MP.signatures.size,
  };
  if (task === 'segment') stat.categoryHistogram = MP.hist;
  R.ml = stat;

  const rows = [
    ['Load (tasks-vision)', urlUsed, badge('info')],
    ['Model create', fmt(createMs, 0) + ' ms', badge(createMs < 8000 ? 'ok' : 'warn', createMs < 8000 ? '' : 'slow first load')],
    ['Frames inferred', String(MP.lat.length), ''],
    ['Latency p50', fmt(q(0.5), 1) + ' ms', badge('ok')],
    ['Latency p90', fmt(q(0.9), 1) + ' ms', badge('info')],
    ['Latency max', fmt(stat.latMax, 1) + ' ms', badge('info')],
    ['Achieved rate', fmt(hz, 1) + ' Hz', badge(hz >= 24 ? 'ok' : hz >= 10 ? 'warn' : 'bad', hz >= 24 ? 'real-time capable' : hz >= 10 ? 'coarse input only' : 'too slow for camera input')],
    ['Errors', String(errors), badge(errors === 0 ? 'ok' : 'bad', errors ? lastErr || '' : '')],
    ['Distinct result signatures', String(MP.signatures.size), badge('info', 'if this stays at 1 while you move, output may be frozen/wrong')],
  ];
  table(w, ['metric', 'value', 'status'], rows);
  if (task === 'segment') {
    const total = MP.histTotal || 1;
    const h = block('#ml-out', 'Category histogram (scrambled-class bug detector)');
    const names = ['0 background', '1 hair', '2 body-skin', '3 face-skin', '4 clothes', '5 accessories'];
    table(h, ['category id (expected meaning)', '% of frame', 'verdict'], MP.hist.slice(0, 6).map((c, i) => [
      names[i],
      fmt((c / total) * 100, 1) + '%',
      badge(c === 0 ? 'na' : 'info', c > 0 ? '' : 'never appears — suspicious'),
    ]));
    const face = MP.hist[3] / total, hair = MP.hist[1] / total;
    if (face < 0.01 && hair < 0.01) note(h, 'Neither face-skin (3) nor hair (1) has mass → consistent with the reported iOS Safari GPU-delegate permutation. Re-run with delegate=CPU and compare.', 'bad');
  }
  const msg = hz >= 24 ? 'real-time capable — safe to use for per-frame game input' : hz >= 10 ? 'coarse input only (hold last value + confidence gating)' : 'too slow — use for scene changes only';
  verdict('ml-verdict', hz >= 24 ? 'ok' : hz >= 10 ? 'warn' : 'bad', msg);
  stashReport();
  refreshReport();
}

function runOnce(task, T, v, ts) {
  if (task === 'hand') return T.detectForVideo(v, ts);
  if (task === 'gesture') return T.recognizeForVideo(v, ts);
  if (task === 'object' || task === 'face') return T.detectForVideo(v, ts);
  if (task === 'segment') {
    let out = null;
    T.segmentForVideo(v, ts, (r) => { out = r; });
    return out;
  }
  throw new Error('unknown task');
}

function captureResult(task, r) {
  MP.last = r;
  try {
    if (task === 'hand' && r) {
      const n = (r.landmarks || []).length;
      const h = r.handedness && r.handedness[0] ? r.handedness[0][0] : null;
      const sig = `hands:${n}:${h ? h.categoryName : '-'}`;
      MP.signatures.add(sig);
    } else if (task === 'gesture' && r) {
      const g = r.gestures && r.gestures[0] && r.gestures[0][0];
      const sig = `g:${g ? g.categoryName : 'none'}`;
      MP.signatures.add(sig);
      MP.lastGesture = g ? `${g.categoryName} ${fmt(g.score, 2)}` : 'none';
    } else if (task === 'object' && r) {
      const d = (r.detections || []).map((x) => x.categories[0].categoryName + ':' + fmt(x.categories[0].score, 1)).join(',');
      MP.signatures.add(d || 'none');
      MP.lastDet = d;
    } else if (task === 'face' && r) {
      const d = (r.detections || []).length;
      MP.signatures.add('faces:' + d);
    } else if (task === 'segment' && r && r.categoryMask) {
      const arr = r.categoryMask.getAsUint8Array();
      for (let i = 0; i < arr.length; i += 7) { const c = arr[i]; if (c < 8) MP.hist[c]++; MP.histTotal++; }
    }
  } catch (e) { /* result shape changed — ignore */ }
}

function drawOverlay(task, ctx, r, canvas) {
  ctx.save();
  ctx.lineWidth = 2;
  if (task === 'hand' && r && r.landmarks) {
    ctx.fillStyle = '#3ecf8e';
    for (const hand of r.landmarks) for (const p of hand) ctx.fillRect(p.x * canvas.width - 1, p.y * canvas.height - 1, 3, 3);
  } else if (task === 'object' && r && r.detections) {
    ctx.strokeStyle = '#f0b429';
    ctx.font = '11px monospace';
    for (const d of r.detections) {
      const b = d.boundingBox;
      const x = b.originX ?? b.left ?? 0, y = b.originY ?? b.top ?? 0;
      ctx.strokeRect(x, y, b.width, b.height);
      ctx.fillText(d.categories[0].categoryName + ' ' + fmt(d.categories[0].score, 2), x + 2, Math.max(10, y - 3));
    }
  } else if (task === 'face' && r && r.detections) {
    ctx.strokeStyle = '#6aa6ff';
    for (const d of r.detections) { const b = d.boundingBox; ctx.strokeRect(b.originX, b.originY, b.width, b.height); }
  } else if (task === 'gesture' && r && r.gestures) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace';
    const g = r.gestures[0] && r.gestures[0][0];
    ctx.fillText(g ? g.categoryName : '—', 6, 16);
  } else if (task === 'segment' && r && r.categoryMask) {
    try {
      const arr = r.categoryMask.getAsUint8Array();
      const side = Math.sqrt(arr.length) | 0;
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = side;
      const tctx = tmp.getContext('2d');
      const img = tctx.createImageData(side, side);
      const pal = [[0, 0, 0, 0], [60, 40, 20, 255], [20, 180, 90, 255], [230, 180, 120, 255], [40, 90, 220, 255], [220, 60, 200, 255]];
      for (let i = 0; i < arr.length; i++) { const c = pal[arr[i]] || [255, 255, 0, 255]; img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 160; }
      tctx.putImageData(img, 0, 0);
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    } catch (e) { /* ignore */ }
  }
  ctx.restore();
}

// ================================================================ 9. LANDMINE PROBES
async function probeBigWasm() {
  const n = Number($('#probe-size').value);
  const reps = Math.max(1, Number($('#probe-reps').value) || 1);
  const calls = Math.max(1, Number($('#probe-calls').value) || 2000);
  clear($('#stress-out'));
  const w = block('#stress-out', `Probe: ${(n / 1024) | 0} KB function body × ${reps} (${calls} calls each)`);
  setStage(`probe:bigwasm:${n}:${reps}:${calls}`);
  note(w, 'The function is called repeatedly on purpose: WebKit only tiers up to the OMG optimizer after warm calls, and 304810 is a runaway in OMG compilation. This approximates the shape of the offending binaries, it is not a byte-for-byte repro. If the page freezes, reloads, or the device restarts → 304810 is live on this build. That is a real result; record it.', 'warn');
  const bytes = makeBigFunctionWasm(n);
  note(w, 'Generated module: ' + fmt(bytes.length / 1048576, 2) + ' MB, validates = ' + WebAssembly.validate(bytes), 'hint');
  const results = [];
  for (let i = 0; i < reps; i++) {
    // heartbeat to detect main-thread starvation / runaway
    let ticks = 0, maxGap = 0, last = now();
    const iv = setInterval(() => { const t = now(); maxGap = Math.max(maxGap, t - last); last = t; ticks++; }, 100);
    const t0 = now();
    let err = null, callMs = null;
    try {
      const { instance } = await WebAssembly.instantiate(bytes);
      const f = instance.exports.f;
      const t1 = now();
      for (let c = 0; c < calls; c++) f();
      callMs = now() - t1;
    } catch (e) { err = String(e); }
    const ms = now() - t0;
    clearInterval(iv);
    results.push({ i: i + 1, totalMs: ms, callMs, maxMainThreadGapMs: maxGap, ticks, err });
    table(w, ['rep', 'total', 'call loop', 'max main-thread gap', 'status'], [[
      i + 1, fmt(ms, 0) + ' ms', callMs === null ? '—' : fmt(callMs, 0) + ' ms', fmt(maxGap, 0) + ' ms',
      err ? badge('bad', 'error: ' + err) : maxGap > 1000 ? badge('bad', 'main thread starved') : badge('ok'),
    ]]);
    await sleep(300);
  }
  R.probes.bigWasm = { bytes: n, reps, calls, results };
  setStage(null);
  note(w, 'Finished without a crash. Still keep an eye out: 304810 can also appear as a slow leak during long sessions.', 'ok');
  stashReport(); refreshReport();
}

async function probeSmallTexture() {
  clear($('#stress-out'));
  const w = block('#stress-out', 'Probe: 2x2 WebGPU texture');
  setStage('probe:smalltex');
  note(w, 'Reported to cause a GPU validation error and crash on iOS/Safari. If the page dies, that reproduces the report.', 'warn');
  try {
    if (!WGPU.device) { note(w, 'Run the safe WebGPU checks first.', 'warn'); setStage(null); return; }
    const d = WGPU.device;
    const tex = d.createTexture({ size: [2, 2], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    const view = tex.createView();
    const enc = d.createCommandEncoder();
    const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 0, b: 0, a: 1 } }] });
    p.end();
    d.queue.submit([enc.finish()]);
    await d.queue.onSubmittedWorkDone();
    note(w, '2x2 texture created, rendered and submitted successfully. No crash on this build.', 'ok');
    R.probes.smallTexture = { ok: true };
    tex.destroy();
  } catch (e) {
    note(w, 'Failed (survivable): ' + e, 'warn');
    R.probes.smallTexture = { ok: false, error: String(e) };
  }
  setStage(null); stashReport(); refreshReport();
}

async function probeBigBuffer() {
  clear($('#stress-out'));
  const w = block('#stress-out', 'Probe: large GPU buffer');
  setStage('probe:bigbuf');
  const mb = Number(prompt('Buffer size in MB (adapter max is ' + Math.round((WGPU.adapter?.limits.maxBufferSize || 0) / 1048576) + ' MB):', '512') || 512);
  try {
    if (!WGPU.device) { note(w, 'Run the safe WebGPU checks first.', 'warn'); setStage(null); return; }
    const size = mb * 1048576;
    const t0 = now();
    const buf = WGPU.device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const ms = now() - t0;
    await WGPU.device.queue.onSubmittedWorkDone();
    table(w, ['size', 'allocate time', 'status'], [[mb + ' MB', fmt(ms, 1) + ' ms', badge('ok', 'allocated')]]);
    note(w, 'Expect the tab to be killed under memory pressure well below the advertised limit. Watch for a reload.', 'warn');
    R.probes.bigBuffer = { mb, allocateMs: ms, ok: true };
    buf.destroy();
  } catch (e) {
    note(w, 'Allocation failed: ' + e, 'warn');
    R.probes.bigBuffer = { mb, ok: false, error: String(e) };
  }
  setStage(null); stashReport(); refreshReport();
}

async function probeSoak() {
  const secs = Number($('#probe-soak').value) || 60;
  clear($('#stress-out'));
  const w = block('#stress-out', `Soak: ${secs} s camera + rAF`);
  setStage(`probe:soak:${secs}`);
  if (!camStream) { note(w, 'Start the camera in the Camera tab first — the soak measures the camera path.', 'warn'); setStage(null); return; }
  const v = $('#cam');
  const win = Math.min(5, secs);
  const buckets = [];
  let longTasks = 0, running = true, rafFrames = 0, camFrames = 0, mark = now();
  let po = null;
  try { po = new PerformanceObserver((l) => { longTasks += l.getEntries().length; }); po.observe({ entryTypes: ['longtask'] }); } catch (e) { /* unsupported */ }

  const tick = () => { if (!running) return; rafFrames++; requestAnimationFrame(tick); };
  const camTick = async () => { while (running) { try { await nextVideoFrame(v); camFrames++; } catch (e) { break; } } };
  requestAnimationFrame(tick);
  camTick();

  const t0 = now();
  while (now() - t0 < secs * 1000) {
    await sleep(win * 1000);
    const t = now();
    buckets.push({
      t: Math.round((t - t0) / 1000),
      rafFps: rafFrames / ((t - mark) / 1000),
      camFps: camFrames / ((t - mark) / 1000),
    });
    rafFrames = 0; camFrames = 0; mark = t;
  }
  running = false;
  if (po) po.disconnect();

  const first = buckets[0], lastS = buckets[buckets.length - 1];
  const decayPct = first && lastS ? (1 - (lastS.camFps / Math.max(0.001, first.camFps))) * 100 : NaN;
  table(w, ['t (s)', 'rAF fps', 'camera fps'], buckets.map((b) => [b.t, fmt(b.rafFps, 1), fmt(b.camFps, 1)]));
  table(w, ['metric', 'value', 'status'], [
    ['Duration', secs + ' s', ''],
    ['rAF fps start → end', `${fmt(first?.rafFps, 1)} → ${fmt(lastS?.rafFps, 1)}`, badge((lastS?.rafFps || 0) > 45 ? 'ok' : 'bad', (lastS?.rafFps || 0) > 45 ? '' : 'throttled / blocked')],
    ['camera fps start → end', `${fmt(first?.camFps, 1)} → ${fmt(lastS?.camFps, 1)}`, ''],
    ['Camera decay', fmt(decayPct, 1) + ' %', badge(decayPct < 15 ? 'ok' : 'warn', decayPct < 15 ? 'stable' : 'thermal throttling or backgrounding')],
    ['Long tasks', longTasks, badge(longTasks < 20 ? 'ok' : 'warn')],
  ]);
  R.probes.soak = {
    secs, buckets, longTasks,
    fpsFirst: first?.rafFps, fpsLast: lastS?.rafFps,
    camFpsFirst: first?.camFps, camFpsLast: lastS?.camFps, decayPct,
  };
  setStage(null); stashReport(); refreshReport();
}

// ================================================================ 10. REPORT
function refreshReport() {
  $('#stamp').textContent = new Date().toISOString();
  clear($('#report-out'));
  const w = $('#report-out');
  const blocked = R.caps.filter((c) => c.status === 'bad').length;
  const rows = [
    ['Device', `${R.meta.deviceModelManual || '?'} / iOS ${R.meta.iOSversionManual || '?'}`, ''],
    ['Safari', R.meta.safariVersion || '?', ''],
    ['Cross-origin isolated', String(R.meta.crossOriginIsolated), R.meta.crossOriginIsolated ? 'ok' : 'warn'],
    ['Blocking capability gaps', blocked, blocked ? 'bad' : 'ok'],
    ['Motion rate', R.motion?.capture ? fmt(R.motion.capture.hz, 1) + ' Hz' : 'not measured', R.motion?.capture ? (R.motion.capture.hz >= 50 ? 'ok' : 'bad') : 'na'],
    ['Camera frame rate', R.camera?.frameDelivery ? fmt(R.camera.frameDelivery.hz, 1) + ' Hz' : 'not measured', R.camera?.frameDelivery ? (R.camera.frameDelivery.hz >= 24 ? 'ok' : 'warn') : 'na'],
    ['MSTP delivery', R.camera?.mstp ? fmt(R.camera.mstp.hz, 1) + ' Hz' : 'not measured', R.camera?.mstp ? (R.camera.mstp.ok !== false ? 'ok' : 'bad') : 'na'],
    ['WASM JSPI', R.caps.find((c) => c.name.includes('JSPI'))?.actual ?? '?', R.caps.find((c) => c.name.includes('JSPI'))?.status ?? 'na'],
    ['WebGPU device', R.webgpu?.ok ? 'ok' : (R.webgpu?.ok === false ? 'failed' : 'not measured'), R.webgpu?.ok ? 'ok' : R.webgpu?.ok === false ? 'bad' : 'na'],
    ['WebGPU adapterInfo', R.webgpu?.deviceAdapterInfo ? 'present' : (R.webgpu?.ok ? 'missing' : '—'), R.webgpu?.hasSubgroup ? 'ok' : R.webgpu?.ok ? 'bad' : 'na'],
    ['WebGPU compute', R.webgpu?.compute ? (R.webgpu.compute.ok ? 'pass' : 'fail') : 'not measured', R.webgpu?.compute ? (R.webgpu.compute.ok ? 'ok' : 'bad') : 'na'],
    ['ML task', R.ml?.task ? `${R.ml.task}/${R.ml.delegate}` : 'not run', 'na'],
    ['ML latency p50', R.ml?.latP50 ? fmt(R.ml.latP50, 1) + ' ms' : '—', 'na'],
    ['ML rate', R.ml?.hz ? fmt(R.ml.hz, 1) + ' Hz' : '—', R.ml?.hz >= 24 ? 'ok' : R.ml?.hz ? 'warn' : 'na'],
    ['Big-wasm probe', R.probes?.bigWasm ? `${R.probes.bigWasm.bytes / 1024} KB × ${R.probes.bigWasm.reps}` : 'not run', 'na'],
    ['Soak decay', R.probes?.soak ? fmt(R.probes.soak.fpsLast - R.probes.soak.fpsFirst, 1) + ' fps' : 'not run', 'na'],
  ];
  const g = document.createElement('div');
  g.innerHTML = '<div style="font-weight:700;margin:8px 0 6px;color:#6aa6ff">Summary</div>';
  w.appendChild(g);
  table(w, ['item', 'value', ''], rows);
  $('#report-json').textContent = JSON.stringify(R, null, 2);
}

function download(name, text) {
  const b = new Blob([text], { type: 'application/json' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

// ================================================================ wiring
$('#btn-env').addEventListener('click', runEnv);
$('#btn-caps').addEventListener('click', runCaps);
$('#btn-all').addEventListener('click', async () => {
  const b = $('#btn-all');
  b.disabled = true; b.textContent = 'running…';
  try {
    await runEnv(); await runCaps(); await runWasm(); await runWebGL(); await runWebGPU();
    $$('#tabs button').forEach((x) => x.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    $('#report').classList.add('active');
    $$('#tabs button').forEach((x) => { if (x.dataset.tab === 'report') x.classList.add('active'); });
    refreshReport();
  } finally { b.disabled = false; b.textContent = 'Run ALL safe checks (1-7)'; }
});
$('#btn-motion-perm').addEventListener('click', requestMotion);
$('#btn-motion-run').addEventListener('click', runMotionCapture);
$('#btn-motion-cal').addEventListener('click', calibrate);
$('#btn-motion-demo').addEventListener('click', () => {
  M.demo = !M.demo;
  $('#btn-motion-demo').textContent = M.demo ? 'Stop tilt-pad demo' : 'Toggle tilt-pad demo';
  $('#tiltpad').style.opacity = M.demo ? '1' : '.4';
});
$('#btn-cam').addEventListener('click', startCamera);
$('#btn-cam-stop').addEventListener('click', stopCamera);
$('#btn-cam-fps').addEventListener('click', () => measureCamFps(2000));
$('#btn-cam-mstp').addEventListener('click', () => mstpPump(2000));
$('#btn-cam-grab').addEventListener('click', testGrabFrame);
$('#btn-wasm').addEventListener('click', runWasm);
$('#btn-webgl').addEventListener('click', runWebGL);
$('#btn-webgpu').addEventListener('click', runWebGPU);
$('#btn-webgpu-compute').addEventListener('click', webgpuCompute);
$('#btn-mp').addEventListener('click', runML);
$('#btn-mp-stop').addEventListener('click', () => { MP.stop = true; });
$('#btn-probe-wasm').addEventListener('click', probeBigWasm);
$('#btn-probe-tex').addEventListener('click', probeSmallTexture);
$('#btn-probe-mem').addEventListener('click', probeBigBuffer);
$('#btn-probe-thermal').addEventListener('click', probeSoak);
$('#btn-export').addEventListener('click', () => {
  const dev = (R.meta.deviceModelManual || 'device').replace(/\W+/g, '-');
  const ios = R.meta.iOSversionManual || 'ios';
  download(`ios-safari-report_${dev}_${ios}_${Date.now()}.json`, JSON.stringify(R, null, 2));
});
$('#btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(R, null, 2)); $('#btn-copy').textContent = 'Copied'; }
  catch (e) { $('#btn-copy').textContent = 'Copy failed'; }
  setTimeout(() => ($('#btn-copy').textContent = 'Copy JSON to clipboard'), 1500);
});
$('#btn-clear').addEventListener('click', () => { try { localStorage.removeItem(STORE_KEY); } catch (e) {} });
$('#auto-store').addEventListener('change', stashReport);

attachMotionUI();
(function boot() {
  const stage = getStage();
  if (stage) {
    const bar = $('#crashbar');
    bar.hidden = false;
    const prev = loadStash();
    bar.innerHTML = `<b>Previous session did not finish.</b> It was interrupted at: <code>${stage}</code>.` +
      (prev && prev.meta ? `<br>Last stored report: ${prev.meta.deviceModelManual || '?'} / iOS ${prev.meta.iOSversionManual || '?'} / Safari ${prev.meta.safariVersion || '?'} at ${prev.meta.startedAt}` : '');
    R.meta.interruptedStage = stage;
    R.meta.previousStash = prev ? prev.meta : null;
  }
  refreshReport();
})();
