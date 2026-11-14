const DATABASE_NAME = "gamesphere-local-games";
const DATABASE_VERSION = 1;
const STORE_NAME = "games";

export function createLocalGameLibrary(indexedDB = globalThis.indexedDB) {
  function openDatabase() {
    if (!indexedDB || typeof indexedDB.open !== "function") {
      return Promise.reject(new Error("This browser does not support a persistent local game library."));
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(
        request.error || new Error("The local game library could not be opened.")
      );
      request.onblocked = () => reject(new Error("The local game library is busy in another tab."));
    });
  }

  async function save(game) {
    if (!game || typeof game.id !== "string" || !game.id ||
        typeof game.name !== "string" || !game.name || !(game.zip instanceof Blob)) {
      throw new Error("The local game details are invalid.");
    }

    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(game);
      transaction.oncomplete = () => {
        database.close();
        resolve(game);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error("The game could not be saved in this browser."));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error("Saving the game in this browser was cancelled."));
      };
    });
  }

  async function list() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      let games = [];
      request.onsuccess = () => {
        games = request.result;
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(games);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error("The local game library could not be read."));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error("Reading the local game library was cancelled."));
      };
    });
  }

  async function remove(id) {
    if (typeof id !== "string" || !id) {
      throw new Error("The local game ID is invalid.");
    }

    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error("The local game could not be removed."));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error("Removing the local game was cancelled."));
      };
    });
  }

  return Object.freeze({ save, list, remove });
}
