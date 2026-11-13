import type {Playlist} from '../types/iptv';

const DB_NAME = 'akis_iptv_db';
const DB_VERSION = 1;
const PLAYLISTS_STORE = 'playlists';
const PREFS_KEY = 'akis_iptv_prefs_v1';

export interface UserPreferences {
  activePlaylistId: string | null;
  favorites: string[];
  recentIds: string[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
        db.createObjectStore(PLAYLISTS_STORE, {keyPath: 'id'});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadAllPlaylists(): Promise<Playlist[]> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLISTS_STORE, 'readonly');
      const store = tx.objectStore(PLAYLISTS_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result as Playlist[]) || [];
        list.sort((a, b) => b.createdAt - a.createdAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function savePlaylist(playlist: Playlist): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PLAYLISTS_STORE, 'readwrite');
    const store = tx.objectStore(PLAYLISTS_STORE);
    const req = store.put(playlist);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function removePlaylist(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PLAYLISTS_STORE, 'readwrite');
    const store = tx.objectStore(PLAYLISTS_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) {
      return {activePlaylistId: null, favorites: [], recentIds: []};
    }
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      activePlaylistId: parsed.activePlaylistId ?? null,
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      recentIds: Array.isArray(parsed.recentIds) ? parsed.recentIds : [],
    };
  } catch {
    return {activePlaylistId: null, favorites: [], recentIds: []};
  }
}

export function savePreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota errors on preferences
  }
}
