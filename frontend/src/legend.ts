import { normalizeCommitAuthors } from './authors';
import { getAuthorColorByEmail } from './colors';
import type { HighlightFilter } from './renderer';
import type { BranchInfo, CommitNode } from './types';
import { escapeHtml } from './utils';

const LEGEND_SIDE_KEY = 'legend-side';

interface AuthorStat {
  email: string;
  name: string;
  count: number;
  coCount: number;
  color: string;
}

export class DynamicLegend {
  private el: HTMLDivElement;
  private repoName: string;
  private allBranches: BranchInfo[];
  private onFilterChange: (filter: HighlightFilter | null) => void;
  private isPlayingFn: () => boolean;
  private onSideChange: (side: 'left' | 'right') => void;
  private githubUrl: string | null;

  private seenBranches = new Set<string>();
  private authorMap = new Map<string, AuthorStat>();
  /** Currently selected branch names (multi-select). */
  private activeBranches = new Set<string>();
  /** Currently selected author emails (multi-select). */
  private activeAuthors = new Set<string>();
  /** Last-toggled branch name – used for scroll-to-active. */
  private lastToggledBranch: string | null = null;
  /** Last-toggled author email – used for scroll-to-active. */
  private lastToggledAuthor: string | null = null;
  /** branch name → set of author emails that committed on it */
  private branchAuthors = new Map<string, Set<string>>();
  /** author email → set of branch names they committed on */
  private authorBranches = new Map<string, Set<string>>();
  /** branch name → email → commit count on that branch */
  private branchAuthorCount = new Map<string, Map<string, number>>();
  /** branch name → email → co-authored commit count on that branch */
  private branchAuthorCoCount = new Map<string, Map<string, number>>();
  private collapsed = false;
  private side: 'left' | 'right';

  private columnsEl!: HTMLDivElement;
  private branchBody!: HTMLDivElement;
  private authorBody!: HTMLDivElement;
  private branchTitle!: HTMLDivElement;
  private authorTitle!: HTMLDivElement;
  private collapseBtn!: HTMLButtonElement;
  private moveBtn!: HTMLButtonElement;
  private branchSearchInput!: HTMLInputElement;
  private authorSearchInput!: HTMLInputElement;
  private branchSearchQuery = '';
  private authorSearchQuery = '';
  private clearAllBtn!: HTMLButtonElement;
  private clearBranchBtn!: HTMLButtonElement;
  private clearAuthorBtn!: HTMLButtonElement;
  private dirty = false;

  constructor(
    el: HTMLDivElement,
    repoName: string,
    branches: BranchInfo[],
    onFilterChange: (filter: HighlightFilter | null) => void,
    isPlayingFn: () => boolean,
    onSideChange: (side: 'left' | 'right') => void,
    githubUrl: string | null,
  ) {
    this.el = el;
    this.repoName = repoName;
    this.allBranches = branches;
    this.onFilterChange = onFilterChange;
    this.isPlayingFn = isPlayingFn;
    this.onSideChange = onSideChange;
    this.githubUrl = githubUrl;
    this.side = (localStorage.getItem(LEGEND_SIDE_KEY) as 'left' | 'right') || 'right';
    this.buildSkeleton();
    this.applySide();
  }

