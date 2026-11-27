export type MediaReviewIssue = { versionId: string; filename: string; reason: 'missing' | 'unavailable' | 'invalid' };
export type MediaReviewResult = { status: 'completed'; checked: number; issues: MediaReviewIssue[] } | { status: 'cancelled' | 'busy' };
export type LibraryMediaRemoval = { kind: 'file' | 'parent'; id: string } | { kind: 'folder' };
