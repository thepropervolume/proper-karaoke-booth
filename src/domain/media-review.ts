export type MediaReviewIssue = { versionId: string; filename: string; reason: 'missing' | 'unavailable' | 'invalid' };
export type MediaReviewResult = { status: 'completed'; checked: number; issues: MediaReviewIssue[] } | { status: 'cancelled' | 'busy' };