  trackCommit(commit: CommitNode) {
    if (commit.original_branch && !this.seenBranches.has(commit.original_branch)) {
      this.seenBranches.add(commit.original_branch);
      this.dirty = true;
    }
    const authors = normalizeCommitAuthors(commit);
    for (const author of authors) {
      const email = author.email;
      const existing = this.authorMap.get(email);
      if (existing) {
        existing.count++;
        if (author.role === 'co_author') existing.coCount++;
      } else {
        this.authorMap.set(email, {
          email,
          name: author.name,
          count: 1,
          coCount: author.role === 'co_author' ? 1 : 0,
          color: getAuthorColorByEmail(email),
        });
      }

      // Cross-index: branch ↔ author
      if (commit.original_branch) {
        let branchAuthors = this.branchAuthors.get(commit.original_branch);
        if (!branchAuthors) {
          branchAuthors = new Set();
          this.branchAuthors.set(commit.original_branch, branchAuthors);
        }
        branchAuthors.add(email);

        let authorBranches = this.authorBranches.get(email);
        if (!authorBranches) {
          authorBranches = new Set();
          this.authorBranches.set(email, authorBranches);
        }
        authorBranches.add(commit.original_branch);

        // Per-branch commit count
        let bac = this.branchAuthorCount.get(commit.original_branch);
        if (!bac) {
          bac = new Map();
          this.branchAuthorCount.set(commit.original_branch, bac);
        }
        bac.set(email, (bac.get(email) ?? 0) + 1);

        // Per-branch co-authored commit count
        let bcc = this.branchAuthorCoCount.get(commit.original_branch);
        if (!bcc) {
          bcc = new Map();
          this.branchAuthorCoCount.set(commit.original_branch, bcc);
        }
        if (author.role === 'co_author') {
          bcc.set(email, (bcc.get(email) ?? 0) + 1);
        }
      }
    }
    this.dirty = true;
  }

  reset() {
    this.seenBranches.clear();
    this.authorMap.clear();
    this.branchAuthors.clear();
    this.authorBranches.clear();
    this.branchAuthorCount.clear();
    this.branchAuthorCoCount.clear();
    this.activeBranches.clear();
    this.activeAuthors.clear();
    this.lastToggledBranch = null;
    this.lastToggledAuthor = null;
    this.onFilterChange(null);
    this.updateClearButtons();
    this.branchSearchQuery = '';
    this.authorSearchQuery = '';
    this.branchSearchInput.value = '';
    this.authorSearchInput.value = '';
    this.branchSearchInput.classList.add('hidden');
    this.authorSearchInput.classList.add('hidden');
    this.dirty = true;
    this.branchBody.innerHTML = '';
    this.authorBody.innerHTML = '';
    this.branchTitle.textContent = 'Branches (0)';
    this.authorTitle.textContent = 'Authors (0)';
  }

  clearFilter() {
    if (this.activeBranches.size === 0 && this.activeAuthors.size === 0) return;
    this.activeBranches.clear();
    this.activeAuthors.clear();
    this.lastToggledBranch = null;
    this.lastToggledAuthor = null;
    this.onFilterChange(null);
    this.dirty = true;
    this.render();
    this.updateClearButtons();
  }

  render() {
    if (!this.dirty) return;
    this.dirty = false;
    this.renderBranches();
    this.renderAuthors();
    this.scrollToActive();
  }

  private clearColumnFilter(type: 'branch' | 'author') {
    if (this.isPlayingFn()) return;
    if (type === 'branch') {
      if (this.activeBranches.size === 0) return;
      this.activeBranches.clear();
      this.lastToggledBranch = null;
    } else {
      if (this.activeAuthors.size === 0) return;
      this.activeAuthors.clear();
      this.lastToggledAuthor = null;
    }
    const hasAny = this.activeBranches.size > 0 || this.activeAuthors.size > 0;
    this.onFilterChange(hasAny
      ? { branches: new Set(this.activeBranches), authors: new Set(this.activeAuthors) }
      : null);
    this.dirty = true;
    this.render();
    this.updateClearButtons();
  }

  private updateClearButtons() {
    const hasBranch = this.activeBranches.size > 0;
    const hasAuthor = this.activeAuthors.size > 0;
    this.clearAllBtn.classList.toggle('hidden', !hasBranch && !hasAuthor);
    this.clearBranchBtn.classList.toggle('hidden', !hasBranch);
    this.clearAuthorBtn.classList.toggle('hidden', !hasAuthor);
  }

