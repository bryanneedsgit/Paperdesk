import { getFileNameFromPath } from '../utils/fileNames';

export type RecentPdfFile = {
  fileName: string;
  filePath: string;
  openedAt: string;
};

const recentFilesStorageKey = 'paperdesk.recentFiles.v1';
const maxRecentFiles = 8;

export function readRecentPdfFiles(): RecentPdfFile[] {
  const rawValue = window.localStorage.getItem(recentFilesStorageKey);

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as RecentPdfFile[];

    return Array.isArray(parsed)
      ? parsed.filter((file) => file.filePath && file.fileName && file.openedAt)
      : [];
  } catch {
    return [];
  }
}

export function writeRecentPdfFiles(files: RecentPdfFile[]): void {
  window.localStorage.setItem(
    recentFilesStorageKey,
    JSON.stringify(files.slice(0, maxRecentFiles)),
  );
}

export function addRecentPdfFiles(
  currentFiles: RecentPdfFile[],
  filePaths: string[],
): RecentPdfFile[] {
  const openedAt = new Date().toISOString();
  const nextFilesByPath = new Map<string, RecentPdfFile>();

  for (const filePath of filePaths) {
    nextFilesByPath.set(filePath, {
      fileName: getFileNameFromPath(filePath),
      filePath,
      openedAt,
    });
  }

  for (const file of currentFiles) {
    if (!nextFilesByPath.has(file.filePath)) {
      nextFilesByPath.set(file.filePath, file);
    }
  }

  return Array.from(nextFilesByPath.values())
    .sort((first, second) => second.openedAt.localeCompare(first.openedAt))
    .slice(0, maxRecentFiles);
}

export function clearRecentPdfFiles(): void {
  window.localStorage.removeItem(recentFilesStorageKey);
}
