import type { CommitNode } from './types';

export type ProgressCallback = (
  dayIndex: number,
  totalDays: number,
  commitsSoFar: number,
  totalCommits: number,
  dateLabel: string,
) => void;
export type AddCommitCallback = (commit: CommitNode) => void;
export type ResetCallback = () => void;

interface DayBucket {
  dateKey: string; // "YYYY-MM-DD"
  commits: CommitNode[];
}

// ms per day at 1x speed
const BASE_INTERVAL_MS = 100;
// Commits in a single day before we throttle per frame
const BURST_THRESHOLD = 200;
// Max commits to emit per frame when bursting
const BURST_PER_FRAME = 100;

export class AnimationController {
  private dayBucketMap = new Map<string, DayBucket>();
  private dayBuckets: DayBucket[] = [];
  private expectedTotalCommits: number;
  private totalLoadedCommits = 0;
  private allLoaded = false;

  private currentDayIndex = 0;
  private commitsSoFar = 0;
  private isPlaying = false;
  private speed = 1.0;
  private lastFrameTime = 0;
  private rafId: number | null = null;
  private onProgress: ProgressCallback | null = null;
  private onAddCommit: AddCommitCallback | null = null;
  private onReset: ResetCallback | null = null;
  private onWaiting: ((waiting: boolean) => void) | null = null;

  // Burst state: when a day bucket has many commits we drain it over multiple frames
  private burstCommits: CommitNode[] = [];
  private burstDayKey = '';
  private waiting = false;

  constructor(expectedTotalCommits: number) {
    this.expectedTotalCommits = expectedTotalCommits;
  }

