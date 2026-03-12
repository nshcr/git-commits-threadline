use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::git_graph::build_graph;
use crate::models::{ChunkData, ChunkInfo, GraphMeta};

const CHUNK_SIZE: usize = 2500;

/// Scan `repos/` directory, build graph for each repo, assemble static site in `dist/`.
pub fn export_all() -> Result<()> {
    let project_root = find_project_root()?;
    let repos_dir = project_root.join("repos");
    let frontend_dist = project_root.join("frontend").join("dist");
    let dist_dir = project_root.join("dist");

    if !repos_dir.exists() {
        anyhow::bail!(
            "repos/ directory not found at {}. Add git submodules to repos/ first.",
            repos_dir.display()
        );
    }

    if !frontend_dist.exists() {
        anyhow::bail!("frontend/dist/ not found. Run 'pnpm run build' in frontend/ first.");
    }

    // Clean and recreate dist/
    if dist_dir.exists() {
        fs::remove_dir_all(&dist_dir).context("Failed to clean dist/")?;
    }
    fs::create_dir_all(&dist_dir).context("Failed to create dist/")?;

    // Copy shared assets from frontend/dist/assets/ → dist/assets/
    let assets_src = frontend_dist.join("assets");
    if assets_src.exists() {
        copy_dir_recursive(&assets_src, &dist_dir.join("assets"))?;
    }

    // Scan repos/ for subdirectories (each is a git repo)
    let mut repos: Vec<RepoInfo> = Vec::new();
    for entry in fs::read_dir(&repos_dir).context("Failed to read repos/")? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // Skip hidden directories
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let repo_name = entry.file_name().to_string_lossy().to_string();
        println!("Processing repository: {}", repo_name);

        match build_graph(&path) {
            Ok(mut graph) => {
                let repo_dist = dist_dir.join(&repo_name);
                let data_dir = repo_dist.join("data");
                fs::create_dir_all(&data_dir)
                    .with_context(|| format!("Failed to create {}", data_dir.display()))?;

                // Sort commits oldest-first for chronological chunking
                graph.commits.sort_by_key(|c| c.timestamp);

                // Split commits into content-hashed chunks
                let mut chunk_infos: Vec<ChunkInfo> = Vec::new();
                for (chunk_idx, chunk_commits) in graph.commits.chunks(CHUNK_SIZE).enumerate() {
                    let chunk_data = ChunkData {
                        index: chunk_idx,
                        commits: chunk_commits.to_vec(),
                    };
                    let chunk_json =
                        serde_json::to_string(&chunk_data).context("Failed to serialize chunk")?;
                    let hash = content_hash(chunk_json.as_bytes());
                    let filename = format!("chunk-{}.json", hash);
                    fs::write(data_dir.join(&filename), &chunk_json)
                        .with_context(|| format!("Failed to write {}", filename))?;
                    chunk_infos.push(ChunkInfo {
                        index: chunk_idx,
                        file: filename,
                        commit_count: chunk_commits.len(),
                    });
                }

                // Write meta.json (everything except commits + chunk manifest)
                let meta = GraphMeta {
                    repo_name: graph.repo_name.clone(),
                    total_commits: graph.total_commits,
                    branches: graph.branches.clone(),
                    main_branch: graph.main_branch.clone(),
                    authors: graph.authors.clone(),
                    mailmap: graph.mailmap.clone(),
                    github_url: graph.github_url.clone(),
                    chunks: chunk_infos,
                };
                let meta_json = serde_json::to_string(&meta).context("Failed to serialize meta")?;
                fs::write(data_dir.join("meta.json"), meta_json)
                    .context("Failed to write meta.json")?;

                // Copy frontend/dist/graph.html → dist/{repo}/index.html
                //
                // When BASE_PATH is "/" (default), Vite emits root-absolute asset paths
                // like `/assets/xxx.js`. These must be converted to relative paths
                // (`../assets/xxx.js`) so they work when opening the file directly or
                // serving from a web server at the real root.
                //
                // When BASE_PATH is a sub-directory (e.g. `/git-commits-threadline/`),
                // Vite already embeds fully-qualified absolute paths such as
                // `/git-commits-threadline/assets/xxx.js`. Because GitHub Pages (and
                // any standard HTTP server) honours absolute paths from any sub-page,
                // no rewriting is needed — applying the old replacement would corrupt
                // those paths.
                let base_path = std::env::var("BASE_PATH").unwrap_or_else(|_| "/".to_string());
                let template = fs::read_to_string(frontend_dist.join("graph.html"))
                    .context("Failed to read frontend/dist/graph.html")?;
                let adjusted = if base_path == "/" {
                    // Default: rewrite absolute paths to relative for root deployments.
                    template
                        .replace("/assets/", "../assets/")
                        .replace("href=\"/", "href=\"../")
                } else {
                    // Non-root base: absolute paths with the base prefix are already
                    // correct from every sub-page — no rewriting required.
                    template
                };
                fs::write(repo_dist.join("index.html"), adjusted)
                    .with_context(|| format!("Failed to write {}/index.html", repo_name))?;

                println!(
                    "  -> {} commits, {} branches, {} authors",
                    graph.total_commits,
                    graph.branches.len(),
                    graph.authors.len()
                );

                let display_name = graph
                    .github_url
                    .as_deref()
                    .and_then(|u| u.strip_prefix("https://github.com/"))
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| graph.repo_name.clone());

                repos.push(RepoInfo {
                    display_name,
                    dir_name: repo_name,
                    total_commits: graph.total_commits,
                    branch_count: graph.branches.len(),
                    author_count: graph.authors.len(),
                    github_url: graph.github_url.clone(),
                });
            }
            Err(e) => {
                eprintln!("  [SKIP] Failed to process {}: {}", repo_name, e);
            }
        }
    }

    if repos.is_empty() {
        anyhow::bail!("No repositories found in repos/");
    }

    // Sort by display_name
    repos.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });

    // Write repos.json manifest
    let root_data_dir = dist_dir.join("data");
    fs::create_dir_all(&root_data_dir).context("Failed to create dist/data/")?;
    let repos_json = serde_json::to_string(&repos).context("Failed to serialize repos")?;
    fs::write(root_data_dir.join("repos.json"), repos_json)
        .context("Failed to write repos.json")?;

    // Copy index page from frontend build
    fs::copy(
        frontend_dist.join("index.html"),
        dist_dir.join("index.html"),
    )
    .context("Failed to copy index.html")?;

    println!(
        "\nBuild complete: {} repos -> {}",
        repos.len(),
        dist_dir.display()
    );
    Ok(())
}

#[derive(serde::Serialize)]
struct RepoInfo {
    display_name: String,
    dir_name: String,
    total_commits: usize,
    branch_count: usize,
    author_count: usize,
    github_url: Option<String>,
}

fn find_project_root() -> Result<PathBuf> {
    let mut dir = std::env::current_dir().context("Failed to get current directory")?;
    loop {
        if dir.join("repos").exists() || dir.join("frontend").exists() {
            return Ok(dir);
        }
        if !dir.pop() {
            break;
        }
    }
    // Fallback to cwd
    std::env::current_dir().context("Failed to get current directory")
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn content_hash(data: &[u8]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    data.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
