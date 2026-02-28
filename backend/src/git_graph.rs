use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result};
use gix::revision::walk::Sorting;
use gix::traverse::commit::simple::CommitTimeOrder;

use crate::models::{AuthorInfo, BranchInfo, CommitNode, GraphData};

#[rustfmt::skip]
const BRANCH_PALETTE: &[&str] = &[
    // Vivid reds / pinks
    "#ff4444", "#ff4da6", "#e84393", "#c44569",
    // Vivid oranges / yellows
    "#ff8c00", "#ffa502", "#eccc68", "#fdcb6e",
    // Greens
    "#2ed573", "#20bf6b", "#44bd32", "#6ab04c",
    // Cyans / teals
    "#00cec9", "#00d2d3", "#1289a7", "#22a6b3",
    // Blues
    "#1e90ff", "#0984e3", "#4a69bd", "#0652dd",
    // Indigos / violets
    "#5352ed", "#6c5ce7", "#8854d0", "#7e57c2",
    // Purples / magentas
    "#9c88ff", "#f368e0", "#a29bfe", "#da77f2",
    // Classic Kelly colors (dark-bg friendly)
    "#e6194b", "#3cb44b", "#4363d8", "#f58231",
    "#911eb4", "#42d4f4", "#f032e6", "#bfef45",
    "#469990", "#9A6324", "#aaffc3", "#808000",
    "#ffd8b1", "#a9a9a9", "#dcbeff", "#fabed4",
    // Additional distinctive
    "#ff6b81", "#7bed9f", "#70a1ff", "#b8e994",
    "#55efc4", "#fd79a8", "#e17055", "#00b894",
    "#d63031", "#74b9ff", "#a3cb38", "#ff7675",
];

struct RawCommit {
    hash: String,
    short_hash: String,
    parent_hashes: Vec<String>,
    author_name: String,
    author_email: String,
    timestamp: i64,
    author_date: String,
    committer_name: String,
    committer_date: String,
    message: String,
}

