/** Host-loop adapter. Rendering callbacks never own or advance simulation time. */
export class SimulationRunner {
  constructor({ spine, render = () => {}, requestFrame, cancelFrame, setTimer, clearTimer } = {}) {
    if (!spine) throw new TypeError("spine is required");
    this.spine = spine;
    this.render = render;
    this.requestFrame = requestFrame ?? globalThis.requestAnimationFrame?.bind(globalThis);
    this.cancelFrame = cancelFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis);
    this.setTimer = setTimer ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimer = clearTimer ?? globalThis.clearTimeout.bind(globalThis);
    this.mode = this.requestFrame && this.cancelFrame ? "raf" : "timeout";
    this.handle = undefined;
    this.running = false;
    this.lastTimestampUs = undefined;
    this.boundFrame = timestamp => this.frame(timestamp);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTimestampUs = undefined;
    this.schedule();
  }

  stop() {
    if (!this.running && this.handle === undefined) return;
    this.running = false;
    if (this.handle !== undefined) {
      if (this.mode === "raf") this.cancelFrame(this.handle);
      else this.clearTimer(this.handle);
    }
    this.handle = undefined;
    this.lastTimestampUs = undefined;
  }

  schedule() {
    if (!this.running || this.handle !== undefined) return;
    if (this.mode === "raf") this.handle = this.requestFrame(this.boundFrame);
    else this.handle = this.setTimer(() => this.frame(), 16);
  }

  frame(timestampMs) {
    this.handle = undefined;
    if (!this.running) return;
    const nowUs = Number.isFinite(timestampMs) ? Math.round(timestampMs * 1000) : Math.round(performance.now() * 1000);
    if (this.lastTimestampUs !== undefined) {
      const elapsedUs = Math.max(0, nowUs - this.lastTimestampUs);
      try { this.spine.advance(elapsedUs); }
      catch (error) { this.stop(); throw error; }
    }
    this.lastTimestampUs = nowUs;
    try { this.render({ tick: this.spine.time.tick, interpolation: this.spine.time.interpolationRatio }); }
    finally { this.schedule(); }
  }
}
