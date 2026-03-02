import './style.css';
import { escapeHtml, formatNumber } from '../utils';

interface RepoInfo {
  display_name: string;
  dir_name: string;
  total_commits: number;
  branch_count: number;
  author_count: number;
  github_url: string | null;
}

const OCTOCAT_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>`;

const FORK_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>`;

function renderPage(app: HTMLElement, repos: RepoInfo[]) {
  // Build static structure
  app.innerHTML = `
    <main class="main">
      <section class="hero">
        <div class="hero-text">
          <h1>Git Commits Threadline</h1>
          <p>Explore real repository histories as animated commit graphs.</p>
          <p>Compare commit growth, branch activity, and contributor distribution over time.</p>
        </div>
        <div class="hero-links">
          <a class="btn btn-primary" href="https://github.com/nshcr/git-commits-threadline" target="_blank" rel="noopener noreferrer">
            ${ OCTOCAT_SVG }
            View on GitHub
          </a>
        </div>
      </section>

      <div class="contribute-box">
        ${ FORK_SVG }
        <div>
          <div class="contribute-title">Want your repository listed here?</div>
          <p class="contribute-body">Submit a PR to add it to <code>repos.yml</code>.<br/>The CI pipeline will build and publish the visualization automatically. <a href="https://github.com/nshcr/git-commits-threadline?tab=readme-ov-file#contributing" target="_blank" rel="noopener noreferrer">Contributing guide &rarr;</a></p>
        </div>
      </div>

      <div class="section-header">
        <h2 class="section-title">
          Repositories
          <span class="section-count">${ repos.length }</span>
        </h2>
      </div>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Filter repositories\u2026" autocomplete="off" />
        <select id="sort-select">
          <option value="name">Name A\u2013Z</option>
          <option value="commits">Most commits</option>
          <option value="branches">Most branches</option>
          <option value="authors">Most contributors</option>
        </select>
      </div>
      <div class="repo-list" id="repo-list"></div>
    </main>

    <footer class="footer">
      <div class="footer-inner">
        &copy; 2026 <a href="https://github.com/nshcr">Junius Chen (nshcr)</a> &mdash; MIT License
      </div>
    </footer>
  `;

  const listEl = document.getElementById('repo-list')!;
  const searchEl = document.getElementById('search') as HTMLInputElement;
  const sortEl = document.getElementById('sort-select') as HTMLSelectElement;
  const countEl = app.querySelector('.section-count')!;

  // Render rows
  function renderList(data: RepoInfo[]) {
    const frag = document.createDocumentFragment();
    for (const repo of data) {
      const row = document.createElement('a');
      row.className = 'repo-row';
      row.href = `${ repo.dir_name }/`;
      row.dataset.name = repo.display_name.toLowerCase();
      row.dataset.commits = String(repo.total_commits);
      row.dataset.branches = String(repo.branch_count);
      row.dataset.authors = String(repo.author_count);

      const ghLink = repo.github_url
        ? `<a class="repo-gh-link" href="${ escapeHtml(repo.github_url) }" target="_blank" rel="noopener noreferrer" title="View on GitHub">${ OCTOCAT_SVG }</a>`
        : '';

      row.innerHTML = `
        <div class="repo-info">
          <span class="repo-name">${ escapeHtml(repo.display_name) }</span>
          ${ ghLink }
        </div>
        <div class="repo-stats">
          <span class="repo-stat">${ formatNumber(repo.total_commits) } commits</span>
          <span class="repo-stat-sep">&middot;</span>
          <span class="repo-stat">${ formatNumber(repo.branch_count) } branches</span>
          <span class="repo-stat-sep">&middot;</span>
          <span class="repo-stat">${ formatNumber(repo.author_count) } contributors</span>
        </div>
      `;
      frag.appendChild(row);
    }
    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  function filterAndSort() {
    const query = searchEl.value.toLowerCase();
    const sortBy = sortEl.value;

    let filtered = repos;
    if (query) {
      filtered = repos.filter(r => r.display_name.toLowerCase().includes(query));
    }

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'commits':
          return b.total_commits - a.total_commits;
        case 'branches':
          return b.branch_count - a.branch_count;
        case 'authors':
          return b.author_count - a.author_count;
        default:
          return a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase());
      }
    });

    renderList(sorted);
    countEl.textContent = String(sorted.length);
  }

  searchEl.addEventListener('input', filterAndSort);
  sortEl.addEventListener('change', filterAndSort);

  // Initial render (already sorted by name from backend)
  renderList(repos);
}

async function main() {
  const app = document.getElementById('app')!;
  app.innerHTML = `<main class="main"><p class="loading">Loading repositories&hellip;</p></main>`;

  try {
    const res = await fetch('data/repos.json');
    if (!res.ok) {
      // noinspection ExceptionCaughtLocallyJS
      throw new Error(`HTTP ${ res.status }`);
    }
    const repos: RepoInfo[] = await res.json();
    renderPage(app, repos);
  } catch (err) {
    app.innerHTML = `<main class="main"><p class="error">Failed to load repositories: ${ err instanceof Error ? escapeHtml(err.message) : 'Unknown error' }</p></main>`;
  }
}

main();
