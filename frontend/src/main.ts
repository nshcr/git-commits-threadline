import * as d3 from 'd3';
import { AnimationController } from './animation';
import { fetchMeta } from './api';
import { ChunkLoader } from './chunk-loader';
import { getAuthorColorByEmail } from './colors';
import { ForceGraph } from './graph';
import { DynamicLegend } from './legend';
import { MailmapResolver } from './mailmap';
import { GraphRenderer } from './renderer';
import { Tooltip } from './tooltip';
import type { GraphMeta, SimNode } from './types';

async function main() {
  const mailmapPrefKey = 'legend-mailmap-enabled';
  const canvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
  const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
  const stepBackBtn = document.getElementById('step-back-btn') as HTMLButtonElement;
  const stepFwdBtn = document.getElementById('step-fwd-btn') as HTMLButtonElement;
  const progressWrap = document.getElementById('progress-wrap') as HTMLDivElement;
  const progressBar = document.getElementById('progress-bar') as HTMLDivElement;
  const commitCounter = document.getElementById('commit-counter') as HTMLSpanElement;
  const dateDisplay = document.getElementById('date-display') as HTMLSpanElement;
  const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
  const speedValue = document.getElementById('speed-value') as HTMLSpanElement;
  const tooltipEl = document.getElementById('tooltip') as HTMLDivElement;
  const legendEl = document.getElementById('legend') as HTMLDivElement;
  const playHint = document.getElementById('play-hint');
  const backBtn = document.getElementById('back-btn') as HTMLAnchorElement;
  const modeAnimateBtn = document.getElementById('mode-animate-btn') as HTMLButtonElement;
  const modeSnapshotBtn = document.getElementById('mode-snapshot-btn') as HTMLButtonElement;
  const controlsEl = document.getElementById('controls') as HTMLDivElement;
  const snapshotDot = document.getElementById('snapshot-dot') as HTMLSpanElement;
  const snapshotLabel = document.getElementById('snapshot-label') as HTMLSpanElement;
  const loadingOverlay = document.getElementById('loading-overlay') as HTMLDivElement;
  const loadingText = document.getElementById('loading-text') as HTMLDivElement;
  const loadingProgressWrap = document.getElementById('loading-progress-wrap') as HTMLDivElement;
  const loadingProgressBar = document.getElementById('loading-progress-bar') as HTMLDivElement;
  const loadingProgressText = document.getElementById('loading-progress-text') as HTMLDivElement;
  const chunkIndicator = document.getElementById('chunk-indicator') as HTMLDivElement;

  // --- Phase 1: Fetch metadata ---
  loadingText.textContent = 'Loading metadata\u2026';
  loadingProgressWrap.classList.add('hidden');
  const meta: GraphMeta = await fetchMeta();
  const repoDisplayName = getRepoDisplayName(meta);
  document.title = `${ repoDisplayName } - Git Commits Threadline`;
  commitCounter.textContent = `0 / ${ meta.total_commits.toLocaleString() }`;

  const chunkLoader = new ChunkLoader(meta.chunks);
  const mailmap = new MailmapResolver(meta.mailmap);
  const storedMailmapPref = localStorage.getItem(mailmapPrefKey);
  const defaultMailmapEnabled = mailmap.hasData();
  const mailmapEnabled = mailmap.hasData()
    ? (storedMailmapPref === null ? defaultMailmapEnabled : storedMailmapPref === '1')
    : false;
  mailmap.setEnabled(mailmapEnabled);

  // --- Setup rendering ---
  const renderer = new GraphRenderer(canvas);
  const resizeCanvas = () => renderer.resize(window.innerWidth, window.innerHeight);
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const forceGraph = new ForceGraph(
    window.innerWidth,
    window.innerHeight,
    meta.branches,
    meta.main_branch,
    mailmap,
  );
  forceGraph.setTotalCommits(meta.total_commits);
  window.addEventListener('resize', () => forceGraph.resize(window.innerWidth, window.innerHeight));

  for (const author of meta.authors) {
    const email = mailmapEnabled ? mailmap.resolveEmailAlways(author.email) : author.email;
    getAuthorColorByEmail(email);
  }

  const animation = new AnimationController(meta.total_commits);

  let legend: DynamicLegend;
  const remapAuthorSelection = (authors: Set<string>, enabled: boolean): Set<string> => {
    const next = new Set<string>();
    if (!mailmap.hasData()) return new Set(authors);
    if (enabled) {
      for (const email of authors) {
        const resolved = mailmap.resolveEmailAlways(email);
        if (resolved) next.add(resolved);
      }
    } else {
      for (const email of authors) {
        const aliases = mailmap.expandCanonical(email);
        if (aliases.length === 0) continue;
        for (const alias of aliases) next.add(alias);
      }
    }
    return next;
  };
  const handleMailmapToggle = (enabled: boolean) => {
    localStorage.setItem(mailmapPrefKey, enabled ? '1' : '0');
    mailmap.setEnabled(enabled);
    forceGraph.applyAuthorResolver();
    const active = legend.getActiveFilters();
    const remappedAuthors = remapAuthorSelection(active.authors, enabled);
    legend.rebuildFromNodes(forceGraph.nodes, {
      branches: active.branches,
      authors: remappedAuthors,
    });
    renderer.invalidateQuadtree();
  };

  legend = new DynamicLegend(
    legendEl,
    repoDisplayName,
    meta.branches,
    (filter) => {
      renderer.highlightFilter = filter;
    },
    () => animation.getIsPlaying(),
    (side) => {
      backBtn.classList.toggle('back-btn-right', side === 'left');
    },
    meta.github_url ?? null,
    {
      resolver: mailmap,
      enabled: mailmapEnabled,
      available: mailmap.hasData(),
      onToggle: handleMailmapToggle,
    },
  );

  const tooltip = new Tooltip(tooltipEl, meta.main_branch);

  const resetGraph = () => {
    forceGraph.reset();
    renderer.nodes = [];
    renderer.links = [];
    legend.reset();
  };

  // --- Mode state ---
  let mode: 'animate' | 'snapshot' = 'animate';
  let snapshotSettling = false;
  let snapshotDateRange = '';
  let chunkStreamingStarted = false;

  // --- Animation callbacks ---
  animation.setCallbacks(
    (commit) => {
      forceGraph.addCommit(commit);
      legend.trackCommit(commit);
    },
    (_dayIndex, totalDays, commitsSoFar, totalCommits, dateLabel) => {
      const dayIdx = animation.getCurrentDayIndex();
      const pct = totalDays > 0 ? (dayIdx / totalDays) * 100 : 0;
      progressBar.style.width = `${ pct }%`;
      commitCounter.textContent = `${ commitsSoFar.toLocaleString() } / ${ totalCommits.toLocaleString() }`;
      dateDisplay.textContent = formatDateLabel(dateLabel);
      playBtn.innerHTML = animation.getIsPlaying() ? '&#9646;&#9646;' : '&#9654;';
      legend.render();
    },
    resetGraph,
    (waiting) => {
      chunkIndicator.classList.toggle('hidden', !waiting);
    },
  );

  // --- Phase 2: Fetch first chunk, then show UI ---
  loadingText.textContent = 'Loading initial data\u2026';
  const firstChunk = await chunkLoader.fetch(0);
  animation.appendCommits(firstChunk);

  // Prefetch next chunks
  chunkLoader.prefetch(1, 3);

  loadingOverlay.classList.add('hidden');
  if (playHint) playHint.classList.remove('hidden');

  // --- Background chunk streaming for animate mode ---
  async function startChunkStreaming() {
    if (chunkStreamingStarted) return;
    chunkStreamingStarted = true;
    for (let i = 1; i < chunkLoader.totalChunks; i++) {
      const commits = await chunkLoader.fetch(i);
      animation.appendCommits(commits);
      // Prefetch upcoming chunks
      chunkLoader.prefetch(i + 1, 3);
    }
    animation.setAllLoaded();
  }

  // Start streaming immediately in background
  startChunkStreaming();

  // --- Mode switching ---
  async function switchToSnapshot() {
    mode = 'snapshot';
    modeAnimateBtn.classList.remove('mode-btn-active');
    modeSnapshotBtn.classList.add('mode-btn-active');
    controlsEl.classList.add('snapshot');
    if (playHint) playHint.classList.add('hidden');
    chunkIndicator.classList.add('hidden');

    animation.stop();

    // Show loading overlay with progress bar
    loadingText.textContent = 'Loading all commits\u2026';
    loadingProgressWrap.classList.remove('hidden');
    loadingProgressBar.style.width = '0%';
    loadingProgressText.textContent = '';
    loadingOverlay.classList.remove('hidden');

    forceGraph.setTotalCommits(meta.total_commits);

    await chunkLoader.fetchAll(
      6,
      (_index, commits) => {
        for (const commit of commits) {
          forceGraph.addCommit(commit);
          legend.trackCommit(commit);
        }
      },
      (loaded, total) => {
        const pct = (loaded / total) * 100;
        loadingProgressBar.style.width = `${ pct }%`;
        loadingProgressText.textContent = `${ loaded } / ${ total } chunks`;
      },
    );

    forceGraph.flush();
    forceGraph.reheat(0.3);

    loadingOverlay.classList.add('hidden');

    commitCounter.textContent = `${ meta.total_commits.toLocaleString() } commits`;
    snapshotDot.classList.remove('settled');
    snapshotLabel.textContent = 'Settling\u2026';
    snapshotSettling = true;

    // Compute date range from first and last loaded chunks
    const firstChunkData = chunkLoader.getChunk(0);
    const lastChunkData = chunkLoader.getChunk(chunkLoader.totalChunks - 1);
    if (firstChunkData && lastChunkData && firstChunkData.length > 0 && lastChunkData.length > 0) {
      const oldest = firstChunkData[0];
      const newest = lastChunkData[lastChunkData.length - 1];
      snapshotDateRange = `${ formatMonthYear(oldest.author_date) } \u2013 ${ formatMonthYear(newest.author_date) }`;
    } else {
      snapshotDateRange = '';
    }

    legend.render();
  }

  function switchToAnimate() {
    mode = 'animate';
    modeAnimateBtn.classList.add('mode-btn-active');
    modeSnapshotBtn.classList.remove('mode-btn-active');
    controlsEl.classList.remove('snapshot');
    snapshotSettling = false;
    animation.stop();
    if (playHint) playHint.classList.remove('hidden');
  }

  function handlePlay() {
    if (mode === 'snapshot') return;
    if (playHint && !playHint.classList.contains('hidden')) {
      playHint.classList.add('hidden');
    }
    legend.clearFilter();
    animation.togglePlay();
  }

  // --- Render loop ---
  function renderLoop() {
    forceGraph.flush();
    const n = forceGraph.nodes.length;
    const ticks = n < 1000 ? 3 : n < 5000 ? 2 : n < 15000 ? 1 : 0;
    if (ticks > 0 && forceGraph.simulation.alpha() > 0.001) forceGraph.tick(ticks);
    if (snapshotSettling && forceGraph.simulation.alpha() < 0.01) {
      snapshotSettling = false;
      snapshotDot.classList.add('settled');
      snapshotLabel.textContent = snapshotDateRange;
    }
    renderer.nodes = forceGraph.nodes;
    renderer.links = forceGraph.links;
    renderer.invalidateQuadtree();
    renderer.render();
    requestAnimationFrame(renderLoop);
  }

  renderLoop();

  // --- Drag support ---
  let draggedNode: SimNode | null = null;
  let isDragging = false;

  renderer.zoomBehavior.filter((event: Event) => {
    const e = event as PointerEvent | MouseEvent | WheelEvent;
    if (e.type === 'wheel') return true;
    if (e.type === 'dblclick') return true;
    if (e.type === 'mousedown' || e.type === 'pointerdown' || e.type === 'touchstart') {
      if ('clientX' in e && renderer.findNodeAtPoint(e.clientX, e.clientY)) return false;
      return !e.ctrlKey && !('button' in e && e.button);
    }
    return true;
  });
  d3.select(canvas).call(renderer.zoomBehavior);

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const hit = renderer.findNodeAtPoint(e.clientX, e.clientY);
    if (!hit) return;
    draggedNode = hit;
    isDragging = false;
    hit.fx = hit.x;
    hit.fy = hit.y;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    tooltip.hide();
    // Keep renderer.hoveredNode as-is during the drag so the hover ring stays visible.
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!draggedNode) return;
    isDragging = true;
    const t = renderer.transform;
    const rect = canvas.getBoundingClientRect();
    draggedNode.fx = (e.clientX - rect.left - t.x) / t.k;
    draggedNode.fy = (e.clientY - rect.top - t.y) / t.k;
    forceGraph.reheat(0.1);
  });

  canvas.addEventListener('pointerup', () => {
    if (!draggedNode) return;
    draggedNode.fx = null;
    draggedNode.fy = null;
    draggedNode = null;
    isDragging = false;
    canvas.style.cursor = 'grab';
    // hoveredNode will be re-evaluated naturally on the next mousemove.
  });

  // --- Controls ---
  if (playHint) playHint.addEventListener('click', () => handlePlay());
  playBtn.addEventListener('click', () => handlePlay());
  stopBtn.addEventListener('click', () => animation.stop());
  stepBackBtn.addEventListener('click', () => {
    animation.stepBackward();
    forceGraph.flush();
  });
  stepFwdBtn.addEventListener('click', () => {
    animation.stepForward();
    forceGraph.flush();
  });

  speedSlider.addEventListener('input', () => {
    const multiplier = parseInt(speedSlider.value, 10) / 2;
    animation.setSpeed(multiplier);
    speedValue.textContent = formatSpeed(multiplier);
  });

  modeAnimateBtn.addEventListener('click', () => {
    if (mode !== 'animate') switchToAnimate();
  });
  modeSnapshotBtn.addEventListener('click', () => {
    if (mode !== 'snapshot') switchToSnapshot();
  });

  // --- Progress bar drag ---
  let isSeeking = false;
  let seekRafPending = false;

  function seekFromEvent(e: MouseEvent) {
    const rect = progressWrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetDay = Math.floor(pct * animation.getTotalDays());
    if (seekRafPending) return;
    seekRafPending = true;
    requestAnimationFrame(() => {
      animation.seekTo(targetDay);
      forceGraph.flush();
      seekRafPending = false;
    });
  }

  progressWrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isSeeking = true;
    document.body.classList.add('seeking');
    seekFromEvent(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (isSeeking) seekFromEvent(e);
  });
  document.addEventListener('mouseup', () => {
    if (isSeeking) {
      isSeeking = false;
      document.body.classList.remove('seeking');
    }
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (mode === 'snapshot') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        handlePlay();
        break;
      case 'ArrowRight':
        e.preventDefault();
        animation.stepForward();
        forceGraph.flush();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        animation.stepBackward();
        forceGraph.flush();
        break;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (draggedNode || isDragging) return;
    const node = renderer.findNodeAtPoint(e.clientX, e.clientY);
    renderer.hoveredNode = node;
    if (node) {
      tooltip.show(node, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.hide();
      canvas.style.cursor = 'grab';
    }
  });
  canvas.addEventListener('mouseleave', () => {
    renderer.hoveredNode = null;
    tooltip.hide();
  });
}

function formatSpeed(multiplier: number): string {
  return multiplier % 1 === 0 ? `${ multiplier }x` : `${ multiplier.toFixed(1) }x`;
}

function formatDateLabel(dateLabel: string): string {
  if (!dateLabel) return '';
  const d = new Date(dateLabel + 'T00:00:00');
  if (isNaN(d.getTime())) return dateLabel;
  return d.toLocaleDateString();
}

function formatMonthYear(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.substring(0, 7);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function getRepoDisplayName(meta: GraphMeta): string {
  if (meta.github_url) {
    const match = meta.github_url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
    if (match) return `${ match[1] }/${ match[2] }`;
  }
  return meta.repo_name;
}

main().catch((err) => {
  console.error('Failed to initialize:', err);
  const counter = document.getElementById('commit-counter');
  if (counter) counter.textContent = `Error: ${ err.message }`;
});
