export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

// Document viewing/downloading now goes through openDocument() in
// lib/apiClient.ts (authenticated fetch -> blob). The old URL-based
// handleFileAction was removed with the JWT-in-query-string change.
