import type * as d3 from 'd3';

export interface ChunkInfo {
  index: number;
  file: string;
  commit_count: number;
}

/** Metadata file — everything except commits, plus chunk manifest. */
export interface GraphMeta {
  repo_name: string;
  total_commits: number;
  branches: BranchInfo[];
  main_branch: string;
  authors: AuthorInfo[];
  mailmap?: MailmapData;
  github_url: string | null;
  chunks: ChunkInfo[];
}

export interface ChunkData {
  index: number;
  commits: CommitNode[];
}

export interface BranchInfo {
  name: string;
  color: string;
  tip_hash: string;
  is_main: boolean;
}

export interface AuthorInfo {
  name: string;
  email: string;
  commit_count: number;
}

export interface MailmapData {
  aliases: Record<string, string>;
  names: Record<string, string>;
}

export type AuthorRole = 'author' | 'co_author' | 'committer';

export interface CommitAuthor {
  name: string;
  email: string;
  /** Optional for backward compatibility with older chunk data. */
  role?: AuthorRole;
}

export interface CommitNode {
  hash: string;
  short_hash: string;
  parent_hashes: string[];
  /** Backward-compatible: may be absent in old chunk files. */
  authors?: CommitAuthor[];
  author_name: string;
  author_email: string;
  timestamp: number;
  author_date: string;
  committer_name: string;
  /** Backward-compatible: old chunk files may not contain this field. */
  committer_email?: string;
  committer_date: string;
  message: string;
  branches: string[];
  original_branch: string;
  is_merge: boolean;
  child_count: number;
  is_main_tip: boolean;
  is_root: boolean;
}

export interface SimNode extends d3.SimulationNodeDatum {
  hash: string;
  short_hash: string;
  authors: CommitAuthor[];
  author_emails: string[];
  author_name: string;
  author_email: string;
  raw_authors: CommitAuthor[];
  raw_author_name: string;
  raw_author_email: string;
  author_date: string;
  committer_name: string;
  committer_email: string;
  committer_date: string;
  message: string;
  branches: string[];
  radius: number;
  color: string;
  colors: string[];
  original_branch: string;
  timestamp: number;
  is_merge: boolean;
  is_root: boolean;
  is_main_tip: boolean;
  child_count: number;
  fx?: number | null;
  fy?: number | null;
}

export interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  branch_color: string;
}
