import { fetchChunk } from './api';
import type { ChunkInfo, CommitNode } from './types';

/**
 * Manages on-demand loading of commit data chunks.
 * Supports both sequential streaming (animate mode) and
 * concurrent bulk loading (snapshot mode) with a sliding-window
 * concurrency limit.
 */
export class ChunkLoader {
  private chunkInfos: ChunkInfo[];
  private loaded: (CommitNode[] | null)[];
  private pending = new Map<number, Promise<CommitNode[]>>();

  /** Prefix sums of commit counts for commit-index → chunk-index mapping. */
  private prefixSums: number[];

  constructor(chunks: ChunkInfo[]) {
    this.chunkInfos = chunks;
    this.loaded = new Array(chunks.length).fill(null);

    let sum = 0;
    this.prefixSums = [0];
    for (const c of chunks) {
      sum += c.commit_count;
      this.prefixSums.push(sum);
    }
  }

  get totalChunks(): number {
    return this.chunkInfos.length;
  }

  get loadedCount(): number {
    let n = 0;
    for (const c of this.loaded) if (c !== null) n++;
    return n;
  }

  isLoaded(i: number): boolean {
    return this.loaded[i] !== null;
  }

  getChunk(i: number): CommitNode[] | null {
    return this.loaded[i];
  }

  /** Which chunk contains the Nth commit (by global commit index)? */
  chunkIndexForCommit(commitIndex: number): number {
    for (let i = 1; i < this.prefixSums.length; i++) {
      if (commitIndex < this.prefixSums[i]) return i - 1;
    }
    return this.chunkInfos.length - 1;
  }

  /** Fetch a single chunk. Deduplicates concurrent requests for the same index. */
  fetch(i: number): Promise<CommitNode[]> {
    if (i < 0 || i >= this.chunkInfos.length) {
      return Promise.reject(new Error(`Chunk index out of range: ${ i }`));
    }
    if (this.loaded[i]) return Promise.resolve(this.loaded[i]!);
    if (this.pending.has(i)) return this.pending.get(i)!;

    const promise = fetchChunk(this.chunkInfos[i].file).then((data) => {
      this.loaded[i] = data.commits;
      this.pending.delete(i);
      return data.commits;
    });
    this.pending.set(i, promise);
    return promise;
  }

  /** Fire-and-forget prefetch for chunks [from, from+count). */
  prefetch(from: number, count: number): void {
    const end = Math.min(from + count, this.chunkInfos.length);
    for (let i = from; i < end; i++) {
      if (!this.loaded[i] && !this.pending.has(i)) {
        this.fetch(i);
      }
    }
  }

  /**
   * Load all chunks with a sliding-window concurrency limit.
   * Calls onChunkReady(index, commits) in order as each chunk arrives,
   * and onProgress(loaded, total) on every completion.
   */
  async fetchAll(
    maxConcurrency: number,
    onChunkReady?: (index: number, commits: CommitNode[]) => void,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<CommitNode[]> {
    const total = this.chunkInfos.length;
    if (total === 0) return [];

    const results: CommitNode[][] = new Array(total);
    let nextIdx = 0;
    let completed = 0;
    let inFlight = 0;
    // Track next chunk to deliver in order
    let nextDeliver = 0;

    return new Promise<CommitNode[]>((resolve, reject) => {
      const tryDeliver = () => {
        while (nextDeliver < total && results[nextDeliver]) {
          onChunkReady?.(nextDeliver, results[nextDeliver]);
          nextDeliver++;
        }
      };

      const launch = () => {
        while (inFlight < maxConcurrency && nextIdx < total) {
          const idx = nextIdx++;
          inFlight++;
          this.fetch(idx)
            .then((commits) => {
              results[idx] = commits;
              completed++;
              inFlight--;
              onProgress?.(completed, total);
              tryDeliver();
              if (completed === total) {
                resolve(results.flat());
              } else {
                launch();
              }
            })
            .catch(reject);
        }
      };
      launch();
    });
  }
}
