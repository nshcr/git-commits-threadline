import type { MailmapData } from './types';

export class MailmapResolver {
  private aliases = new Map<string, string>();
  private names = new Map<string, string>();
  private reverseAliases = new Map<string, Set<string>>();
  private enabled = true;

  constructor(data?: MailmapData) {
    if (data?.aliases) {
      for (const [from, to] of Object.entries(data.aliases)) {
        const src = normalizeEmail(from);
        const dst = normalizeEmail(to);
        if (!src || !dst || src === dst) continue;
        this.aliases.set(src, dst);
      }
    }
    if (data?.names) {
      for (const [email, name] of Object.entries(data.names)) {
        const key = normalizeEmail(email);
        const trimmed = name.trim();
        if (!key || !trimmed) continue;
        this.names.set(key, trimmed);
      }
    }

    // Flatten alias chains.
    for (const key of [...this.aliases.keys()]) {
      const target = this.resolveCanonicalEmail(key);
      if (!target || target === key) {
        this.aliases.delete(key);
      } else {
        this.aliases.set(key, target);
      }
    }

    // Re-anchor names to canonical emails after flattening.
    const resolvedNames = new Map<string, string>();
    for (const [email, name] of this.names) {
      const target = this.resolveCanonicalEmail(email) || email;
      resolvedNames.set(target, name);
    }
    this.names = resolvedNames;

    this.buildReverseAliases();
  }

  hasData(): boolean {
    return this.aliases.size > 0 || this.names.size > 0;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  resolveAuthor(name: string | undefined, email: string | undefined): { name: string; email: string } {
    const rawEmail = normalizeEmail(email ?? '');
    if (!rawEmail) return { name: name?.trim() || '', email: '' };

    if (!this.enabled) {
      const rawName = (name ?? '').trim();
      return {
        name: rawName || rawEmail,
        email: rawEmail,
      };
    }

    const canonicalEmail = this.resolveCanonicalEmail(rawEmail) || rawEmail;
    const mappedName = this.names.get(canonicalEmail);
    const rawName = (name ?? '').trim();
    const displayName = (mappedName ?? rawName).trim();
    return {
      name: displayName || canonicalEmail,
      email: canonicalEmail,
    };
  }

  resolveEmail(email: string): string {
    const raw = normalizeEmail(email);
    if (!raw) return '';
    if (!this.enabled) return raw;
    return this.resolveCanonicalEmail(raw) || raw;
  }

  resolveEmailAlways(email: string): string {
    const raw = normalizeEmail(email);
    if (!raw) return '';
    return this.resolveCanonicalEmail(raw) || raw;
  }

  getCanonicalEmail(email: string): string {
    const raw = normalizeEmail(email);
    if (!raw) return '';
    return this.resolveCanonicalEmail(raw) || raw;
  }

  getCanonicalName(email: string): string | null {
    const canonical = this.getCanonicalEmail(email);
    if (!canonical) return null;
    return this.names.get(canonical) ?? null;
  }

  getAliases(email: string): string[] {
    const canonical = this.getCanonicalEmail(email);
    if (!canonical) return [];
    const aliases = this.reverseAliases.get(canonical);
    return aliases ? [...aliases] : [];
  }

  expandCanonical(email: string): string[] {
    const canonical = this.resolveCanonicalEmail(normalizeEmail(email)) || normalizeEmail(email);
    if (!canonical) return [];
    const aliases = this.reverseAliases.get(canonical);
    if (!aliases || aliases.size === 0) return [canonical];
    return [canonical, ...aliases];
  }

  private buildReverseAliases(): void {
    this.reverseAliases.clear();
    for (const [alias, canonical] of this.aliases.entries()) {
      let set = this.reverseAliases.get(canonical);
      if (!set) {
        set = new Set();
        this.reverseAliases.set(canonical, set);
      }
      set.add(alias);
    }
  }

  private resolveCanonicalEmail(email: string): string | null {
    let current = normalizeEmail(email);
    if (!current) return null;
    const seen = new Set<string>();
    while (true) {
      const next = this.aliases.get(current);
      if (!next || seen.has(next)) break;
      seen.add(current);
      current = next;
    }
    return current;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