pub fn build_graph(repo_path: &Path) -> Result<GraphData> {
    let repo = gix::discover(repo_path).context("Failed to open git repository")?;

    // Collect all branches (local + remote)
    let references = repo.references().context("Failed to access references")?;
    let mut branches_raw: Vec<(String, gix::ObjectId)> = Vec::new();

    // Local branches
    for reference in references
        .local_branches()
        .context("Failed to list branches")?
        .flatten()
    {
        let name = reference.name().shorten().to_string();
        let oid = reference
            .into_fully_peeled_id()
            .context("Failed to peel reference")?
            .detach();
        branches_raw.push((name, oid));
    }

    // Remote branches (refs/remotes/*)
    let references = repo.references().context("Failed to access references")?;
    for reference in references
        .remote_branches()
        .context("Failed to list remote branches")?
        .flatten()
    {
        let full = reference.name().shorten().to_string();
        let oid = reference
            .into_fully_peeled_id()
            .context("Failed to peel reference")?
            .detach();
        if full.ends_with("/HEAD") {
            continue;
        }
        let short = full.split('/').skip(1).collect::<Vec<_>>().join("/");
        if branches_raw.iter().any(|(name, _)| *name == short) {
            continue;
        }
        branches_raw.push((full, oid));
    }

    if branches_raw.is_empty() {
        anyhow::bail!("No branches found in repository");
    }

    // Identify main branch
    let main_branch_name = detect_main_branch(&repo, &branches_raw)?;

    // Walk all commits from all branch tips
    let tip_ids: Vec<gix::ObjectId> = branches_raw.iter().map(|(_, id)| *id).collect();

    let walk = repo
        .rev_walk(tip_ids)
        .sorting(Sorting::ByCommitTime(CommitTimeOrder::NewestFirst))
        .all()
        .context("Failed to start revision walk")?;

    // Collect all commits
    let mut raw_commits: Vec<RawCommit> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for info in walk {
        let info = info.context("Failed to read commit during walk")?;
        let hash = info.id.to_string();
        if !seen.insert(hash.clone()) {
            continue;
        }
        let short_hash = hash[..7].to_string();
        let parent_hashes: Vec<String> = info.parent_ids.iter().map(|id| id.to_string()).collect();
        let timestamp = info.commit_time.unwrap_or(0) as i64;

        let commit = repo
            .find_commit(info.id)
            .context("Failed to find commit object")?;
        let author = commit.author().context("Failed to read author")?;
        let author_name = author.name.to_string();
        let author_email = author.email.to_string();
        let author_date = format_timestamp(author.seconds());

        let committer = commit.committer().context("Failed to read committer")?;
        let committer_name = committer.name.to_string();
        let committer_date = format_timestamp(committer.seconds());

        let message = commit
            .message()
            .map(|m| m.title.to_string())
            .unwrap_or_default()
            .trim()
            .to_string();

        raw_commits.push(RawCommit {
            hash,
            short_hash,
            parent_hashes,
            author_name,
            author_email,
            timestamp,
            author_date,
            committer_name,
            committer_date,
            message,
        });
    }

    // Sort oldest first
    raw_commits.sort_by_key(|c| c.timestamp);

    // Build parent→children map for child_count
    let mut child_count_map: HashMap<String, usize> = HashMap::new();
    for rc in &raw_commits {
        for parent in &rc.parent_hashes {
            *child_count_map.entry(parent.clone()).or_insert(0) += 1;
        }
    }

    // Build parent lookup for first-parent chasing
    let parent_map: HashMap<&str, &[String]> = raw_commits
        .iter()
        .map(|c| (c.hash.as_str(), c.parent_hashes.as_slice()))
        .collect();
    let all_hashes: HashSet<String> = raw_commits.iter().map(|c| c.hash.clone()).collect();

    // --- First-parent chain for main branch ---
    let main_tip_hash = branches_raw
        .iter()
        .find(|(name, _)| name == &main_branch_name)
        .map(|(_, id)| id.to_string())
        .unwrap_or_default();

    let mut main_first_parent: HashSet<String> = HashSet::new();
    {
        let mut current = main_tip_hash.clone();
        while all_hashes.contains(&current) {
            main_first_parent.insert(current.clone());
            if let Some(parents) = parent_map.get(current.as_str()) {
                if let Some(first) = parents.first() {
                    current = first.clone();
                } else {
                    break;
                }
            } else {
                break;
            }
        }
    }

    // --- Assign original_branch for each commit ---
    //
    // Strategy: "closest-tip wins".
    // For every commit that is NOT on the main first-parent chain we record
    // (branch_name, depth_from_tip) for each branch whose first-parent chain
    // reaches it before hitting main.  The branch with the smallest depth
    // wins, breaking ties by preferring the branch that appears first in
    // branches_raw (which has local branches before remotes).
    //
    // This avoids the old "first-branch-wins" bug where an ephemeral
    // locally-checked-out branch could steal commits that logically belong
    // to a longer-lived named branch.

    // commit_hash → (best_depth, branch_name)
    let mut commit_best: HashMap<String, (usize, String)> = HashMap::new();

    for (branch_name, tip_oid) in &branches_raw {
        if branch_name == &main_branch_name {
            continue;
        }
        let tip_hash = tip_oid.to_string();
        let mut current = tip_hash;
        let mut depth: usize = 0;
        while all_hashes.contains(&current) {
            if main_first_parent.contains(&current) {
                break;
            }
            let entry = commit_best.entry(current.clone());
            match entry {
                std::collections::hash_map::Entry::Occupied(mut e) => {
                    if depth < e.get().0 {
                        e.insert((depth, branch_name.clone()));
                    }
                    // If same depth, keep existing (preserves branches_raw order priority).
                }
                std::collections::hash_map::Entry::Vacant(e) => {
                    e.insert((depth, branch_name.clone()));
                }
            }
            if let Some(parents) = parent_map.get(current.as_str()) {
                if let Some(first) = parents.first() {
                    current = first.clone();
                    depth += 1;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
    }

    let mut original_branch_map: HashMap<String, String> = HashMap::new();

    // Assign main first-parent commits
    for h in &main_first_parent {
        original_branch_map.insert(h.clone(), main_branch_name.clone());
    }

    // Apply best-branch assignments for non-main commits
    for (hash, (_, branch_name)) in commit_best {
        original_branch_map.insert(hash, branch_name);
    }

    // Any remaining commits (unreachable from any branch tip before main) default to main
    for rc in &raw_commits {
        original_branch_map
            .entry(rc.hash.clone())
            .or_insert_with(|| main_branch_name.clone());
    }

    // --- Build tip_branches: map from tip hash → branch names (multiple branches may share a tip) ---
    let mut tip_hash_to_branches: HashMap<String, Vec<String>> = HashMap::new();
    for (name, oid) in &branches_raw {
        tip_hash_to_branches
            .entry(oid.to_string())
            .or_default()
            .push(name.clone());
    }

    // --- Build AuthorInfo (deduplicated by email) ---
    let mut email_to_names: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for rc in &raw_commits {
        let email = rc.author_email.to_lowercase();
        let entry = email_to_names.entry(email).or_default();
        *entry.entry(rc.author_name.clone()).or_insert(0) += 1;
    }
    let mut authors: Vec<AuthorInfo> = email_to_names
        .into_iter()
        .map(|(email, names)| {
            let total: usize = names.values().sum();
            let name = names
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .map(|(n, _)| n)
                .unwrap_or_default();
            AuthorInfo {
                name,
                email,
                commit_count: total,
            }
        })
        .collect();
    authors.sort_by(|a, b| b.commit_count.cmp(&a.commit_count));

    // --- Build CommitNode list ---
    let commits: Vec<CommitNode> = raw_commits
        .iter()
        .map(|rc| {
            let original_branch = original_branch_map
                .get(&rc.hash)
                .cloned()
                .unwrap_or_else(|| main_branch_name.clone());
            let branches: Vec<String> = tip_hash_to_branches
                .get(&rc.hash)
                .cloned()
                .unwrap_or_default();
            CommitNode {
                hash: rc.hash.clone(),
                short_hash: rc.short_hash.clone(),
                parent_hashes: rc.parent_hashes.clone(),
                author_name: rc.author_name.clone(),
                author_email: rc.author_email.clone(),
                timestamp: rc.timestamp,
                author_date: rc.author_date.clone(),
                committer_name: rc.committer_name.clone(),
                committer_date: rc.committer_date.clone(),
                message: rc.message.clone(),
                branches,
                original_branch,
                is_merge: rc.parent_hashes.len() > 1,
                child_count: child_count_map.get(&rc.hash).copied().unwrap_or(0),
                is_main_tip: rc.hash == main_tip_hash,
                is_root: rc.parent_hashes.is_empty(),
            }
        })
        .collect();

    let total_commits = commits.len();

    // Build BranchInfo list
    let branches: Vec<BranchInfo> = branches_raw
        .iter()
        .enumerate()
        .map(|(i, (name, tip_oid))| BranchInfo {
            name: name.clone(),
            color: if name == &main_branch_name {
                "#8b949e".to_string()
            } else {
                BRANCH_PALETTE[i % BRANCH_PALETTE.len()].to_string()
            },
            tip_hash: tip_oid.to_string(),
            is_main: name == &main_branch_name,
        })
        .collect();

    // Derive repo name
    let repo_name = repo_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let github_url = extract_github_url(&repo);

    Ok(GraphData {
        repo_name,
        total_commits,
        branches,
        commits,
        main_branch: main_branch_name,
        authors,
        github_url,
    })
}

fn extract_github_url(repo: &gix::Repository) -> Option<String> {
    let remote_names = repo.remote_names();
    for name in remote_names.iter() {
        let Ok(remote) = repo.find_remote(name.as_ref()) else {
            continue;
        };
        let Some(url_obj) = remote.url(gix::remote::Direction::Fetch) else {
            continue;
        };
        let url_str = url_obj.to_bstring().to_string();
        if let Some(gh_url) = parse_github_url(&url_str) {
            return Some(gh_url);
        }
    }
    None
}

fn parse_github_url(url: &str) -> Option<String> {
    // https://github.com/owner/repo or https://github.com/owner/repo.git
    if let Some(rest) = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
    {
        let path = rest.trim_end_matches(".git");
        let mut parts = path.splitn(2, '/');
        let owner = parts.next().unwrap_or("");
        let repo = parts.next().unwrap_or("");
        if !owner.is_empty() && !repo.is_empty() {
            return Some(format!("https://github.com/{owner}/{repo}"));
        }
    }
    // git@github.com:owner/repo.git
    if let Some(rest) = url.strip_prefix("git@github.com:") {
        let path = rest.trim_end_matches(".git");
        let mut parts = path.splitn(2, '/');
        let owner = parts.next().unwrap_or("");
        let repo = parts.next().unwrap_or("");
        if !owner.is_empty() && !repo.is_empty() {
            return Some(format!("https://github.com/{owner}/{repo}"));
        }
    }
    None
}

fn detect_main_branch(
    repo: &gix::Repository,
    branches: &[(String, gix::ObjectId)],
) -> Result<String> {
    for preferred in &["main", "master"] {
        if branches.iter().any(|(name, _)| name == preferred) {
            return Ok(preferred.to_string());
        }
    }
    if let Ok(head) = repo.head_ref() {
        if let Some(head_ref) = head {
            let name = head_ref.name().shorten().to_string();
            return Ok(name);
        }
    }
    Ok(branches[0].0.clone())
}

fn format_timestamp(seconds: gix::date::SecondsSinceUnixEpoch) -> String {
    let secs = seconds as i64;
    chrono_from_epoch(secs)
}

fn chrono_from_epoch(secs: i64) -> String {
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;
    let (year, month, day) = days_to_ymd(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn days_to_ymd(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}
