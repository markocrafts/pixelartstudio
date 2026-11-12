import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { parsePxf, serializePxf } from '../core/pxf';
import type { Project } from '../core/project';

export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  frames: number;
  layers: number;
  createdAt: number;
  updatedAt: number;
  /** PNG data URL of frame 1, or ''. */
  thumb: string;
  /** Size of the stored .pxf in bytes. */
  bytes: number;
}

interface Schema extends DBSchema {
  projects: { key: string; value: ProjectMeta; indexes: { updatedAt: number } };
  files: { key: string; value: Uint8Array };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>('pixelforge', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      d.createObjectStore('files');
    },
  });
  return dbPromise;
}

export const storageAvailable = (): boolean => typeof indexedDB !== 'undefined';

/** Stores a project (as .pxf) together with its listing metadata. Takes the bytes first, so callers can serialize synchronously. */
export async function putProject(meta: ProjectMeta, data: Uint8Array): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'files'], 'readwrite');
  await Promise.all([tx.objectStore('projects').put(meta), tx.objectStore('files').put(data, meta.id), tx.done]);
}

export function metaOf(p: Project, thumb: string, bytes: number): ProjectMeta {
  return { id: p.id, name: p.name, width: p.width, height: p.height, frames: p.frames.length, layers: p.layers.length, createdAt: p.createdAt, updatedAt: p.updatedAt, thumb, bytes };
}

export async function saveProject(p: Project, thumb: string): Promise<number> {
  const data = serializePxf(p);
  await putProject(metaOf(p, thumb, data.byteLength), data);
  return data.byteLength;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await (await db()).getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function hasProject(id: string): Promise<boolean> {
  return (await (await db()).getKey('projects', id)) !== undefined;
}

export async function loadProject(id: string): Promise<Project | null> {
  const data = await (await db()).get('files', id);
  return data ? parsePxf(data) : null;
}

export async function loadProjectBytes(id: string): Promise<Uint8Array | null> {
  return (await (await db()).get('files', id)) ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'files'], 'readwrite');
  await Promise.all([tx.objectStore('projects').delete(id), tx.objectStore('files').delete(id), tx.done]);
}

export async function renameStored(id: string, name: string): Promise<void> {
  const p = await loadProject(id);
  if (!p) return;
  const meta = await (await db()).get('projects', id);
  p.name = name.trim().slice(0, 128) || 'Untitled';
  const data = serializePxf(p);
  await putProject({ ...(meta ?? metaOf(p, '', data.byteLength)), name: p.name, bytes: data.byteLength }, data);
}

export interface StorageUsage { usage: number; quota: number }

export async function storageUsage(): Promise<StorageUsage | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/** True when storage use is above 80% of the quota. */
export function nearlyFull(u: StorageUsage | null): boolean {
  return !!u && u.usage / u.quota > 0.8;
}
