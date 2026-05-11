import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const COLORS = {
  bg: "#1a1a2e",
  rulerBg: "#16213e",
  rulerText: "#8892b0",
  rulerLine: "#384766",
  waveform: "#00d2ff",
  waveformFill: "rgba(0,210,255,0.15)",
  trimRegion: "rgba(0,210,255,0.06)",
  handleStart: "#00e676",
  handleEnd: "#ff5252",
  handleHover: "#ffffff",
  playhead: "#ffd600",
  gridLine: "rgba(255,255,255,0.04)",
  textPrimary: "#e0e0e0",
  textSecondary: "#8892b0",
  nodeBg: "#0f3460",
  playBtn: "#00e676",
  stopBtn: "#ff5252",
};

// Slim handle hit zone (pixels each side of the line)
const HANDLE_HIT = 8;
const HANDLE_LINE_W = 2;
const FLAG_W = 7;
const FLAG_H = 14;
const RULER_H = 26;
const TIMELINE_H = 130;
const INFO_H = 30;
const TOTAL_H = RULER_H + TIMELINE_H + INFO_H + 6;

function formatTime(s, forceMs) {
  if (s < 0) s = 0;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  // Show 3 decimal places (ms) when value is small or forced
  const decimals = (forceMs || s < 10) ? 3 : 2;
  const sec = rem.toFixed(decimals);
  return m > 0 ? `${m}:${sec.padStart(decimals + 3, "0")}` : `${sec}s`;
}

class TimelineState {
  constructor() {
    this.samples = null; // raw mono samples from backend
    this.duration = 0;
    this.sampleRate = 0;
    this.channels = 0;
    this.startTime = 0;
    this.endTime = 0;
    this.zoom = 1;
    this.scrollX = 0;
    this.dragging = null;
    this.dragStartX = 0;
    this.dragOrigStart = 0;
    this.dragOrigEnd = 0;
    this.hoverHandle = null;
    this.audioFile = null;
    this.isPlaying = false;
    this.playheadTime = 0;
  }
}

function timeToX(time, state, width) {
  const vis = state.duration / state.zoom;
  const off = state.scrollX * (state.duration - vis);
  return ((time - off) / vis) * width;
}

function xToTime(x, state, width) {
  const vis = state.duration / state.zoom;
  const off = state.scrollX * (state.duration - vis);
  return off + (x / width) * vis;
}

