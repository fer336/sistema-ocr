export function driveFileIdFromLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/\/d\/([^/]+)/);
  return match ? match[1] : null;
}

export function drivePreviewUrl(link: string | null): string | null {
  const fileId = driveFileIdFromLink(link);
  return fileId ? `https://drive.google.com/file/d/${fileId}/preview` : null;
}
