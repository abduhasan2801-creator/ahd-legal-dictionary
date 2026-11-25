import type { LegalTerm, SearchHistoryItem } from '../types/legal.ts';

const DB_NAME = 'ahd_kanuni_db';
const DB_VERSION = 1;
const STORE_FAVORITES = 'favorites';
const STORE_HISTORY = 'history';
const STORE_CACHED_TERMS = 'cached_terms';
const STORE_META = 'meta';

export interface QuizProgressStats {
  quizzesCompleted: number;
  totalQuestions: number;
  totalCorrect: number;
  bestPercentage: number;
  lastPlayedAt?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        db.createObjectStore(STORE_FAVORITES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CACHED_TERMS)) {
        db.createObjectStore(STORE_CACHED_TERMS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []) as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const raw = localStorage.getItem(`ahd_${storeName}`);
    return raw ? (JSON.parse(raw) as T[]) : [];
  }
}

async function idbPut<T extends { id: string }>(storeName: string, item: T): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const existing = await idbGetAll<T>(storeName);
    const filtered = existing.filter((x) => x.id !== item.id);
    filtered.unshift(item);
    localStorage.setItem(`ahd_${storeName}`, JSON.stringify(filtered));
  }
}

async function idbDelete(storeName: string, id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const existing = await idbGetAll<{ id: string }>(storeName);
    localStorage.setItem(
      `ahd_${storeName}`,
      JSON.stringify(existing.filter((x) => x.id !== id))
    );
  }
}

async function idbClear(storeName: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    localStorage.removeItem(`ahd_${storeName}`);
  }
}

// Favorites API
export async function getFavorites(): Promise<LegalTerm[]> {
  return idbGetAll<LegalTerm>(STORE_FAVORITES);
}

export async function isFavoriteTerm(id: string): Promise<boolean> {
  const all = await getFavorites();
  return all.some((t) => t.id === id);
}

export async function addFavorite(term: LegalTerm): Promise<void> {
  await idbPut(STORE_FAVORITES, term);
}

export async function removeFavorite(id: string): Promise<void> {
  await idbDelete(STORE_FAVORITES, id);
}

// Search History API
export async function getSearchHistory(): Promise<SearchHistoryItem[]> {
  const items = await idbGetAll<SearchHistoryItem>(STORE_HISTORY);
  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function recordSearchHistory(item: SearchHistoryItem): Promise<void> {
  await idbPut(STORE_HISTORY, item);
}

export async function deleteSearchHistoryItem(id: string): Promise<void> {
  await idbDelete(STORE_HISTORY, id);
}

export async function clearSearchHistory(): Promise<void> {
  await idbClear(STORE_HISTORY);
}

// Offline Term Cache API
export async function cacheTermOffline(term: LegalTerm): Promise<void> {
  await idbPut(STORE_CACHED_TERMS, term);
}

export async function getCachedTermOffline(id: string): Promise<LegalTerm | undefined> {
  const all = await idbGetAll<LegalTerm>(STORE_CACHED_TERMS);
  return all.find((t) => t.id === id);
}

export async function getAllCachedTermsOffline(): Promise<LegalTerm[]> {
  return idbGetAll<LegalTerm>(STORE_CACHED_TERMS);
}

// Quiz Progress
export function getQuizProgress(): QuizProgressStats {
  try {
    const raw = localStorage.getItem('ahd_quiz_progress');
    if (raw) return JSON.parse(raw) as QuizProgressStats;
  } catch {
    // ignore
  }
  return {
    quizzesCompleted: 0,
    totalQuestions: 0,
    totalCorrect: 0,
    bestPercentage: 0,
  };
}

export function saveQuizResult(correct: number, total: number): QuizProgressStats {
  const current = getQuizProgress();
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const next: QuizProgressStats = {
    quizzesCompleted: current.quizzesCompleted + 1,
    totalQuestions: current.totalQuestions + total,
    totalCorrect: current.totalCorrect + correct,
    bestPercentage: Math.max(current.bestPercentage, pct),
    lastPlayedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem('ahd_quiz_progress', JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
