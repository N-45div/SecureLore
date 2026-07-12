export function parseReviewerIds(value?: string): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^U[A-Z0-9]+$/.test(item))
  );
}

export function isAuthorizedReviewer(reviewerIds: ReadonlySet<string>, userId: string): boolean {
  return reviewerIds.has(userId);
}