function drawTimeline(ctx, state, width, height) {
  const w = width;
  const rH = RULER_H;
  const tH = TIMELINE_H;
  const totalDrawH = rH + tH;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, height);

  if (!state.samples || state.duration <= 0) {
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = "13px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("▶  Queue node to load audio waveform", w / 2, height / 2);
    return;
  }

  const visibleDuration = state.duration / state.zoom;
  const startOffset = state.scrollX * (state.duration - visibleDuration);

  // Ruler background
  ctx.fillStyle = COLORS.rulerBg;
  ctx.fillRect(0, 0, w, rH);
  ctx.strokeStyle = COLORS.rulerLine;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, rH); ctx.lineTo(w, rH); ctx.stroke();

  // Time markers — includes ms-level intervals for deep zoom
  let interval = 0.1;
  const intervals = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
  for (const iv of intervals) {
    if ((iv / visibleDuration) * w > 50) { interval = iv; break; }
  }
  const showMs = interval < 0.1;
  const firstMark = Math.ceil(startOffset / interval) * interval;
  ctx.fillStyle = COLORS.rulerText;
  ctx.font = "10px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "center";
  for (let t = firstMark; t <= startOffset + visibleDuration; t += interval) {
    const x = timeToX(t, state, w);
    if (x < -30 || x > w + 30) continue;
    ctx.strokeStyle = COLORS.rulerLine;
    ctx.beginPath(); ctx.moveTo(x, rH - 7); ctx.lineTo(x, rH); ctx.stroke();
    ctx.fillText(formatTime(t, showMs), x, rH - 10);
    ctx.strokeStyle = COLORS.gridLine;
    ctx.beginPath(); ctx.moveTo(x, rH); ctx.lineTo(x, totalDrawH); ctx.stroke();
  }

  // Waveform data — compute peaks per pixel for current visible range
  const samples = state.samples;
  const numSamples = samples.length;
  const centerY = rH + tH / 2;
  const ampH = tH / 2 - 4;

  // Trim region highlight
  const sx = Math.max(0, timeToX(state.startTime, state, w));
  const ex = Math.min(w, timeToX(state.endTime, state, w));
  if (ex > sx) {
    ctx.fillStyle = COLORS.trimRegion;
    ctx.fillRect(sx, rH, ex - sx, tH);
  }

  // Compute per-pixel min/max peaks from raw samples
  // Each pixel covers a time range -> find all samples in that range -> get min/max
  const pixelPeaks = new Float32Array(w * 2); // [min0, max0, min1, max1, ...]
  for (let i = 0; i < w; i++) {
    const tLeft = xToTime(i, state, w);
    const tRight = xToTime(i + 1, state, w);
    // Map time to sample indices
    const sStart = Math.max(0, Math.floor((tLeft / state.duration) * numSamples));
    const sEnd = Math.min(numSamples, Math.ceil((tRight / state.duration) * numSamples));
    let mn = 0, mx = 0;
    if (sStart < numSamples && sEnd > sStart) {
      mn = samples[sStart];
      mx = samples[sStart];
      for (let j = sStart + 1; j < sEnd; j++) {
        const v = samples[j];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    } else if (sStart < numSamples) {
      // Single sample — interpolate
      mn = mx = samples[Math.min(sStart, numSamples - 1)];
    }
    pixelPeaks[i * 2] = mn;
    pixelPeaks[i * 2 + 1] = mx;
  }

  // Draw waveform using per-pixel peaks
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < w; i++) {
    const mx = pixelPeaks[i * 2 + 1];
    const y = centerY - mx * ampH;
    if (first) { ctx.moveTo(i, y); first = false; } else ctx.lineTo(i, y);
  }
  for (let i = w - 1; i >= 0; i--) {
    const mn = pixelPeaks[i * 2];
    ctx.lineTo(i, centerY - mn * ampH);
  }
  ctx.closePath();
  ctx.fillStyle = COLORS.waveformFill;
  ctx.fill();
  ctx.strokeStyle = COLORS.waveform;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Center line
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath(); ctx.moveTo(0, centerY); ctx.lineTo(w, centerY); ctx.stroke();

  // Dim outside trim region
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  if (sx > 0) ctx.fillRect(0, rH, sx, tH);
  if (ex < w) ctx.fillRect(ex, rH, w - ex, tH);

  // --- Slim handle lines with small flags ---
  const drawSlimHandle = (x, color, side, isHover) => {
    if (x < -10 || x > w + 10) return;
    const lineColor = isHover ? COLORS.handleHover : color;
    const lineW = isHover ? 3 : HANDLE_LINE_W;

    // Vertical line
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(x, rH);
    ctx.lineTo(x, totalDrawH);
    ctx.stroke();

    // Small flag/tab at top
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    if (side === "left") {
      // Flag pointing right
      ctx.moveTo(x, rH);
      ctx.lineTo(x + FLAG_W, rH);
      ctx.lineTo(x + FLAG_W, rH + FLAG_H * 0.6);
      ctx.lineTo(x, rH + FLAG_H);
      ctx.closePath();
    } else {
      // Flag pointing left
      ctx.moveTo(x, rH);
      ctx.lineTo(x - FLAG_W, rH);
      ctx.lineTo(x - FLAG_W, rH + FLAG_H * 0.6);
      ctx.lineTo(x, rH + FLAG_H);
      ctx.closePath();
    }
    ctx.fill();
  };

  drawSlimHandle(sx, COLORS.handleStart, "left", state.hoverHandle === "start");
  drawSlimHandle(ex, COLORS.handleEnd, "right", state.hoverHandle === "end");

  // Playhead
  if (state.isPlaying && state.playheadTime >= state.startTime && state.playheadTime <= state.endTime) {
    const px = timeToX(state.playheadTime, state, w);
    if (px >= 0 && px <= w) {
      ctx.strokeStyle = COLORS.playhead;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, rH); ctx.lineTo(px, totalDrawH); ctx.stroke();
      // Small playhead triangle at top
      ctx.fillStyle = COLORS.playhead;
      ctx.beginPath();
      ctx.moveTo(px - 4, rH); ctx.lineTo(px + 4, rH); ctx.lineTo(px, rH + 6);
      ctx.closePath(); ctx.fill();
    }
  }

  // Info bar
  const infoY = totalDrawH + 3;
  ctx.fillStyle = COLORS.rulerBg;
  ctx.fillRect(0, infoY, w, INFO_H);
  const trimDur = Math.max(0, state.endTime - state.startTime);
  ctx.font = "11px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.handleStart;
  ctx.fillText(`In: ${formatTime(state.startTime)}`, 8, infoY + 19);
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.waveform;
  ctx.fillText(`Duration: ${formatTime(trimDur)}`, w / 2, infoY + 19);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.handleEnd;
  ctx.fillText(`Out: ${formatTime(state.endTime)}`, w - 8, infoY + 19);

  if (state.zoom > 1) {
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = "9px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(`${state.zoom.toFixed(1)}x`, w - 8, rH - 3);
  }
}

