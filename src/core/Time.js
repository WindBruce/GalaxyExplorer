/**
 * Game clock. Real seconds -> galactic stardate.
 *
 * The game keeps a monotonic clock so that planetary rotation, stellar
 * activity, civilisation politics and dynamic events all advance from the
 * same source of truth.
 */
export class GameClock {
  constructor(startStardate = 48102.7) {
    this.stardate = startStardate;
    this.elapsed = 0; // real seconds since session start (unpaused)
    this.scale = 1; // 1 real second = 1 stardate unit (tunable)
    this.paused = false;
  }

  update(dtReal) {
    if (this.paused) return;
    this.elapsed += dtReal;
    this.stardate += dtReal * this.scale;
  }

  /** Formatted stardate, e.g. "SD 48102.74". */
  get stardateLabel() {
    return 'SD ' + this.stardate.toFixed(2);
  }

  serialize() {
    return { stardate: this.stardate, elapsed: this.elapsed };
  }

  deserialize(data) {
    if (!data) return;
    this.stardate = Number(data.stardate ?? this.stardate);
    this.elapsed = Number(data.elapsed ?? 0);
  }
}
