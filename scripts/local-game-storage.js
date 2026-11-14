const STORAGE_DATABASE_NAME = "gamesphere-local-gdevelop-saves";
const STORAGE_OBJECT_STORE = "records";

export async function createGameStorageNamespace(zipBytes) {
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", zipBytes);
      return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch (error) {
      console.warn("Could not fingerprint the game ZIP with SHA-256:", error);
    }
  }

  let firstHash = 0x811c9dc5;
  let secondHash = 0x1234567;
  for (let index = 0; index < zipBytes.length; index += 1) {
    const byte = zipBytes[index];
    firstHash = Math.imul(firstHash ^ byte, 0x01000193);
    secondHash = Math.imul(secondHash ^ (byte + index), 0x01000193);
  }
  return `${firstHash >>> 0}-${secondHash >>> 0}-${zipBytes.length}`;
}

export function createGDevelopLocalStorageBridge(
  token,
  namespace,
  initialLocalStorage = {},
  initializationError = ""
) {
  const encodedStorage = JSON.stringify(initialLocalStorage).replace(/</g, "\\u003c");
  const encodedInitializationError = JSON.stringify(initializationError).replace(/</g, "\\u003c");
  return `(()=> {
    const token=${JSON.stringify(token)};
    const namespace=${JSON.stringify(namespace)};
    let nextRequestId=0;
    const pending=new Map;
    const notifyStorageError=message=>parent.postMessage({source:"gamesphere-local-game",token,type:"storage-error",message},"*");
    window.addEventListener("message",event=>{
      if(event.source!==parent)return;
      const data=event.data;
      if(!data||data.source!=="gamesphere-local-game"||data.token!==token||data.type!=="storage-response")return;
      const task=pending.get(data.requestId);
      if(!task)return;
      pending.delete(data.requestId);
      if(data.error)task.reject(new Error(data.error));
      else task.resolve(data.result);
    });
    const request=(operation,databaseName,objectStoreName,key,value)=>new Promise((resolve,reject)=>{
      const requestId=++nextRequestId;
      pending.set(requestId,{resolve,reject});
      try{
        parent.postMessage({source:"gamesphere-local-game",token,type:"storage-request",namespace,requestId,operation,databaseName,objectStoreName,key,value},"*");
      }catch(error){
        pending.delete(requestId);
        reject(error);
      }
    });
    const values=new Map(Object.entries(${encodedStorage}));
    const localStorage={
      get length(){return values.size},
      key(index){return [...values.keys()][Number(index)]??null},
      getItem(key){const value=values.get(String(key));return value===undefined?null:value},
      setItem(key,value){
        key=String(key);
        value=String(value);
        values.set(key,value);
        request("save","gamesphere-gdevelop-local-storage","local-storage",key,value).catch(()=>{});
      },
      removeItem(key){
        key=String(key);
        values.delete(key);
        request("delete","gamesphere-gdevelop-local-storage","local-storage",key).catch(()=>{});
      },
      clear(){
        for(const key of values.keys()){
          request("delete","gamesphere-gdevelop-local-storage","local-storage",key).catch(()=>{});
        }
        values.clear();
      }
    };
    try{
      Object.defineProperty(window,"localStorage",{configurable:true,enumerable:true,writable:true,value:localStorage});
    }catch(error){
      notifyStorageError("This browser blocked the local save-storage bridge.");
    }
    const bridge={
      request,
      bindIndexedDB(){
        const storage=window.gdjs&&window.gdjs.indexedDb;
        if(!storage)return;
        storage.saveToIndexedDB=(databaseName,objectStoreName,key,value)=>request("save",databaseName,objectStoreName,key,value);
        storage.loadFromIndexedDB=(databaseName,objectStoreName,key)=>request("load",databaseName,objectStoreName,key);
        storage.deleteFromIndexedDB=(databaseName,objectStoreName,key)=>request("delete",databaseName,objectStoreName,key);
        storage.keyExistsInIndexedDB=(databaseName,objectStoreName,key)=>request("exists",databaseName,objectStoreName,key);
        storage.getAllKeysFromIndexedDB=(databaseName,objectStoreName)=>request("list-keys",databaseName,objectStoreName);
        storage.getAllFromIndexedDB=(databaseName,objectStoreName)=>request("list-values",databaseName,objectStoreName);
      }
    };
    Object.defineProperty(window,"__gamesphereGDevelopStorageBridge",{configurable:false,value:bridge});
    if(${encodedInitializationError})notifyStorageError("GDevelop saves could not be loaded: "+${encodedInitializationError});
  })();`;
}

