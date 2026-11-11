/**
 * A damped spring solved exactly. Its position at any moment comes from one formula rather than a
 * step-by-step simulation, so it behaves the same at any frame rate and cannot drift or blow up.
 * Aiming it somewhere new keeps the position and speed it has at that moment.
 */
export class Spring {
  target: number;
  private from: number;
  private speed = 0;
  private since = 0;
  private readonly omega: number; // natural frequency
  private readonly zeta: number; // damping ratio: 1 never overshoots, lower bounces

  /** `duration`: about how long the spring takes to arrive, in seconds. `bounce`: 0 for none, up to about 0.3. */
  constructor(value: number, duration = 0.6, bounce = 0) {
    this.from = this.target = value;
    this.omega = (2 * Math.PI) / duration;
    this.zeta = 1 - bounce;
  }

  /** Position and speed at time `now`, in seconds. */
  at(now: number): [number, number] {
    const t = Math.max(now - this.since, 0);
    const offset = this.from - this.target;
    const rate = this.zeta * this.omega, decay = Math.exp(-rate * t);
    if (this.zeta < 1) {
      const w = this.omega * Math.sqrt(1 - this.zeta * this.zeta), b = (this.speed + rate * offset) / w;
      const cos = Math.cos(w * t), sin = Math.sin(w * t);
      return [this.target + decay * (offset * cos + b * sin), decay * (this.speed * cos - (rate * b + w * offset) * sin)];
    }
    const b = this.speed + rate * offset;
    return [this.target + decay * (offset + b * t), decay * (b - rate * (offset + b * t))];
  }

  value(now: number) {
    return this.at(now)[0];
  }

  /** Move to `value` at once and stay there. */
  jump(value: number) {
    this.from = this.target = value;
    this.speed = 0;
  }

  /** Aim at a new target from wherever the spring is at `now`. */
  to(target: number, now: number) {
    if (target === this.target) return;
    [this.from, this.speed] = this.at(now);
    this.target = target;
    this.since = now;
  }
}
