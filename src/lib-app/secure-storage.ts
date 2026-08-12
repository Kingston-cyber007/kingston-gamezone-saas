/**
 * secure-storage.ts — Chiffrement opportuniste du reliquat PII jour-J
 *
 * ND2 — Phase B — Fix #9 (audit 2026-08-03)
 *
 * But : rendre illisible `kg_caisse_v3` (champs PII jour-J) à un observateur
 * qui ouvre DevTools sans déclencher de prompt utilisateur.
 *
 * ⚠️ LIMITE HONNÊTE (lue en intégralité avant toute modification) :
 *   Ce module NE protège PAS contre un XSS actif. Si un attaquant peut
 *   exécuter du JS dans l'app (cf. Fix #1 — `escapeHtml` est la vraie
 *   défense contre XSS), il peut appeler `decryptPII()` exactement comme
 *   l'app le fait, et lire la PII en clair en RAM. La clé IndexedDB est
 *   elle-même accessible au même code JS.
 *
 *   Ce module protège uniquement contre :
 *     - DevTools occasionnel (F12 → Application → Local Storage).
 *     - Extension navigateur lisant `localStorage` sans exécuter le bundle.
 *     - Fuite partielle d'un backup profil navigateur.
 *
 *   Il NE protège PAS contre :
 *     - XSS actif (Fix #1 + sanitisation = vraie défense).
 *     - Accès root au device (compromission IndexedDB + localStorage).
 *     - Attaquant avec accès exécution JS dans l'origine (peut appeler ce module).
 *
 *   Cette honnêteté est VOLONTAIRE. Documenter une fausse protection
 *   ("on est chiffré donc on est safe") est pire que pas de chiffrement
 *   du tout — ça endort la vigilance.
 *
 * Architecture :
 *   - Clé AES-GCM 256 bits générée au premier appel via `getOrCreateKey()`.
 *   - Clé stockée dans IndexedDB (DB `kg_secure`, store `keys`, id `pii-v1`).
 *   - On chiffre les champs PII avant écriture dans Zustand `partialize`.
 *   - On déchiffre au boot via `merge()` Zustand.
 *   - Si le module échoue (IndexedDB indisponible, Web Crypto absent),
 *     on DÉGRADE proprement : la PII reste en clair (comportement Phase A
 *     inchangé). On ne lève pas d'exception qui crasherait l'app.
 *
 * API publique :
 *   - `encryptPII(plain: string): Promise<string>` → base64(iv + ciphertext + tag)
 *   - `decryptPII(payload: string): Promise<string>` → plain (ou '' si échec)
 *   - `isSecureStorageAvailable(): boolean` → check Web Crypto + IndexedDB
 *
 * Pas de dépendance externe (Web Crypto + IndexedDB natifs).
 */

const DB_NAME = 'kg_secure';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const KEY_ID = 'pii-v1';

let cachedKey: CryptoKey | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

/** Ouvre (ou crée) la base IndexedDB. Lazy. */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open error'));
  });
  return dbPromise;
}

/** Récupère ou génère la clé AES-GCM 256 bits. */
async function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API indisponible');
  }

  // Tente de charger la clé existante depuis IndexedDB.
  try {
    const db = await openDB();
    const stored = await new Promise<CryptoKey | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY_ID);
      req.onsuccess = () => resolve((req.result as CryptoKey) ?? null);
      req.onerror = () => resolve(null);
    });
    if (stored) {
      cachedKey = stored;
      return stored;
    }
  } catch {
    // Pas de clé existante — on en génère une ci-dessous.
  }

  // Génère une nouvelle clé et la persiste.
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable : ne peut pas être exportée en clair
    ['encrypt', 'decrypt'],
  );

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(key, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write error'));
    });
  } catch {
    // Si la persistance échoue, on garde la clé en RAM pour la session.
    // L'utilisateur perdra l'accès à la PII au prochain refresh — dégradé acceptable.
  }

  cachedKey = key;
  return key;
}

/**
 * Détecte si le module peut fonctionner dans l'environnement courant.
 * Utilisé par `partialize` pour basculer en mode dégradé si non.
 */
export function isSecureStorageAvailable(): boolean {
  try {
    return (
      typeof crypto !== 'undefined' &&
      typeof crypto.subtle !== 'undefined' &&
      typeof indexedDB !== 'undefined' &&
      typeof TextEncoder !== 'undefined'
    );
  } catch {
    return false;
  }
}

/**
 * Encode un ArrayBuffer en base64. Utilisé pour sérialiser iv + ciphertext + tag
 * dans un champ texte Zustand (JSON-stringifiable).
 */
function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Inverse de `bufToB64`. */
function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Chiffre une chaîne. Retourne un payload base64(iv ‖ ciphertext ‖ tag)
 * ou la chaîne d'origine si le module n'est pas dispo (dégradation).
 *
 * NB : pour `null`/`undefined`/`''`, retourne tel quel (pas de chiffrement vide).
 */
export async function encryptPII(plain: string | null | undefined): Promise<string | null | undefined> {
  if (plain == null || plain === '') return plain;
  if (!isSecureStorageAvailable()) return plain;

  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(plain);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
    // Concatène iv (12) + ciphertext+tag (variable) et encode en base64.
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.length);
    return bufToB64(combined.buffer);
  } catch {
    // Dégradation : on conserve en clair plutôt que crasher l'app.
    return plain;
  }
}

/**
 * Déchiffre un payload produit par `encryptPII`.
 * Retourne la chaîne en clair, ou `''` si le payload est invalide ou si
 * le module est indisponible.
 *
 * NB : pour `null`/`undefined`/`''`, retourne tel quel (passthrough).
 */
export async function decryptPII(payload: string | null | undefined): Promise<string | null | undefined> {
  if (payload == null || payload === '') return payload;
  if (!isSecureStorageAvailable()) return payload;

  try {
    const key = await getOrCreateKey();
    const combined = new Uint8Array(b64ToBuf(payload));
    if (combined.length < 12 + 16) return ''; // iv (12) + tag GCM (16) minimum
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    // Payload invalide ou clé perdue : on dégrade gracieusement.
    // Important : on ne lève PAS, sinon l'app crash au boot.
    return '';
  }
}
