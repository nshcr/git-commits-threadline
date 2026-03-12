use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub repo_name: String,
    pub total_commits: usize,
    pub branches: Vec<BranchInfo>,
    pub commits: Vec<CommitNode>,
    pub main_branch: String,
    pub authors: Vec<AuthorInfo>,
    pub mailmap: Mailmap,
    pub github_url: Option<String>,
}

/// Metadata file (meta.json) — everything except commits, plus chunk manifest.
#[derive(Debug, Clone, Serialize)]
pub struct GraphMeta {
    pub repo_name: String,
    pub total_commits: usize,
    pub branches: Vec<BranchInfo>,
    pub main_branch: String,
    pub authors: Vec<AuthorInfo>,
    pub mailmap: Mailmap,
    pub github_url: Option<String>,
    pub chunks: Vec<ChunkInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChunkInfo {
    pub index: usize,
    pub file: String,
    pub commit_count: usize,
}

/// Single chunk file content.
#[derive(Debug, Clone, Serialize)]
pub struct ChunkData {
    pub index: usize,
    pub commits: Vec<CommitNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub color: String,
    pub tip_hash: String,
    pub is_main: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorInfo {
    pub name: String,
    pub email: String,
    pub commit_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Mailmap {
    pub aliases: std::collections::HashMap<String, String>,
    pub names: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitAuthor {
    pub name: String,
    pub email: String,
    pub role: AuthorRole,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorRole {
    Author,
    CoAuthor,
    Committer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitNode {
    pub hash: String,
    pub short_hash: String,
    pub parent_hashes: Vec<String>,
    pub authors: Vec<CommitAuthor>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub author_date: String,
    pub committer_name: String,
    pub committer_email: String,
    pub committer_date: String,
    pub message: String,
    pub branches: Vec<String>,
    pub original_branch: String,
    pub is_merge: bool,
    pub child_count: usize,
    pub is_main_tip: bool,
    pub is_root: bool,
}