function getHandleAtX(x, state, canvasW) {
  const sx = timeToX(state.startTime, state, canvasW);
  const ex = timeToX(state.endTime, state, canvasW);
  // Prioritize the closer handle if they overlap
  const dS = Math.abs(x - sx);
  const dE = Math.abs(x - ex);
  if (dS < HANDLE_HIT && dS <= dE) return "start";
  if (dE < HANDLE_HIT && dE < dS) return "end";
  if (dS < HANDLE_HIT) return "start";
  if (dE < HANDLE_HIT) return "end";
  if (x > sx && x < ex) return "region";
  return null;
}

// ── Audio playback manager (Web Audio API for sample-accurate playback) ──
// HTML5 Audio.currentTime is NOT frame-accurate — seeks to nearest codec frame.
// Web Audio API decodes to raw PCM buffer and plays from exact sample offset.
class AudioPlayer {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.buffer = null;
    this.animFrame = null;
    this.startWallTime = 0;
    this.startOffset = 0;
    this._cachedUrl = null;
  }

  async play(state, audioFileUrl, onTick, onEnd) {
    this.stop(state);

    try {
      // Create or reuse AudioContext
      if (!this.ctx || this.ctx.state === "closed") {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }

      // Fetch and decode audio buffer (cache it for repeat plays)
      if (!this.buffer || this._cachedUrl !== audioFileUrl) {
        const response = await fetch(audioFileUrl);
        const arrayBuf = await response.arrayBuffer();
        this.buffer = await this.ctx.decodeAudioData(arrayBuf);
        this._cachedUrl = audioFileUrl;
      }

      const startTime = state.startTime;
      const endTime = state.endTime;
      const duration = Math.max(0.001, endTime - startTime);

      // Create buffer source — plays from exact sample position
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffer;
      source.connect(this.ctx.destination);

      state.isPlaying = true;
      state.playheadTime = startTime;
      this.startOffset = startTime;
      this.startWallTime = this.ctx.currentTime;
      this.source = source;

      // start(when, offset, duration) — SAMPLE-ACCURATE playback
      source.start(0, startTime, duration);

      source.onended = () => {
        this.stop(state);
        onEnd();
      };

      // Smooth playhead animation
      const animate = () => {
        if (!state.isPlaying) return;
        const elapsed = this.ctx.currentTime - this.startWallTime;
        state.playheadTime = this.startOffset + elapsed;
        if (state.playheadTime >= endTime) {
          this.stop(state);
          onEnd();
          return;
        }
        onTick();
        this.animFrame = requestAnimationFrame(animate);
      };
      this.animFrame = requestAnimationFrame(animate);
    } catch (err) {
      console.error("[AudioTrimmer] Playback error:", err);
      this.stop(state);
      onEnd();
    }
  }

  stop(state) {
    state.isPlaying = false;
    if (this.source) {
      try { this.source.stop(); } catch (_) {}
      this.source.disconnect();
      this.source = null;
    }
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }
}

