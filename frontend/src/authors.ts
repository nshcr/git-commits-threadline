import type { AuthorRole, CommitAuthor } from './types';

type AuthorCarrier = {
  authors?: CommitAuthor[];
  author_name: string;
  author_email: string;
};

export function normalizeCommitAuthors(commit: AuthorCarrier): CommitAuthor[] {
  const input = commit.authors && commit.authors.length > 0
    ? commit.authors
    : [{ name: commit.author_name, email: commit.author_email, role: 'author' as const }];

  const out: CommitAuthor[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    const email = a.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;

    const role = canonicalizeRole(a.role ?? inferRoleByIndex(i));
    // Committer is display-only in tooltip and must not participate in
    // legend statistics, filters, or node coloring.
    if (role === 'committer') continue;

    seen.add(email);
    out.push({
      name: a.name?.trim() || email,
      email,
      role,
    });
  }

  if (out.length === 0) {
    const email = commit.author_email.trim().toLowerCase();
    if (email) {
      out.push({
        name: commit.author_name?.trim() || email,
        email,
        role: 'author',
      });
    }
  }

  return out;
}

export function authorRoleLabel(role: AuthorRole | undefined): string {
  switch (canonicalizeRole(role)) {
    case 'author':
      return 'Author';
    case 'co_author':
      return 'Co-author';
    case 'committer':
      return 'Committer';
    default:
      return 'Author';
  }
}

function inferRoleByIndex(index: number): AuthorRole {
  // Legacy data without explicit roles: first = author, rest = co-authors.
  return index === 0 ? 'author' : 'co_author';
}

export function canonicalizeRole(role: AuthorRole | undefined): 'author' | 'co_author' | 'committer' {
  switch (role) {
    case 'co_author':
      return 'co_author';
    case 'committer':
      return 'committer';
    case 'author':
    default:
      return 'author';
  }
}
