export class RateLimiter {
  constructor({ rps = 1, burstRps = 2, maxConcurrent = 2 } = {}) {
    this.baseRps = rps;
    this.rps = rps;
    this.burstRps = burstRps;
    this.maxConcurrent = maxConcurrent;
    this.tokens = rps;
    this.last = Date.now();
    this.active = 0;
    this.queue = [];
    this.burstUntil = 0;
    this.slowUntil = 0;
    this._timer = null;
  }

  effectiveRps() {
    const now = Date.now();
    if (now < this.slowUntil) return Math.max(0.5, this.baseRps / 2);
    if (now < this.burstUntil) return this.burstRps;
    return this.baseRps;
  }

  enterBurst(windowMs) {
    this.burstUntil = Math.max(this.burstUntil, Date.now() + windowMs);
  }

  slowDown(cooldownMs) {
    this.slowUntil = Math.max(this.slowUntil, Date.now() + cooldownMs);
  }

  _refill() {
    const now = Date.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const cap = Math.max(1, this.effectiveRps());
    this.tokens = Math.min(cap, this.tokens + dt * this.effectiveRps());
  }

  _canTake() {
    this._refill();
    return this.tokens >= 1 && this.active < this.maxConcurrent;
  }

  acquire({ priority = 0 } = {}) {
    return new Promise((resolve) => {
      this.queue.push({ priority, resolve });
      if (this.queue.length > 1) this.queue.sort((a, b) => b.priority - a.priority);
      this._pump();
    });
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this._pump();
  }

  _pump() {
    while (this.queue.length && this._canTake()) {
      this.tokens -= 1;
      this.active += 1;
      this.queue.shift().resolve();
    }
    if (!this.queue.length) return;
    if (this.active >= this.maxConcurrent) return; // 等 release() 再唤醒
    this._refill();
    const need = Math.max(0, 1 - this.tokens);
    const rps = Math.max(0.1, this.effectiveRps());
    const waitMs = Math.max(30, Math.min(3000, (need / rps) * 1000));
    if (!this._timer) {
      this._timer = setTimeout(() => { this._timer = null; this._pump(); }, waitMs);
    }
  }

  stats() {
    return {
      rps: this.effectiveRps(),
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      baseRps: this.baseRps,
      tokens: Number(this.tokens.toFixed(3)),
      hasTimer: !!this._timer,
    };
  }
}