// ── Extension registration ──
app.registerExtension({
  name: "audio_trimmer.timeline",

  async beforeRegisterNodeDef(nodeType, nodeData, appRef) {
    if (nodeData.name !== "AudioTrimmer_Timeline") return;

    const origOnCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origOnCreated?.apply(this, arguments);

      const node = this;
      const state = new TimelineState();
      const player = new AudioPlayer();
      node._timelineState = state;
      node._audioPlayer = player;

      // ── Build DOM ──
      const container = document.createElement("div");
      container.style.cssText = "width:100%;padding:4px;box-sizing:border-box;overflow:hidden;";

      const canvas = document.createElement("canvas");
      canvas.style.cssText = "border-radius:6px;cursor:default;display:block;";
      container.appendChild(canvas);

      // Controls row: zoom + play
      const controls = document.createElement("div");
      controls.style.cssText = "display:flex;justify-content:center;align-items:center;gap:6px;margin-top:4px;";

      const makeBtn = (text, title, extraCss) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.title = title || "";
        b.style.cssText = `background:#16213e;color:#8892b0;border:1px solid #384766;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;${extraCss || ""}`;
        b.addEventListener("mouseenter", () => { b.style.background = "#1a1a4e"; });
        b.addEventListener("mouseleave", () => { b.style.background = extraCss?.includes("background") ? extraCss.match(/background:([^;]+)/)?.[1] || "#16213e" : "#16213e"; });
        return b;
      };

      const zoomOut = makeBtn("−", "Zoom out");
      zoomOut.addEventListener("click", () => { state.zoom = Math.max(1, state.zoom / 1.5); render(); });
      const zoomReset = makeBtn("Reset", "Reset zoom");
      zoomReset.addEventListener("click", () => { state.zoom = 1; state.scrollX = 0; render(); });
      const zoomIn = makeBtn("+", "Zoom in");
      zoomIn.addEventListener("click", () => { state.zoom = Math.min(500, state.zoom * 1.5); render(); });

      // Play button
      const playBtn = document.createElement("button");
      playBtn.textContent = "▶ Play";
      playBtn.title = "Play selected audio section";
      playBtn.style.cssText = "background:#0a2a1a;color:#00e676;border:1px solid #00e676;border-radius:4px;padding:2px 14px;cursor:pointer;font-size:11px;font-weight:bold;margin-left:8px;transition:all 0.15s;";
      playBtn.addEventListener("mouseenter", () => {
        if (!state.isPlaying) { playBtn.style.background = "#0f3d24"; }
      });
      playBtn.addEventListener("mouseleave", () => {
        playBtn.style.background = state.isPlaying ? "#2a0a0a" : "#0a2a1a";
      });

      const setPlayBtnState = (playing) => {
        if (playing) {
          playBtn.textContent = "■ Stop";
          playBtn.style.color = COLORS.stopBtn;
          playBtn.style.borderColor = COLORS.stopBtn;
          playBtn.style.background = "#2a0a0a";
        } else {
          playBtn.textContent = "▶ Play";
          playBtn.style.color = COLORS.playBtn;
          playBtn.style.borderColor = COLORS.playBtn;
          playBtn.style.background = "#0a2a1a";
        }
      };

      playBtn.addEventListener("click", () => {
        if (!state.audioFile || !state.samples) return;
        if (state.isPlaying) {
          player.stop(state);
          setPlayBtnState(false);
          render();
          return;
        }
        const audioUrl = api.apiURL(`/view?filename=${encodeURIComponent(state.audioFile)}&type=temp`);
        player.play(state, audioUrl, render, () => { setPlayBtnState(false); render(); });
        setPlayBtnState(true);
      });

      controls.appendChild(zoomOut);
      controls.appendChild(zoomReset);
      controls.appendChild(zoomIn);
      controls.appendChild(playBtn);
      container.appendChild(controls);

      // ── Render ──
      const render = () => {
        const dpr = window.devicePixelRatio || 1;
        // Collapse canvas first so container reports its true constrained width
        canvas.style.width = "0px";
        const w = Math.max(Math.floor(container.clientWidth - 8), 100);
        // Set canvas backing store to exact device pixels
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(TOTAL_H * dpr);
        // Set CSS display size to exact CSS pixels (NO percentage!)
        canvas.style.width = w + "px";
        canvas.style.height = TOTAL_H + "px";
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawTimeline(ctx, state, w, TOTAL_H);
      };

      const updateWidgets = () => {
        const sw = node.widgets?.find(w => w.name === "start_time");
        const ew = node.widgets?.find(w => w.name === "end_time");
        if (sw) sw.value = parseFloat(state.startTime.toFixed(4));
        if (ew) ew.value = parseFloat(state.endTime.toFixed(4));
        app.graph.setDirtyCanvas(true, false);
      };

      // ── Mouse interactions ──
      canvas.addEventListener("mousedown", (e) => {
        if (!state.samples) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (y < RULER_H || y > RULER_H + TIMELINE_H) return;
        const handle = getHandleAtX(x, state, rect.width);
        if (handle) {
          state.dragging = handle;
          state.dragStartX = x;
          state.dragOrigStart = state.startTime;
          state.dragOrigEnd = state.endTime;
          e.preventDefault();
        }
      });

      canvas.addEventListener("mousemove", (e) => {
        if (!state.samples) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const cw = rect.width;

        if (state.dragging) {
          const t = Math.max(0, Math.min(state.duration, xToTime(x, state, cw)));
          if (state.dragging === "start") {
            state.startTime = Math.max(0, Math.min(t, state.endTime - 0.01));
          } else if (state.dragging === "end") {
            state.endTime = Math.min(state.duration, Math.max(t, state.startTime + 0.01));
          } else if (state.dragging === "region") {
            const dx = x - state.dragStartX;
            const dt = (dx / cw) * (state.duration / state.zoom);
            const regionLen = state.dragOrigEnd - state.dragOrigStart;
            let ns = state.dragOrigStart + dt;
            let ne = state.dragOrigEnd + dt;
            if (ns < 0) { ns = 0; ne = regionLen; }
            if (ne > state.duration) { ne = state.duration; ns = ne - regionLen; }
            state.startTime = ns;
            state.endTime = ne;
          }
          updateWidgets();
          render();
          return;
        }

        const y = e.clientY - rect.top;
        if (y >= RULER_H && y <= RULER_H + TIMELINE_H) {
          const h = getHandleAtX(x, state, cw);
          state.hoverHandle = (h === "start" || h === "end") ? h : null;
          canvas.style.cursor = (h === "start" || h === "end") ? "ew-resize" : h === "region" ? "grab" : "crosshair";
        } else {
          state.hoverHandle = null;
          canvas.style.cursor = "default";
        }
        render();
      });

      const mouseUp = () => { if (state.dragging) { state.dragging = null; render(); } };
      canvas.addEventListener("mouseup", mouseUp);
      document.addEventListener("mouseup", mouseUp);

      canvas.addEventListener("wheel", (e) => {
        if (!state.samples) return;
        e.preventDefault();
        if (e.ctrlKey || e.shiftKey) {
          // Zoom anchored to mouse position
          const rect = canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const timeBefore = xToTime(mouseX, state, rect.width);
          const factor = e.deltaY > 0 ? 0.8 : 1.25;
          state.zoom = Math.max(1, Math.min(500, state.zoom * factor));
          // Adjust scrollX so the time under cursor stays in place
          const visD = state.duration / state.zoom;
          const desiredOffset = timeBefore - (mouseX / rect.width) * visD;
          const maxOffset = state.duration - visD;
          state.scrollX = maxOffset > 0 ? Math.max(0, Math.min(1, desiredOffset / maxOffset)) : 0;
        } else {
          const scrollSpeed = 0.002 / state.zoom; // faster scroll when zoomed out
          state.scrollX = Math.max(0, Math.min(1, state.scrollX + e.deltaY * scrollSpeed));
        }
        render();
      }, { passive: false });

      canvas.addEventListener("dblclick", (e) => {
        if (!state.samples) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (y < RULER_H || y > RULER_H + TIMELINE_H) return;
        const t = xToTime(x, state, rect.width);
        if (Math.abs(t - state.startTime) < Math.abs(t - state.endTime)) {
          state.startTime = Math.max(0, Math.min(t, state.endTime - 0.01));
        } else {
          state.endTime = Math.min(state.duration, Math.max(t, state.startTime + 0.01));
        }
        updateWidgets();
        render();
      });

      // ── DOM widget ──
      node.addDOMWidget("timeline_display", "custom", container, {
        serialize: false,
        getMinHeight: () => TOTAL_H + 40,
      });

      // ── Listen for waveform data from server ──
      api.addEventListener("audio_trimmer.waveform_data", ({ detail }) => {
        if (String(detail.node_id) !== String(node.id)) return;
        // Store raw samples as Float32Array for fast per-pixel peak computation
        state.samples = new Float32Array(detail.samples);
        state.duration = detail.duration;
        state.sampleRate = detail.sample_rate;
        state.channels = detail.channels;
        state.audioFile = detail.audio_file || null;
        if (state.endTime <= 0 || state.endTime > state.duration) state.endTime = state.duration;
        if (state.startTime > state.duration) state.startTime = 0;
        updateWidgets();
        render();
      });

      // Sync widget changes back to state
      const hookWidget = (name, prop) => {
        const w = node.widgets?.find(wg => wg.name === name);
        if (w) {
          const origCb = w.callback;
          w.callback = function (v) {
            state[prop] = parseFloat(v) || 0;
            render();
            origCb?.apply(this, arguments);
          };
        }
      };

      setTimeout(() => {
        hookWidget("start_time", "startTime");
        hookWidget("end_time", "endTime");
        node.setSize([420, 340]);
        render();
      }, 100);

      const origOnResize = node.onResize;
      node.onResize = function () {
        origOnResize?.apply(this, arguments);
        setTimeout(render, 50);
      };

      // Cleanup on node removal
      const origOnRemoved = node.onRemoved;
      node.onRemoved = function () {
        player.stop(state);
        origOnRemoved?.apply(this, arguments);
      };
    };
  },

  nodeCreated(node) {
    if (node.comfyClass === "AudioTrimmer_Timeline") {
      node.color = COLORS.nodeBg;
      node.bgcolor = COLORS.bg;
    }
  },
});
