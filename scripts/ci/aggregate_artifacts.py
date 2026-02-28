#!/usr/bin/env python3
"""Aggregate successful per-repo artifacts into final-dist."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aggregate successful repository artifacts")
    parser.add_argument(
        "--collected-dir",
        default="collected",
        help="Directory containing downloaded artifacts",
    )
    parser.add_argument(
        "--pattern",
        default="repo-graph-*",
        help="Artifact directory glob pattern",
    )
    parser.add_argument(
        "--output-dir",
        default="final-dist",
        help="Final output directory",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    collected_dir = Path(args.collected_dir)
    final_dist = Path(args.output_dir)

    if final_dist.exists():
        shutil.rmtree(final_dist)
    (final_dist / "data").mkdir(parents=True, exist_ok=True)

    artifact_dirs = sorted(collected_dir.glob(args.pattern))
    if not artifact_dirs:
        raise SystemExit("No successful graph artifacts found.")

    repos: list[dict] = []
    copied_shell = False

    for artifact in artifact_dirs:
        meta = artifact / "meta.json"
        index_html = artifact / "index.html"
        assets = artifact / "assets"
        repos_root = artifact / "repositories"

        if not (meta.exists() and repos_root.exists()):
            continue

        if not copied_shell:
            if index_html.exists():
                shutil.copy2(index_html, final_dist / "index.html")
            if assets.exists():
                shutil.copytree(assets, final_dist / "assets", dirs_exist_ok=True)
            copied_shell = True

        with meta.open("r", encoding="utf-8") as f:
            item = json.load(f)
        repos.append(item)

        for repo_dir in repos_root.iterdir():
            if repo_dir.is_dir():
                shutil.copytree(repo_dir, final_dist / repo_dir.name, dirs_exist_ok=True)

    if not copied_shell:
        raise SystemExit("No valid artifacts with index/assets were found.")

    repos.sort(key=lambda x: x.get("display_name", "").lower())
    with (final_dist / "data" / "repos.json").open("w", encoding="utf-8") as f:
        json.dump(repos, f, ensure_ascii=False)

    if not repos:
        raise SystemExit("No successful repo metadata found after aggregation.")

    print(f"Assembled {len(repos)} repositories into {final_dist}/")


if __name__ == "__main__":
    main()
