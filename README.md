# iOS Safari 27.x — interaction & ML capability harness

A single-page, no-build test harness for answering one question: **what can iOS Safari 27.x actually do for a game that uses motion and/or camera-based object detection, and where does it break?**

Everything runs on-device. No telemetry, no build step, no dependencies.

```
open index.html            # or serve the folder (see "Running" below)
```

## Running

| Goal | How |
|---|---|
| Quick test on a phone | Serve over **HTTPS** (GitHub Pages, or `npx serve` on a tunnel). Motion + camera need a secure context. |
| Test WebAssembly threads | `node server.mjs` → `http://localhost:8080` (sends COOP+COEP so `crossOriginIsolated === true`). Over plain LAN HTTP on a phone, only `localhost` counts as secure, so use a tunnel for the phone. |
| GitHub Pages | Push and enable Pages on the branch root. Pages **cannot** set COOP/COEP → `crossOriginIsolated` will be `false` and WASM runs single-threaded. That is fine for most of the harness; it only costs ML throughput. |

Notes
- On iOS 26+ the UA string no longer reports the OS version, so **fill in the iOS version and device model manually** in tab 1. They end up in the exported JSON.
- Leave the page in the foreground. Switching apps / locking the phone suspends motion events and camera frames.
- First run of the MediaPipe tab downloads ~10–20 MB (runtime + model) from a CDN.

## Tabs

**1. Environment** — UA/Safari version, secure context, `crossOriginIsolated`, hardware concurrency, screen/refresh hints, `AudioContext` base/output latency, storage estimate, rAF rate, and a game-basics checklist (vibration, fullscreen, pointer lock, wake lock, gamepad).

**2. Capabilities** — the researched target matrix with expected values for iOS Safari 27.x, and a pass/warn/bad verdict per row. `BAD` rows are things that break the plan; `N/A` rows are known-missing by design (no `WebNN`, no Generic Sensor API, no `deviceorientationabsolute`, no pointer lock).

**3. Motion** — `requestPermission()`, then a 10 s capture that reports event rate, `e.interval`, gap p50/p90/max, handler latency, long tasks, and shake events. Includes a zero-point calibration and a tilt-pad so you can eyeball input latency. Expect ~60 Hz.

**4. Camera** — `getUserMedia` with your constraints, actual track settings/capabilities, frame delivery rate via `requestVideoFrameCallback` vs `video.currentTime` vs rAF, a `MediaStreamTrackProcessor` pump (the zero-copy path you'd feed a worker), and `ImageCapture.grabFrame`.

**5. WASM** — SIMD, JSPI (new in Safari 27), shared memory, a worker + `SharedArrayBuffer` round trip when isolated, memory growth behaviour, and compile timing.

**6. WebGL2** — context, renderer strings, float render-target support, and a render-loop rate.

**7. WebGPU** — adapter/device, full limits dump, and the two checks that matter: whether `device.adapterInfo` and subgroup sizes are exposed (most ML runtimes refuse to start without them) plus a real compute shader with readback.

**8. MediaPipe ML** — runs `@mediapipe/tasks-vision` on the camera and reports load time, latency p50/p90/max, achieved rate, and distinct result signatures. Tasks: HandLandmarker, GestureRecognizer, ObjectDetector, FaceDetector, and ImageSegmenter (`segment`, which includes a **category-histogram check for the known iOS Safari GPU-delegate class-permutation bug** — the one automated correctness check in here).

**9. Landmine probes** (deliberately unsafe) — one at a time:
- **big WASM function body** (256 KB → 8 MB, repeat N times). Reproduces the shape that triggers WebKit bug 304810 (OMG stack colouring on huge function bodies → CPU pinned, memory runaway, WebContent process killed). Detects main-thread starvation via a heartbeat.
- **2×2 WebGPU texture** — reported to cause a GPU validation error and crash on iOS/Safari.
- **large GPU buffer** — pushes `maxBufferSize` until the tab dies.
- **60 s+ soak** — camera + rAF, reports FPS decay and long tasks (thermal throttling).

**10. Report** — summary table, full JSON, download / clipboard, and the last report is kept in `localStorage`.

### Crash forensics

Before any ML run or landmine probe the page writes a stage marker to `sessionStorage`. If the WebContent process is killed, the next load shows a red banner telling you exactly which stage died, plus the previous report's device metadata. That is the intended workflow for the probes: freeze/reload **is** the result.

## Reading the results (iOS 27.x targets)

| Signal | Good | Notes |
|---|---|---|
| Motion rate | ≥ 50 Hz | 60 Hz is the real ceiling; ProMotion 120 Hz needs a manual Feature Flag |
| Motion gap p90 | < 30 ms | larger = input stutter |
| Camera frames | ≥ 24 Hz | use `requestVideoFrameCallback`; `timeupdate` is ~1–4 Hz on iOS and is not a frame counter |
| MSTP delivery | ≥ 24 Hz | below this, run ML on downscaled frames (224–256 px) |
| ML latency p50 | < 40 ms | ≥ 100 ms ⇒ only scene-change input, not per-frame |
| ML rate | ≥ 24 Hz = per-frame capable; 10–24 Hz = coarse input; < 10 Hz = scene changes only | pair with "hold last value + confidence gating" |
| `crossOriginIsolated` | `true` (local server) | `false` on Pages ⇒ single-threaded WASM, ~2–4× slower |
| `device.adapterInfo` + subgroup sizes | present | **missing ⇒ do not build a WebGPU ML path**; a polyfill has been reported to hard-crash a real iPhone mid-inference |
| Big-WASM probe | no starvation, no reload | a crash here means WebKit 304810 is live on that build — avoid asyncify/JSEP wasm builds |
| Soak decay | < 15 % | larger = thermal throttling; you need frame skipping in a real game |

## Rules this harness is built around

1. If `'Suspending' in WebAssembly` is true (Safari 27+), use the **JSPI** wasm build. Never use an Asyncify build — that is what triggers the 304810 runaway.
2. Fixed wasm memory (`ALLOW_MEMORY_GROWTH=0`, large `INITIAL_MEMORY`) and a capped thread count. The iOS 26.2 "threads + growable memory" corruption bug was fixed before 27.0 shipped, but fixed memory is free insurance.
3. Categorical outputs (segmentation, classification) → **CPU delegate** is the reference; run the GPU delegate only as a comparison, and treat a differing category histogram as a bug, not a feature.
4. Inference in a dedicated worker fed by `MediaStreamTrackProcessor`; inference rate decoupled from render rate.
5. Every camera feature must degrade: permission denied, worker death, or an over-budget memory spike permanently disables the camera tier for the session and the game falls back to tilt-only input.

## Suggested test matrix

| Device | What to run |
|---|---|
| iOS 27.0 (minimum target) | tabs 1–8, then the big-WASM probe and a 60 s soak |
| iOS 27.1 / 27.2 | tabs 7–8 (WebGPU + ML) to catch regressions inside 27.x |
| Old A-series device + a ProMotion device | soak test; compare decay |
| Each ML task | CPU delegate first, then GPU delegate, compare latency **and** the result overlay / category histogram |

Export the JSON per run and diff them; that is what tells you whether a change is a regression or a device difference.

## Files

- `index.html` — UI
- `app.js` — all checks and benchmarks
- `styles.css` — styling
- `server.mjs` — optional COOP/COEP static server for thread testing