  private scrollToActive() {
    if (this.lastToggledBranch) {
      const el = this.branchBody.querySelector<HTMLElement>(
        `[data-branch="${ CSS.escape(this.lastToggledBranch) }"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
    if (this.lastToggledAuthor) {
      const el = this.authorBody.querySelector<HTMLElement>(
        `[data-email="${ CSS.escape(this.lastToggledAuthor) }"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }

  private buildSkeleton() {
    const displayName = this.getDisplayName();
    const ghLink = this.githubUrl
      ? `<a class="legend-gh-link" href="${ escapeHtml(this.githubUrl) }" target="_blank" rel="noopener noreferrer" title="View on GitHub"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg></a>`
      : '';
    const searchSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><line x1="10.2" y1="10.2" x2="14" y2="14"/></svg>`;
    this.el.innerHTML = `
      <div class="legend-header">
        <div class="legend-repo-info">
          <span class="legend-repo-name">${ escapeHtml(displayName) }</span>
          ${ ghLink }
        </div>
        <button class="legend-header-btn legend-clear-all-btn hidden" id="legend-clear-all-btn" title="Clear all selections">×</button>
        <button class="legend-header-btn" id="legend-move-btn" title="Move legend">\u2194</button>
        <button class="legend-header-btn" id="legend-collapse-btn" title="Collapse legend">\u25BC</button>
      </div>
      <div class="legend-columns" id="legend-columns">
        <div class="legend-section">
          <div class="legend-title-bar">
            <div class="legend-title" id="legend-branch-title">Branches (0)</div>
            <div class="legend-title-actions">
              <button class="legend-clear-col-btn hidden" id="legend-clear-branch-btn" title="Clear branch selections">×</button>
              <button class="legend-search-btn" id="legend-branch-search-btn" title="Search branches">${ searchSvg }</button>
            </div>
          </div>
          <input class="legend-search-input hidden" id="legend-branch-search" type="search" placeholder="Filter branches\u2026" autocomplete="off" />
          <div class="legend-body" id="legend-branch-body"></div>
        </div>
        <div class="legend-section">
          <div class="legend-title-bar">
            <div class="legend-title" id="legend-author-title">Authors (0)</div>
            <div class="legend-title-actions">
              <button class="legend-clear-col-btn hidden" id="legend-clear-author-btn" title="Clear author selections">×</button>
              <button class="legend-search-btn" id="legend-author-search-btn" title="Search authors">${ searchSvg }</button>
            </div>
          </div>
          <input class="legend-search-input hidden" id="legend-author-search" type="search" placeholder="Filter authors\u2026" autocomplete="off" />
          <div class="legend-body" id="legend-author-body"></div>
        </div>
      </div>`;
    this.columnsEl = this.el.querySelector('#legend-columns') as HTMLDivElement;
    this.branchBody = this.el.querySelector('#legend-branch-body') as HTMLDivElement;
    this.authorBody = this.el.querySelector('#legend-author-body') as HTMLDivElement;
    this.branchTitle = this.el.querySelector('#legend-branch-title') as HTMLDivElement;
    this.authorTitle = this.el.querySelector('#legend-author-title') as HTMLDivElement;
    this.collapseBtn = this.el.querySelector('#legend-collapse-btn') as HTMLButtonElement;
    this.moveBtn = this.el.querySelector('#legend-move-btn') as HTMLButtonElement;
    this.branchSearchInput = this.el.querySelector('#legend-branch-search') as HTMLInputElement;
    this.authorSearchInput = this.el.querySelector('#legend-author-search') as HTMLInputElement;
    this.clearAllBtn = this.el.querySelector('#legend-clear-all-btn') as HTMLButtonElement;
    this.clearBranchBtn = this.el.querySelector('#legend-clear-branch-btn') as HTMLButtonElement;
    this.clearAuthorBtn = this.el.querySelector('#legend-clear-author-btn') as HTMLButtonElement;

    this.collapseBtn.addEventListener('click', () => this.toggleCollapse());
    this.moveBtn.addEventListener('click', () => this.toggleSide());
    this.clearAllBtn.addEventListener('click', () => this.clearFilter());
    this.clearBranchBtn.addEventListener('click', () => this.clearColumnFilter('branch'));
    this.clearAuthorBtn.addEventListener('click', () => this.clearColumnFilter('author'));

    const branchSearchBtn = this.el.querySelector('#legend-branch-search-btn') as HTMLButtonElement;
    const authorSearchBtn = this.el.querySelector('#legend-author-search-btn') as HTMLButtonElement;
    branchSearchBtn.addEventListener('click', () => {
      this.branchSearchInput.classList.toggle('hidden');
      if (!this.branchSearchInput.classList.contains('hidden')) this.branchSearchInput.focus();
      else {
        this.branchSearchInput.value = '';
        this.branchSearchQuery = '';
        this.applyBranchSearch();
      }
    });
    authorSearchBtn.addEventListener('click', () => {
      this.authorSearchInput.classList.toggle('hidden');
      if (!this.authorSearchInput.classList.contains('hidden')) this.authorSearchInput.focus();
      else {
        this.authorSearchInput.value = '';
        this.authorSearchQuery = '';
        this.applyAuthorSearch();
      }
    });
    this.branchSearchInput.addEventListener('input', () => {
      this.branchSearchQuery = this.branchSearchInput.value.toLowerCase();
      this.applyBranchSearch();
    });
    this.authorSearchInput.addEventListener('input', () => {
      this.authorSearchQuery = this.authorSearchInput.value.toLowerCase();
      this.applyAuthorSearch();
    });
  }

  private getDisplayName(): string {
    if (this.githubUrl) {
      const match = this.githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (match) return match[1];
    }
    return this.repoName;
  }

  private applyBranchSearch() {
    this.branchBody.querySelectorAll<HTMLElement>('[data-branch]').forEach(el => {
      const name = el.dataset.branch!.toLowerCase();
      el.style.display = !this.branchSearchQuery || name.includes(this.branchSearchQuery) ? '' : 'none';
    });
  }

  private applyAuthorSearch() {
    this.authorBody.querySelectorAll<HTMLElement>('[data-email]').forEach(el => {
      const name = el.querySelector('.legend-label')?.textContent?.toLowerCase() ?? '';
      const email = el.dataset.email!.toLowerCase();
      el.style.display = !this.authorSearchQuery || name.includes(this.authorSearchQuery) || email.includes(this.authorSearchQuery) ? '' : 'none';
    });
  }

  private toggleCollapse() {
    this.collapsed = !this.collapsed;
    this.el.classList.toggle('legend-collapsed', this.collapsed);
    this.collapseBtn.textContent = this.collapsed ? '\u25B6' : '\u25BC';
    this.collapseBtn.title = this.collapsed ? 'Expand legend' : 'Collapse legend';
  }

  private toggleSide() {
    this.side = this.side === 'right' ? 'left' : 'right';
    localStorage.setItem(LEGEND_SIDE_KEY, this.side);
    this.applySide();
    this.onSideChange(this.side);
  }

  private applySide() {
    this.el.classList.toggle('legend-left', this.side === 'left');
    this.onSideChange(this.side);
  }

  private renderBranches() {
    // When authors are selected, only show branches any selected author committed on.
    const hasAuthorFilter = this.activeAuthors.size > 0;
    const visible = this.allBranches.filter(b => {
      if (!this.seenBranches.has(b.name)) return false;
      if (!hasAuthorFilter) return true;
      const bAuthors = this.branchAuthors.get(b.name);
      if (!bAuthors) return false;
      for (const email of this.activeAuthors) {
        if (bAuthors.has(email)) return true;
      }
      return false;
    });
    this.branchTitle.textContent = `Branches (${ visible.length })`;

    const existing = new Set<string>();
    this.branchBody.querySelectorAll<HTMLElement>('[data-branch]').forEach(el => existing.add(el.dataset.branch!));

    let needsRebuild = existing.size !== visible.length;
    if (!needsRebuild) for (const b of visible) {
      if (!existing.has(b.name)) {
        needsRebuild = true;
        break;
      }
    }
    if (!needsRebuild) {
      this.branchBody.querySelectorAll<HTMLElement>('[data-branch]').forEach(el => {
        el.classList.toggle('legend-item-active', this.activeBranches.has(el.dataset.branch!));
      });
      return;
    }

    const frag = document.createDocumentFragment();
    for (const b of visible) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.dataset.branch = b.name;
      if (this.activeBranches.has(b.name)) item.classList.add('legend-item-active');
      const labelText = `${ escapeHtml(b.name) }${ b.is_main ? ' (main)' : '' }`;
      item.innerHTML = `<div class="legend-line" style="background:${ b.color }"></div>
        <span class="legend-label" title="${ escapeHtml(b.name) }">${ labelText }</span>`;
      item.addEventListener('click', () => this.toggleFilter('branch', b.name));
      frag.appendChild(item);
    }
    this.branchBody.innerHTML = '';
    this.branchBody.appendChild(frag);
    if (this.branchSearchQuery) this.applyBranchSearch();
  }

  private renderAuthors() {
    // When branches are selected, only show authors who committed on any selected branch,
    // and show counts summed across all selected branches.
    const hasBranchFilter = this.activeBranches.size > 0;

    // Build a combined per-author count across all selected branches.
    let combinedCounts: Map<string, number> | null = null;
    let combinedCoCounts: Map<string, number> | null = null;
    if (hasBranchFilter) {
      combinedCounts = new Map();
      combinedCoCounts = new Map();
      for (const branch of this.activeBranches) {
        const bac = this.branchAuthorCount.get(branch);
        const bcc = this.branchAuthorCoCount.get(branch);
        if (!bac) continue;
        for (const [email, cnt] of bac) {
          combinedCounts.set(email, (combinedCounts.get(email) ?? 0) + cnt);
        }
        if (bcc) {
          for (const [email, cnt] of bcc) {
            combinedCoCounts.set(email, (combinedCoCounts.get(email) ?? 0) + cnt);
          }
        }
      }
    }

    const sorted = [...this.authorMap.values()]
      .filter(a => !hasBranchFilter || (combinedCounts?.has(a.email) ?? false))
      .map(a => ({
        ...a,
        displayCount: combinedCounts ? (combinedCounts.get(a.email) ?? 0) : a.count,
        displayCoCount: combinedCoCounts ? (combinedCoCounts.get(a.email) ?? 0) : a.coCount,
      }))
      .sort((a, b) => b.displayCount - a.displayCount);
    this.authorTitle.textContent = `Authors (${ sorted.length })`;

    const frag = document.createDocumentFragment();
    for (const author of sorted) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.dataset.email = author.email;
      if (this.activeAuthors.has(author.email)) item.classList.add('legend-item-active');
      const coCountTitle = 'Co-authored commits';
      item.innerHTML = `<div class="legend-dot" style="background:${ author.color }"></div>
        <span class="legend-label" title="${ escapeHtml(author.email) }">${ escapeHtml(author.name) }</span>
        <span class="legend-count">${ author.displayCount.toLocaleString() }<span class="legend-co-count" title="${ coCountTitle }">(${ author.displayCoCount.toLocaleString() })</span></span>`;
      item.addEventListener('click', () => this.toggleFilter('author', author.email));
      frag.appendChild(item);
    }
    this.authorBody.innerHTML = '';
    this.authorBody.appendChild(frag);
    if (this.authorSearchQuery) this.applyAuthorSearch();
  }

  private toggleFilter(type: 'branch' | 'author', value: string) {
    if (this.isPlayingFn()) return;
    if (type === 'branch') {
      if (this.activeBranches.has(value)) {
        this.activeBranches.delete(value);
        if (this.lastToggledBranch === value) this.lastToggledBranch = null;
      } else {
        this.activeBranches.add(value);
        this.lastToggledBranch = value;
      }
    } else {
      if (this.activeAuthors.has(value)) {
        this.activeAuthors.delete(value);
        if (this.lastToggledAuthor === value) this.lastToggledAuthor = null;
      } else {
        this.activeAuthors.add(value);
        this.lastToggledAuthor = value;
      }
    }
    const hasAny = this.activeBranches.size > 0 || this.activeAuthors.size > 0;
    this.onFilterChange(hasAny
      ? { branches: new Set(this.activeBranches), authors: new Set(this.activeAuthors) }
      : null);
    this.dirty = true;
    this.render();
    this.updateClearButtons();
  }
}
