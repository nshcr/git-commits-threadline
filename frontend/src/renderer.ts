import * as d3 from 'd3';
import type { SimLink, SimNode } from './types';

export interface HighlightFilter {
  /** Selected branch names. Empty set = no branch restriction. */
  branches: Set<string>;
  /** Selected author emails (lower-cased). Empty set = no author restriction. */
  authors: Set<string>;
}

export class GraphRenderer {
  transform: d3.ZoomTransform = d3.zoomIdentity;
  zoomBehavior: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  highlightFilter: HighlightFilter | null = null;
  /** The node the cursor is currently hovering over (null = none). Set by the caller. */
  hoveredNode: SimNode | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private quadtree: d3.Quadtree<SimNode> | null = null;
  private quadtreeDirty = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;

    this.zoomBehavior = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.01, 10])
      .on('zoom', (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        this.transform = event.transform;
      });
  }

  invalidateQuadtree(): void {
    this.quadtreeDirty = true;
  }

  render(): void {
    const { ctx, canvas, transform, dpr } = this;
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    ctx.setTransform(
      dpr * transform.k,
      0,
      0,
      dpr * transform.k,
      dpr * transform.x,
      dpr * transform.y,
    );

    // Compute visible region in simulation coordinates for culling
    const [vx0, vy0] = transform.invert([0, 0]);
    const [vx1, vy1] = transform.invert([cw / dpr, ch / dpr]);
    const pad = 20 / transform.k;
    const minX = vx0 - pad, minY = vy0 - pad;
    const maxX = vx1 + pad, maxY = vy1 + pad;

    const drawBorders = transform.k > 0.08;
    const drawArrows = transform.k > 0.3;
    const hasFilter = this.highlightFilter !== null &&
      (this.highlightFilter.branches.size > 0 || this.highlightFilter.authors.size > 0);
    const dimAlphaNode = 0.08;
    const dimAlphaLink = 0.05;

    // === Draw edges ===
    ctx.lineWidth = Math.max(0.3, 1 / transform.k);

    // Separate links into highlighted and dimmed groups
    const linksByColor = new Map<string, SimLink[]>();
    const dimLinksByColor = new Map<string, SimLink[]>();

    for (const link of this.links) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      if (s.x === undefined || t.x === undefined) continue;
      if ((s.x! < minX && t.x! < minX) || (s.x! > maxX && t.x! > maxX) ||
        (s.y! < minY && t.y! < minY) || (s.y! > maxY && t.y! > maxY)) continue;

      const hi = this.isLinkHighlighted(link);
      const map = (hasFilter && !hi) ? dimLinksByColor : linksByColor;
      let arr = map.get(link.branch_color);
      if (!arr) {
        arr = [];
        map.set(link.branch_color, arr);
      }
      arr.push(link);
    }

    // Draw dimmed links first (behind)
    if (hasFilter) {
      ctx.globalAlpha = dimAlphaLink;
      for (const [color, links] of dimLinksByColor) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (const link of links) {
          const s = link.source as SimNode;
          const t = link.target as SimNode;
          ctx.moveTo(s.x!, s.y!);
          ctx.lineTo(t.x!, t.y!);
        }
        ctx.stroke();
      }
    }

    // Draw highlighted (or all) links
    ctx.globalAlpha = 0.35;
    for (const [color, links] of linksByColor) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const link of links) {
        const s = link.source as SimNode;
        const t = link.target as SimNode;
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
      }
      ctx.stroke();
    }

    // Draw arrows on highlighted links
    if (drawArrows) {
      ctx.globalAlpha = hasFilter ? 0.6 : 0.4;
      const arrowSize = Math.min(4, 3 / transform.k + 1);
      for (const [color, links] of linksByColor) {
        ctx.fillStyle = color;
        for (const link of links) {
          const s = link.source as SimNode; // parent
          const t = link.target as SimNode; // child
          const dx = t.x! - s.x!;
          const dy = t.y! - s.y!;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len < 1) continue;
          // Arrow at target end, offset by target radius
          const ux = dx / len;
          const uy = dy / len;
          const ax = t.x! - ux * (t.radius + 2);
          const ay = t.y! - uy * (t.radius + 2);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - ux * arrowSize - uy * arrowSize * 0.5, ay - uy * arrowSize + ux * arrowSize * 0.5);
          ctx.lineTo(ax - ux * arrowSize + uy * arrowSize * 0.5, ay - uy * arrowSize - ux * arrowSize * 0.5);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // === Draw nodes ===
    // Dimmed nodes first
    const nodesByColor = new Map<string, SimNode[]>();
    const dimNodesByColor = new Map<string, SimNode[]>();
    const multiNodes: SimNode[] = [];
    const dimMultiNodes: SimNode[] = [];
    const highlightedNodes: SimNode[] = [];
    const specialNodes: SimNode[] = []; // root / tip for special markers

    for (const node of this.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      if (node.x! < minX || node.x! > maxX || node.y! < minY || node.y! > maxY) continue;

      if (node.is_root || node.is_main_tip) specialNodes.push(node);

      const hi = this.isNodeHighlighted(node);
      const isDimmed = hasFilter && !hi;
      const palette = (node.colors && node.colors.length > 0) ? node.colors : [node.color];
      if (!isDimmed) {
        highlightedNodes.push(node);
      }
      if (palette.length > 1) {
        (isDimmed ? dimMultiNodes : multiNodes).push(node);
      } else {
        const map = isDimmed ? dimNodesByColor : nodesByColor;
        const key = palette[0] ?? node.color;
        let arr = map.get(key);
        if (!arr) {
          arr = [];
          map.set(key, arr);
        }
        arr.push(node);
      }
    }

    // Draw dimmed nodes
    if (hasFilter) {
      ctx.globalAlpha = dimAlphaNode;
      for (const [color, nodes] of dimNodesByColor) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const node of nodes) {
          ctx.moveTo(node.x! + node.radius, node.y!);
          ctx.arc(node.x!, node.y!, node.radius, 0, 2 * Math.PI);
        }
        ctx.fill();
      }
      for (const node of dimMultiNodes) {
        this.drawNodeFill(node);
      }
    }

    // Draw highlighted (or all) nodes
    ctx.globalAlpha = 1.0;
    for (const [color, nodes] of nodesByColor) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const node of nodes) {
        ctx.moveTo(node.x! + node.radius, node.y!);
        ctx.arc(node.x!, node.y!, node.radius, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    for (const node of multiNodes) {
      this.drawNodeFill(node);
    }

    // Draw borders (only on non-dimmed nodes; dimmed nodes use low-alpha fill only)
    if (drawBorders) {
      const borderAlpha = Math.min(0.9, 0.3 + transform.k * 0.5);
      ctx.strokeStyle = `rgba(255,255,255,${ borderAlpha })`;
      ctx.lineWidth = Math.max(0.3, Math.min(1.2, 0.5 * transform.k)) / transform.k;
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      for (const node of highlightedNodes) {
        ctx.moveTo(node.x! + node.radius, node.y!);
        ctx.arc(node.x!, node.y!, node.radius, 0, 2 * Math.PI);
      }
      ctx.stroke();
    }

    // === Hover highlight ring ===
    // Drawn before special markers so special-node rings paint on top.
    const hov = this.hoveredNode;
    if (hov && hov.x !== undefined && hov.y !== undefined) {
      const nx = hov.x!;
      const ny = hov.y!;
      if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
        const ringW = Math.max(0.6, 1.5 / transform.k);
        // Inner bright ring
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = ringW;
        ctx.beginPath();
        ctx.arc(nx, ny, hov.radius + ringW * 1.8, 0, 2 * Math.PI);
        ctx.stroke();
        // Outer soft halo
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = ringW * 2.5;
        ctx.beginPath();
        ctx.arc(nx, ny, hov.radius + ringW * 4.5, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }

    // === Draw special markers for root and tip nodes ===
    if (drawBorders && specialNodes.length > 0) {
      ctx.globalAlpha = 1.0;
      const ringWidth = Math.max(0.8, 1.5 / transform.k);
      ctx.lineWidth = ringWidth;

      for (const node of specialNodes) {
        const hi = hasFilter ? this.isNodeHighlighted(node) : true;
        if (!hi) continue;

        if (node.is_root) {
          // Double ring in green
          ctx.strokeStyle = '#3fb950';
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, node.radius + ringWidth * 1.5, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, node.radius + ringWidth * 3.5, 0, 2 * Math.PI);
          ctx.stroke();
        }

        if (node.is_main_tip) {
          // Ring in blue + diamond marker
          ctx.strokeStyle = '#58a6ff';
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, node.radius + ringWidth * 1.5, 0, 2 * Math.PI);
          ctx.stroke();

          // Diamond outside the ring
          const d = node.radius + ringWidth * 4;
          ctx.fillStyle = '#58a6ff';
          ctx.beginPath();
          ctx.moveTo(node.x!, node.y! - d);
          ctx.lineTo(node.x! + d * 0.5, node.y!);
          ctx.lineTo(node.x!, node.y! + d);
          ctx.lineTo(node.x! - d * 0.5, node.y!);
          ctx.closePath();
          ctx.fill();
          // Redraw node on top of diamond
          this.drawNodeFill(node);
        }
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  findNodeAtPoint(clientX: number, clientY: number): SimNode | null {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const [simX, simY] = this.transform.invert([cssX, cssY]);

    if (this.quadtreeDirty || !this.quadtree) {
      this.quadtree = d3
        .quadtree<SimNode>()
        .x((d) => d.x ?? 0)
        .y((d) => d.y ?? 0)
        .addAll(this.nodes);
      this.quadtreeDirty = false;
    }

    // MAX_RADIUS must cover the largest possible node radius (see computeRadius in graph.ts:
    // base 2.5 + root bonus 3 + tip bonus 3 + child-count bonus max 3.5 = 12).
    // simX/simY are already in simulation coordinates, so the search box uses sim units directly.
    // The old code used `12 / transform.k` which is incorrect and made the search radius
    // far too small at high zoom levels (k > 1), causing miss-hits on large nodes.
    const MAX_RADIUS = 12;
    const candidates: SimNode[] = [];

    this.quadtree.visit((quad, x0, y0, x1, y1) => {
      if (x0 > simX + MAX_RADIUS || x1 < simX - MAX_RADIUS ||
        y0 > simY + MAX_RADIUS || y1 < simY - MAX_RADIUS) {
        return true;
      }
      if (!('length' in quad)) {
        let q: d3.QuadtreeLeaf<SimNode> | undefined = quad as d3.QuadtreeLeaf<SimNode>;
        while (q) {
          const node = q.data;
          const dx = simX - (node.x ?? 0);
          const dy = simY - (node.y ?? 0);
          const d2 = dx * dx + dy * dy;
          if (d2 < node.radius * node.radius) {
            candidates.push(node);
          }
          q = q.next;
        }
      }
      return false;
    });

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Tiebreak: normalised distance  d² / r²  (0 = dead-centre, ~1 = at the edge).
    // The node that the cursor is most "central" relative to its own radius wins.
    //
    // Additionally, when a highlight filter is active, highlighted nodes receive a strong
    // priority boost (their effective ratio is divided by HIGHLIGHT_BOOST) so that the cursor
    // always snaps to a highlighted node when it overlaps with a dimmed one.  This matches
    // user expectation: you selected a branch/author to inspect it — the hover should follow
    // the highlighted set rather than randomly landing on dimmed neighbours.
    const HIGHLIGHT_BOOST = 20; // highlighted node's ratio is divided by this → it wins unless
                                // a non-highlighted node is essentially dead-centre (ratio < 1/20)
    const effectiveRatio = (node: SimNode, d2: number): number => {
      const base = d2 / (node.radius * node.radius);
      const isActive = this.highlightFilter !== null &&
        (this.highlightFilter.branches.size > 0 || this.highlightFilter.authors.size > 0);
      return (isActive && this.isNodeHighlighted(node)) ? base / HIGHLIGHT_BOOST : base;
    };

    const dx0 = simX - (candidates[0].x ?? 0);
    const dy0 = simY - (candidates[0].y ?? 0);
    let best = candidates[0];
    let bestRatio = effectiveRatio(best, dx0 * dx0 + dy0 * dy0);
    for (let i = 1; i < candidates.length; i++) {
      const n = candidates[i];
      const dx = simX - (n.x ?? 0);
      const dy = simY - (n.y ?? 0);
      const ratio = effectiveRatio(n, dx * dx + dy * dy);
      if (ratio < bestRatio) {
        best = n;
        bestRatio = ratio;
      }
    }
    return best;
  }

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = `${ width }px`;
    this.canvas.style.height = `${ height }px`;
  }

  private isNodeHighlighted(node: SimNode): boolean {
    if (!this.highlightFilter) return true;
    const { branches, authors } = this.highlightFilter;
    // AND semantics across dimensions: a node must satisfy ALL non-empty filters.
    // Within each dimension it's OR (any selected branch / any selected author).
    const branchOk = branches.size === 0 || branches.has(node.original_branch);
    const authorOk = authors.size === 0 || node.author_emails.some((email) => authors.has(email));
    return branchOk && authorOk;
  }

  private drawNodeFill(node: SimNode): void {
    const x = node.x;
    const y = node.y;
    if (x === undefined || y === undefined) return;
    const colors = (node.colors && node.colors.length > 0) ? node.colors : [node.color];
    if (colors.length <= 1) {
      this.ctx.fillStyle = colors[0] ?? node.color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, node.radius, 0, 2 * Math.PI);
      this.ctx.fill();
      return;
    }

    const step = (2 * Math.PI) / colors.length;
    for (let i = 0; i < colors.length; i++) {
      const start = -Math.PI / 2 + i * step;
      const end = start + step;
      this.ctx.fillStyle = colors[i];
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
      this.ctx.arc(x, y, node.radius, start, end);
      this.ctx.closePath();
      this.ctx.fill();
    }
  }

  private isLinkHighlighted(link: SimLink): boolean {
    if (!this.highlightFilter) return true;
    const { branches, authors } = this.highlightFilter;
    if (branches.size === 0 && authors.size === 0) return true;
    // A link is highlighted iff at least one endpoint node is highlighted.
    // Using cross-product (branchOk from one end, authorOk from the other) causes
    // "ghost links": a nshcr-authored node on master → a non-nshcr node on branch X
    // would satisfy branchOk (from target) AND authorOk (from source), making the
    // link appear highlighted even though both endpoints are correctly dimmed.
    return this.isNodeHighlighted(link.source as SimNode) ||
      this.isNodeHighlighted(link.target as SimNode);
  }
}
