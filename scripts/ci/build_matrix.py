#!/usr/bin/env python3
# pyright: reportMissingImports=false, reportMissingModuleSource=false
"""Build GitHub Actions matrix from config/github-repos.yml."""

from __future__ import annotations

import argparse
import json
import yaml
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build matrix from github-repos.yml")
    parser.add_argument(
        "--config",
        default="repos.yml",
        help="Path to repos.yml",
    )
    parser.add_argument(
        "--matrix-out",
        default="matrix.json",
        help="Output path for matrix JSON",
    )
    parser.add_argument(
        "--count-out",
        default="count.txt",
        help="Output path for repository count",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config_path = Path(args.config)

    with config_path.open("r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}

    repositories = cfg.get("repositories", {}) or {}

    include: list[dict[str, str]] = []
    for owner, repos in repositories.items():
        for repo in repos or []:
            slug = f"{owner}__{repo}".replace("/", "__")
            include.append({"owner": owner, "repo": repo, "slug": slug})

    matrix = {"include": include}

    matrix_out = Path(args.matrix_out)
    matrix_out.write_text(json.dumps(matrix), encoding="utf-8")

    count_out = Path(args.count_out)
    count_out.write_text(str(len(include)), encoding="utf-8")


if __name__ == "__main__":
    main()
