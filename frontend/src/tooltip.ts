import type { SimNode } from './types';
import { escapeHtml } from './utils';

export class Tooltip {
  private element: HTMLDivElement;
  private mainBranch: string;
  private currentHash: string | null = null;

  constructor(element: HTMLDivElement, mainBranch: string) {
    this.element = element;
    this.mainBranch = mainBranch;
  }

  show(node: SimNode, mouseX: number, mouseY: number): void {
    if (this.currentHash === node.hash) {
      this.positionAt(mouseX, mouseY);
      return;
    }
    this.currentHash = node.hash;

    const date = new Date(node.timestamp * 1000).toLocaleString();

    // Build branch list: always include original_branch, plus tip branches, deduped
    const branchSet = new Set<string>();
    if (node.original_branch) branchSet.add(node.original_branch);
    for (const b of node.branches) branchSet.add(b);
    const branches = [...branchSet].sort((a, b) => {
      if (a === this.mainBranch) return -1;
      if (b === this.mainBranch) return 1;
      return a.localeCompare(b);
    });

    let branchesHtml = '';
    if (branches.length > 0) {
      const tags = branches
        .map((b) => `<span class="tooltip-branch-tag">${ escapeHtml(b) }</span>`)
        .join('');
      branchesHtml = `<div class="tooltip-branches">${ tags }</div>`;
    }

    this.element.innerHTML = `
      <div class="tooltip-header">${ node.short_hash }</div>
      <div class="tooltip-author">${ escapeHtml(node.author_name) } &lt;${ escapeHtml(node.author_email) }&gt;</div>
      <div class="tooltip-date">${ date }</div>
      <div class="tooltip-message">${ escapeHtml(node.message) }</div>
      ${ branchesHtml }
    `;
    this.positionAt(mouseX, mouseY);
    this.element.classList.remove('hidden');
  }

  hide(): void {
    this.element.classList.add('hidden');
    this.currentHash = null;
  }

  private positionAt(x: number, y: number): void {
    const pad = 12;
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + pad;
    let top = y + pad;
    if (left + w > vw - pad) left = x - w - pad;
    if (top + h > vh - pad) top = y - h - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;

    this.element.style.left = `${ left }px`;
    this.element.style.top = `${ top }px`;
  }
}