export function createGDevelopStorageBridge() {
  return `(()=>{window.__gamesphereGDevelopStorageBridge?.bindIndexedDB()})();`;
}

function openStorageDatabase(indexedDB) {
  if (!indexedDB) {
    return Promise.reject(new Error("This browser does not provide IndexedDB."));
  }
  return new Promise((resolve, reject) => {
    let request;
    let blocked = false;
    try {
      request = indexedDB.open(STORAGE_DATABASE_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORAGE_OBJECT_STORE)) {
        const store = database.createObjectStore(STORAGE_OBJECT_STORE, { keyPath: "id" });
        store.createIndex("scope", "scope", { unique: false });
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
      } else {
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error || new Error("Could not open local game save storage."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Local game save storage is blocked by another open page."));
    };
  });
}

function runStorageTransaction(database, mode, operation) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = database.transaction(STORAGE_OBJECT_STORE, mode);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }

    let result;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error);
    };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
    transaction.onabort = () => fail(transaction.error || new Error("Local game save transaction was aborted."));
    transaction.onerror = () => fail(transaction.error || new Error("Local game save transaction failed."));

    try {
      const request = operation(transaction.objectStore(STORAGE_OBJECT_STORE));
      if (request) {
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => fail(request.error || new Error("Local game save request failed."));
      }
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        fail(error);
      }
    }
  });
}

export async function handleGDevelopStorageRequest(request, namespace, indexedDB = globalThis.indexedDB) {
  if (!request || request.namespace !== namespace) {
    throw new Error("The game save request has an invalid storage namespace.");
  }
  const { operation, databaseName, objectStoreName, key, value } = request;
  if (typeof databaseName !== "string" || databaseName.length > 512 ||
      typeof objectStoreName !== "string" || objectStoreName.length > 512) {
    throw new Error("The game save request has an invalid database or store name.");
  }
  if (operation !== "list-keys" && operation !== "list-values" &&
      (typeof key !== "string" || key.length > 2048)) {
    throw new Error("The game save request has an invalid save key.");
  }
  if (!["save", "load", "delete", "exists", "list-keys", "list-values"].includes(operation)) {
    throw new Error("The game requested an unsupported save-storage operation.");
  }

  const scope = JSON.stringify([namespace, databaseName, objectStoreName]);
  const id = key === undefined ? null : JSON.stringify([scope, key]);
  const database = await openStorageDatabase(indexedDB);
  try {
    switch (operation) {
      case "save":
        return await runStorageTransaction(database, "readwrite", store =>
          store.put({ id, scope, key, value })
        );
      case "load":
        return await runStorageTransaction(database, "readonly", store => {
          const result = store.get(id);
          return result;
        }).then(record => record ? record.value : null);
      case "delete":
        return await runStorageTransaction(database, "readwrite", store => store.delete(id));
      case "exists":
        return await runStorageTransaction(database, "readonly", store => store.count(id))
          .then(count => count > 0);
      case "list-keys":
        return await runStorageTransaction(database, "readonly", store =>
          store.index("scope").getAll(scope)
        ).then(records => records.map(record => record.key));
      case "list-values":
        return await runStorageTransaction(database, "readonly", store =>
          store.index("scope").getAll(scope)
        ).then(records => records.map(record => ({ key: record.key, value: record.value })));
      default:
        throw new Error("The game requested an unsupported save-storage operation.");
    }
  } catch (error) {
    database.close();
    throw error;
  }
}
