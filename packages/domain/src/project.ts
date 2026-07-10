/** A project observed across one or more sessions. (§10.2) */
export interface Project {
  id: string;
  sourceId: string;
  displayName: string;
  /** Stable hash of the canonical project path. */
  pathHash: string;
  /** Privacy-mode-aware redacted relative path, when permitted. */
  redactedPath?: string;
  /** Hash of the git remote URL, when available. */
  repositoryRemoteHash?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
