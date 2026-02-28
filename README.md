# Git Commits Threadline

Visualize the complete commit history of Git repositories as animated force-directed graphs. Watch commit threads weave together across branches and contributors.

**Live site:** https://nshcr.github.io/git-commits-threadline/

## Getting Started

**Requirements:** [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/) with [pnpm](https://pnpm.io/)

```bash
git clone https://github.com/nshcr/git-commits-threadline.git
cd git-commits-threadline

cd frontend && pnpm install && cd ..
./scripts/export.sh        # builds frontend + generates graph data → dist/
npx serve dist             # preview locally
```

## Local Development — Adding Repositories

Each subdirectory under `repos/` is treated as a git repository. `repos/` is git-ignored and local-only.

```bash
# symlink, clone or copy — any works
git clone https://github.com/owner/repo.git repos/repo
ln -s /path/to/local-repo repos/local-repo
```

Then rebuild with `./scripts/export.sh`.

## CI Repository Config — `repos.yml`

`repos.yml` at the project root lists the repositories built and deployed by CI:

```yaml
repositories:
  rust-lang:
    - rust
  microsoft:
    - vscode
  torvalds:
    - linux
```

The CI workflow reads `repos.yml`, expands it to a parallel matrix (one job per repo), aggregates successful artifacts, and deploys to GitHub Pages.

## Contributing

All contributions are welcome — new repositories, UI improvements, feature requests, bug fixes, or anything else.

**Add a repository:** edit `repos.yml` and open a PR. The daily CI will start building it automatically once merged.

**Other contributions:** open an issue or PR. The codebase is straightforward — Rust backend generates graph data, Vite/TypeScript frontend renders it.

## Acknowledgements

Built on the shoulders of two excellent libraries:

- **[Gitoxide](https://github.com/GitoxideLabs/gitoxide)** — a pure-Rust Git implementation that makes traversing commit graphs both fast and a pleasure to work with
- **[D3.js](https://github.com/d3/d3)** — the force simulation and rendering backbone of every graph on this site

## A Note on Authorship

The code in this repository was written almost entirely by Claude (Opus / Sonnet). I directed the design, skimmed the output, and occasionally said "that looks wrong".

If you spot something that indeed looks wrong — feel free to summon your own Claude and have it fix things!

## License

MIT