  /**
   * Append commits from a newly-loaded chunk.
   * Incrementally merges into existing day buckets.
   * Handles cross-chunk day boundaries correctly.
   */
  appendCommits(commits: CommitNode[]): void {
    for (const commit of commits) {
      const dateKey = timestampToDateKey(commit.timestamp);
      let bucket = this.dayBucketMap.get(dateKey);
      if (!bucket) {
        bucket = { dateKey, commits: [] };
        this.dayBucketMap.set(dateKey, bucket);
      }
      bucket.commits.push(commit);
    }
    this.totalLoadedCommits += commits.length;

    // Rebuild sorted array (incremental: new days are appended at end, sort is fast)
    this.dayBuckets = [...this.dayBucketMap.values()].sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey),
    );

    // Resume if waiting for data
    if (this.waiting && this.currentDayIndex < this.dayBuckets.length) {
      this.waiting = false;
      this.onWaiting?.(false);
      if (this.isPlaying) {
        this.lastFrameTime = performance.now();
        this.tick();
      }
    }
  }

  setAllLoaded(): void {
    this.allLoaded = true;
  }

  setCallbacks(
    onAddCommit: AddCommitCallback,
    onProgress: ProgressCallback,
    onReset?: ResetCallback,
    onWaiting?: (waiting: boolean) => void,
  ): void {
    this.onAddCommit = onAddCommit;
    this.onProgress = onProgress;
    this.onReset = onReset ?? null;
    this.onWaiting = onWaiting ?? null;
  }

  play(): void {
    if (this.waiting) return; // Can't play while waiting for chunks
    if (
      this.currentDayIndex >= this.dayBuckets.length &&
      this.burstCommits.length === 0
    ) {
      if (this.allLoaded) {
        // Finished — reset for replay
        this.currentDayIndex = 0;
        this.commitsSoFar = 0;
        this.burstCommits = [];
        this.onReset?.();
      } else {
        // No data loaded yet; wait
        return;
      }
    }
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.tick();
  }

  pause(): void {
    this.isPlaying = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  togglePlay(): void {
    this.isPlaying ? this.pause() : this.play();
  }

  stepForward(): void {
    if (this.burstCommits.length > 0) {
      this.drainBurst(Infinity);
      return;
    }
    if (this.currentDayIndex < this.dayBuckets.length) {
      this.addDayBucket(this.currentDayIndex);
      this.currentDayIndex++;
      this.emitProgress();
    }
  }

  stepBackward(): void {
    if (this.currentDayIndex > 0) {
      this.seekTo(this.currentDayIndex - 1);
    }
  }

  seekTo(dayIndex: number): void {
    const wasPlaying = this.isPlaying;
    this.pause();
    this.waiting = false;
    this.burstCommits = [];
    this.commitsSoFar = 0;
    this.onReset?.();
    const target = Math.max(0, Math.min(dayIndex, this.dayBuckets.length));
    for (let i = 0; i < target; i++) {
      this.addDayBucket(i);
    }
    this.currentDayIndex = target;
    this.emitProgress();
    if (wasPlaying) this.play();
  }

  stop(): void {
    this.pause();
    this.waiting = false;
    this.burstCommits = [];
    this.commitsSoFar = 0;
    this.currentDayIndex = 0;
    this.onReset?.();
    this.emitProgress();
  }

  setSpeed(multiplier: number): void {
    this.speed = Math.max(0.5, Math.min(10, multiplier));
  }

  getSpeed(): number {
    return this.speed;
  }

  getCurrentDayIndex(): number {
    return this.currentDayIndex;
  }

  getTotalDays(): number {
    return this.dayBuckets.length;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getTotalCommits(): number {
    return this.expectedTotalCommits;
  }

  isWaitingForData(): boolean {
    return this.waiting;
  }

  private getIntervalMs(): number {
    return BASE_INTERVAL_MS / Math.max(this.speed, 0.001);
  }

  private tick(): void {
    if (!this.isPlaying) return;

    const now = performance.now();

    // --- Phase 1: drain burst queue ---
    if (this.burstCommits.length > 0) {
      const adaptiveMax =
        this.commitsSoFar > 10000
          ? 20
          : this.commitsSoFar > 5000
            ? 40
            : this.commitsSoFar > 2000
              ? 60
              : BURST_PER_FRAME;
      const perFrame = Math.max(
        1,
        Math.min(adaptiveMax, Math.ceil(this.speed * adaptiveMax)),
      );
      this.drainBurst(perFrame);
      this.emitProgress();
      this.rafId = requestAnimationFrame(() => this.tick());
      return;
    }

    // --- Phase 2: advance to next day ---
    const elapsed = now - this.lastFrameTime;
    const interval = this.getIntervalMs();

    if (elapsed >= interval) {
      const daysToAdd = Math.max(1, Math.floor(elapsed / interval));
      const maxBatch =
        this.commitsSoFar > 10000
          ? 2
          : this.commitsSoFar > 5000
            ? 3
            : Math.max(1, Math.ceil(this.speed * 5));
      const batchCap = Math.min(daysToAdd, maxBatch);

      for (let i = 0; i < batchCap; i++) {
        if (this.currentDayIndex >= this.dayBuckets.length) break;
        const bucket = this.dayBuckets[this.currentDayIndex];

        if (bucket.commits.length > BURST_THRESHOLD) {
          this.burstCommits = [...bucket.commits];
          this.burstDayKey = bucket.dateKey;
          this.currentDayIndex++;
          break;
        } else {
          this.addDayBucket(this.currentDayIndex);
          this.currentDayIndex++;
        }
      }

      this.lastFrameTime = now;
      this.emitProgress();
    }

    // Check if we ran out of data
    if (
      this.currentDayIndex >= this.dayBuckets.length &&
      this.burstCommits.length === 0
    ) {
      if (this.allLoaded) {
        this.isPlaying = false;
        this.emitProgress();
        return;
      }
      // Not all loaded — enter waiting state (keep isPlaying true)
      this.waiting = true;
      this.onWaiting?.(true);
      return;
    }

    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private drainBurst(count: number): void {
    if (!this.onAddCommit) return;
    const n = Math.min(count, this.burstCommits.length);
    for (let i = 0; i < n; i++) {
      this.onAddCommit(this.burstCommits[i]);
      this.commitsSoFar++;
    }
    this.burstCommits.splice(0, n);
  }

  private addDayBucket(index: number): void {
    const bucket = this.dayBuckets[index];
    if (!bucket || !this.onAddCommit) return;
    for (const commit of bucket.commits) {
      this.onAddCommit(commit);
      this.commitsSoFar++;
    }
  }

  private emitProgress(): void {
    if (!this.onProgress) return;
    let dateLabel = '';
    if (this.burstCommits.length > 0) {
      dateLabel = this.burstDayKey;
    } else if (this.currentDayIndex > 0) {
      dateLabel =
        this.dayBuckets[
          Math.min(this.currentDayIndex - 1, this.dayBuckets.length - 1)
          ].dateKey;
    } else if (this.dayBuckets.length > 0) {
      dateLabel = this.dayBuckets[0].dateKey;
    }
    this.onProgress(
      this.currentDayIndex,
      this.dayBuckets.length,
      this.commitsSoFar,
      this.expectedTotalCommits,
      dateLabel,
    );
  }
}

function timestampToDateKey(ts: number): string {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${ y }-${ m }-${ day }`;
}
