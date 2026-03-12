import * as d3 from 'd3';
import { normalizeCommitAuthors } from './authors';
import { getAuthorColorByEmail } from './colors';
import type { MailmapResolver } from './mailmap';
import type { BranchInfo, CommitNode, SimLink, SimNode } from './types';

export class ForceGraph {
  simulation: d3.Simulation<SimNode, SimLink>;
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  private nodeMap = new Map<string, SimNode>();
  private branchColorMap = new Map<string, string>();
  private mainBranch: string;
  private width: number;
  private height: number;
  private dirty = false;
  private pendingLinks: SimLink[] = [];
  private deferredLinks = new Map<string, { targetHash: string; branchColor: string }[]>();
  private nodeIndex = 0;
  private totalCommits = 1000;
  private authorResolver?: MailmapResolver;

  constructor(
    width: number,
    height: number,
    branches: BranchInfo[],
    mainBranch: string,
    authorResolver?: MailmapResolver,
  ) {
    this.width = width;
    this.height = height;
    this.mainBranch = mainBranch;
    this.authorResolver = authorResolver;

    for (const b of branches) {
      this.branchColorMap.set(b.name, b.color);
    }

    this.simulation = d3
      .forceSimulation<SimNode>([])
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>([])
          .id((d) => d.hash)
          .distance(25)
          .strength(0.5)
          .iterations(1),
      )
      .force('charge', d3.forceManyBody().strength(-80).theta(0.9).distanceMax(250))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.005))
      .alphaDecay(0.03)
      .velocityDecay(0.35)
      .stop();
  }

  addCommit(commit: CommitNode): void {
    if (this.nodeMap.has(commit.hash)) return;

    const node = this.createNode(commit, this.spawnX(), this.spawnY());

    this.nodes.push(node);
    this.nodeIndex++;
    this.nodeMap.set(commit.hash, node);

    for (const parentHash of commit.parent_hashes) {
      // Edge color: use the CHILD commit's original_branch color
      const edgeBranch = commit.original_branch;
      const branchColor = this.branchColorMap.get(edgeBranch)
        || this.branchColorMap.get(this.mainBranch)
        || '#8b949e';

      if (this.nodeMap.has(parentHash)) {
        this.pendingLinks.push({
          source: parentHash,
          target: commit.hash,
          branch_color: branchColor,
        });
      } else {
        let deferred = this.deferredLinks.get(parentHash);
        if (!deferred) {
          deferred = [];
          this.deferredLinks.set(parentHash, deferred);
        }
        deferred.push({ targetHash: commit.hash, branchColor });
      }
    }

    const waiting = this.deferredLinks.get(commit.hash);
    if (waiting) {
      for (const { targetHash, branchColor } of waiting) {
        this.pendingLinks.push({
          source: commit.hash,
          target: targetHash,
          branch_color: branchColor,
        });
      }
      this.deferredLinks.delete(commit.hash);
    }

    this.dirty = true;
  }

  addAllCommits(commits: CommitNode[]): void {
    for (const commit of commits) {
      if (this.nodeMap.has(commit.hash)) continue;
      const node = this.createNode(
        commit,
        this.width / 2 + (Math.random() - 0.5) * 300,
        this.height / 2 + (Math.random() - 0.5) * 300,
      );
      this.nodes.push(node);
      this.nodeMap.set(commit.hash, node);
    }
    const existingLinks = new Set(
      this.links.map((l) => `${ (l.source as SimNode).hash ?? l.source }->${ (l.target as SimNode).hash ?? l.target }`),
    );
    for (const commit of commits) {
      for (const parentHash of commit.parent_hashes) {
        if (!this.nodeMap.has(parentHash)) continue;
        const key = `${ parentHash }->${ commit.hash }`;
        if (existingLinks.has(key)) continue;
        existingLinks.add(key);
        const edgeBranch = commit.original_branch;
        const branchColor = this.branchColorMap.get(edgeBranch)
          || this.branchColorMap.get(this.mainBranch)
          || '#8b949e';
        this.pendingLinks.push({
          source: parentHash,
          target: commit.hash,
          branch_color: branchColor,
        });
      }
    }
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;

    if (this.pendingLinks.length > 0) {
      this.links.push(...this.pendingLinks);
      this.pendingLinks.length = 0;
    }

    this.simulation.nodes(this.nodes);
    const linkForce = this.simulation.force('link') as d3.ForceLink<SimNode, SimLink>;
    linkForce.links(this.links);

    const n = this.nodes.length;
    const charge = this.simulation.force('charge') as d3.ForceManyBody<SimNode>;
    if (n > 10000) {
      charge.strength(-6).distanceMax(60).theta(1.5);
    } else if (n > 5000) {
      charge.strength(-12).distanceMax(100).theta(1.2);
    } else if (n > 2000) {
      charge.strength(-20).distanceMax(120).theta(1.0);
    } else if (n > 500) {
      charge.strength(-35).distanceMax(150);
    }

    this.simulation.alpha(Math.min(0.12, this.simulation.alpha() + 0.04)).restart();
  }

  tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.simulation.tick();
    }
  }

  reheat(alpha = 0.1): void {
    this.simulation.alpha(alpha).restart();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    (this.simulation.force('center') as d3.ForceCenter<SimNode>)
      .x(width / 2)
      .y(height / 2);
  }

  reset(): void {
    this.nodes.length = 0;
    this.links.length = 0;
    this.pendingLinks.length = 0;
    this.nodeMap.clear();
    this.deferredLinks.clear();
    this.nodeIndex = 0;
    this.dirty = false;
    this.simulation.nodes([]);
    (this.simulation.force('link') as d3.ForceLink<SimNode, SimLink>).links([]);
    this.simulation.stop();
  }

  getNode(hash: string): SimNode | undefined {
    return this.nodeMap.get(hash);
  }

  setTotalCommits(n: number): void {
    this.totalCommits = Math.max(n, 1);
  }

  setAuthorResolver(resolver?: MailmapResolver): void {
    this.authorResolver = resolver;
    this.applyAuthorResolver();
  }

  applyAuthorResolver(): void {
    for (const node of this.nodes) {
      this.applyAuthorMapping(node);
    }
  }

  private createNode(commit: CommitNode, x: number, y: number): SimNode {
    const rawAuthors = commit.authors && commit.authors.length > 0
      ? commit.authors
      : [{ name: commit.author_name, email: commit.author_email, role: 'author' as const }];
    const authors = normalizeCommitAuthors({
      authors: rawAuthors,
      author_name: commit.author_name,
      author_email: commit.author_email,
    }, this.authorResolver);
    const primary = authors[0] ?? {
      name: commit.author_name,
      email: commit.author_email.trim().toLowerCase(),
    };
    const colors = authors.map((a) => getAuthorColorByEmail(a.email));
    return {
      hash: commit.hash,
      short_hash: commit.short_hash,
      authors,
      author_emails: authors.map((a) => a.email),
      author_name: primary.name,
      author_email: primary.email,
      raw_authors: rawAuthors,
      raw_author_name: commit.author_name,
      raw_author_email: commit.author_email,
      author_date: commit.author_date,
      committer_name: commit.committer_name,
      committer_email: (commit.committer_email ?? '').trim().toLowerCase(),
      committer_date: commit.committer_date,
      message: commit.message,
      branches: commit.branches,
      radius: computeRadius(commit),
      color: colors[0] ?? getAuthorColorByEmail(primary.email),
      colors,
      original_branch: commit.original_branch,
      timestamp: commit.timestamp,
      is_merge: commit.is_merge,
      is_root: commit.is_root,
      is_main_tip: commit.is_main_tip,
      child_count: commit.child_count,
      x,
      y,
    };
  }

  private applyAuthorMapping(node: SimNode): void {
    const authors = normalizeCommitAuthors({
      authors: node.raw_authors,
      author_name: node.raw_author_name,
      author_email: node.raw_author_email,
    }, this.authorResolver);
    const primary = authors[0] ?? {
      name: node.raw_author_name,
      email: node.raw_author_email.trim().toLowerCase(),
    };
    const colors = authors.map((a) => getAuthorColorByEmail(a.email));
    node.authors = authors;
    node.author_emails = authors.map((a) => a.email);
    node.author_name = primary.name;
    node.author_email = primary.email;
    node.colors = colors;
    node.color = colors[0] ?? getAuthorColorByEmail(primary.email);
  }

  /** Temporal drift from bottom-right to top-left; drift range scales with total commit count. */
  private spawnX(): number {
    const progress = Math.sqrt(this.nodeIndex / this.totalCommits);
    const driftRange = this.totalCommits * 0.15;
    return this.width / 2 + driftRange * (0.5 - progress) + (Math.random() - 0.5) * 150;
  }

  private spawnY(): number {
    const progress = Math.sqrt(this.nodeIndex / this.totalCommits);
    const driftRange = this.totalCommits * 0.08;
    return this.height / 2 + driftRange * (0.5 - progress) + (Math.random() - 0.5) * 150;
  }
}

function computeRadius(node: CommitNode): number {
  let r = 2.5;
  if (node.is_root) r += 3;
  if (node.is_main_tip) r += 3;
  if (node.child_count >= 2) r += Math.min(Math.sqrt(node.child_count) * 0.8, 3.5);
  return r;
}
