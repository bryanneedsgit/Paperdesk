export function getFileNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? 'Untitled.pdf';
}
