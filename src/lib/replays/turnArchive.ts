/** Per-browser archive of turn movies this participant has already received.
 *
 *  The room only delivers turns the participant has not acknowledged, so the
 *  client keeps each one it is shown. That makes earlier turns rewatchable as
 *  separate movies without the server re-sending (or re-filtering) them. The
 *  archive holds only this participant's already-authorized view; losing it
 *  (private mode, cleared site data) loses rewatches, never game state.
 */

import type { ParticipantTurnResult } from "../net/protocol";

const DB_NAME = "roboarena-turn-archive";
const STORE = "turns";

interface ArchivedTurn {
  readonly key: string;
  readonly matchId: string;
  readonly turnNumber: number;
  readonly turn: ParticipantTurnResult;
}

export const archiveKey = (matchId: string, turnNumber: number): string =>
  `${matchId}#${String(turnNumber).padStart(4, "0")}`;

const openArchive = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("matchId", "matchId");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

const run = async <T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> => {
  const db = await openArchive();
  if (db === null) return null;
  return new Promise((resolve) => {
    try {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
};

export const saveArchivedTurn = async (
  matchId: string,
  turn: ParticipantTurnResult,
): Promise<void> => {
  const record: ArchivedTurn = {
    key: archiveKey(matchId, turn.turnNumber),
    matchId,
    turnNumber: turn.turnNumber,
    turn,
  };
  await run("readwrite", (store) => store.put(record));
};

/** Turn numbers archived for a match, ascending. */
export const listArchivedTurns = async (matchId: string): Promise<number[]> => {
  const records = await run<ArchivedTurn[]>("readonly", (store) =>
    store.index("matchId").getAll(matchId),
  );
  return (records ?? []).map((record) => record.turnNumber).sort((a, b) => a - b);
};

export const loadArchivedTurn = async (
  matchId: string,
  turnNumber: number,
): Promise<ParticipantTurnResult | null> => {
  const record = await run<ArchivedTurn | undefined>("readonly", (store) =>
    store.get(archiveKey(matchId, turnNumber)),
  );
  return record?.turn ?? null;
};
