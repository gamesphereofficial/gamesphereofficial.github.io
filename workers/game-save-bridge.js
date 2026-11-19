function inlineJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function createSaveBridge(gameId, gameName) {
  const config = inlineJson({ gameId, gameName });
  return `<script>(()=>{
    const config=${config};
    const invalidCharacters='<>:"/\\\\|?*';
    let callbacks=null;
    let selectedRootHandle=null;
    let pendingDigits="";
    let pendingAction=null;
    let digitTimeout=null;
    const pressed=new Set();
    const status=document.createElement("span");
    const select=document.createElement("select");
    const saveButton=document.createElement("button");
    const loadButton=document.createElement("button");
    const folderButton=document.createElement("button");
    const root=document.createElement("div");
    const style=document.createElement("style");

    root.id="gamesphere-save-controls";
    root.style.cssText="position:fixed;z-index:2147483646;right:12px;bottom:12px;max-width:calc(100vw - 24px);padding:10px;border:1px solid #ffffff35;border-radius:12px;background:#101222ed;color:#fff;font:12px system-ui,sans-serif;box-shadow:0 6px 30px #0009;display:flex;flex-wrap:wrap;align-items:center;gap:7px";
    style.textContent="#gamesphere-save-controls select,#gamesphere-save-controls button{min-height:32px;border:1px solid #ffffff35;border-radius:7px;padding:0 9px;background:#20243a;color:#fff;font:inherit}#gamesphere-save-controls button{cursor:pointer}#gamesphere-save-controls button:disabled{opacity:.5;cursor:not-allowed}#gamesphere-save-controls [data-role=status]{flex-basis:100%;color:#d0c7ff;max-width:390px;line-height:1.4}";
    document.head.appendChild(style);

    const title=document.createElement("strong");
    title.textContent="GameSphere saves · "+config.gameName;
    status.dataset.role="status";
    status.setAttribute("aria-live","polite");
    status.textContent="This game must register GameSphere save/load support.";
    select.setAttribute("aria-label","Save slot");
    for(let slot=1;slot<=40;slot++){
      const option=document.createElement("option");
      option.value=String(slot);
      option.textContent="Slot "+slot;
      select.appendChild(option);
    }
    folderButton.type=saveButton.type=loadButton.type="button";
    folderButton.textContent="Choose Desktop folder";
    saveButton.textContent="Save";
    loadButton.textContent="Load";
    saveButton.disabled=loadButton.disabled=true;
    root.append(title,select,folderButton,saveButton,loadButton,status);
    document.body.appendChild(root);

    function safeFolderName(name){
      const safe=[...name].map(character=>
        invalidCharacters.includes(character)||character.charCodeAt(0)<32?"_":character
      ).join("").replace(/[ .]+$/g,"").trim();
      return safe&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(safe)?safe:"Game";
    }

    async function gameDirectory(rootHandle,create){
      const gameSphere=await rootHandle.getDirectoryHandle("GameSphere",{create});
      return gameSphere.getDirectoryHandle(safeFolderName(config.gameName),{create});
    }

    async function selectedGameDirectory(){
      if(!selectedRootHandle)throw new Error("Choose the Desktop folder first.");
      const permission=await selectedRootHandle.queryPermission({mode:"readwrite"});
      if(permission!=="granted")throw new Error("Folder permission expired. Choose the Desktop folder again.");
      return gameDirectory(selectedRootHandle,true);
    }

    function saveFileName(slot){
      return "slot-"+String(slot).padStart(2,"0")+".gamesphere-save.json";
    }

    async function saveSlot(slot){
      if(!callbacks)throw new Error("This game has not registered save support.");
      if(!Number.isInteger(slot)||slot<1||slot>40)throw new Error("Choose a slot from 1 to 40.");
      const data=await callbacks.save();
      if(data===undefined)throw new Error("The game returned no save data.");
      let serialized;
      try{
        serialized=JSON.stringify({
          format:"gamesphere-save-v1",
          gameId:config.gameId,
          gameName:config.gameName,
          slot,
          savedAt:new Date().toISOString(),
          data
        });
      }catch{
        throw new Error("The game's save data could not be converted to JSON.");
      }
      if(serialized===undefined||new TextEncoder().encode(serialized).byteLength>5000000){
        throw new Error("Save data must be JSON-compatible and smaller than 5 MB.");
      }
      const directory=await selectedGameDirectory();
      const file=await directory.getFileHandle(saveFileName(slot),{create:true});
      const writable=await file.createWritable();
      try{
        await writable.write(serialized);
        await writable.close();
      }catch(error){
        await writable.abort();
        throw error;
      }
      status.textContent="Saved slot "+slot+" to Desktop/GameSphere/"+safeFolderName(config.gameName)+".";
    }

    async function loadSlot(slot){
      if(!callbacks)throw new Error("This game has not registered load support.");
      if(!Number.isInteger(slot)||slot<1||slot>40)throw new Error("Choose a slot from 1 to 40.");
      const directory=await selectedGameDirectory();
      const file=await directory.getFileHandle(saveFileName(slot));
      const savedFile=await file.getFile();
      if(savedFile.size>5000000)throw new Error("This save file is larger than the 5 MB limit.");
      const record=JSON.parse(await savedFile.text());
      if(record?.format!=="gamesphere-save-v1"||record.gameId!==config.gameId||
          record.gameName!==config.gameName||record.slot!==slot||!Object.hasOwn(record,"data")){
        throw new Error("This file is not a valid save for this game and slot.");
      }
      await callbacks.load(record.data);
      status.textContent="Loaded slot "+slot+" from Desktop/GameSphere/"+safeFolderName(config.gameName)+".";
    }

    function showError(error){
      console.error("GameSphere save error:",error);
      status.textContent=error.message||"The save operation failed.";
    }

    async function chooseFolder(){
      if(!window.showDirectoryPicker){
        status.textContent="Folder access is unsupported. Use a current Chromium-based desktop browser.";
        return;
      }
      try{
        const handle=await window.showDirectoryPicker({mode:"readwrite"});
        const permission=await handle.requestPermission({mode:"readwrite"});
        if(permission!=="granted")throw new Error("Folder permission was not granted.");
        await gameDirectory(handle,true);
        selectedRootHandle=handle;
        status.textContent="Ready: Desktop/GameSphere/"+safeFolderName(config.gameName)+".";
      }catch(error){
        if(error.name!=="AbortError")showError(error);
      }
    }

    window.GameSphereSave=Object.freeze({
      register(handlers){
        if(!handlers||typeof handlers.save!=="function"||typeof handlers.load!=="function"){
          throw new TypeError("Register both save() and load(data) functions.");
        }
        callbacks=handlers;
        saveButton.disabled=loadButton.disabled=false;
        status.textContent="Choose the Desktop folder, then use buttons or keyboard shortcuts.";
        return ()=>{callbacks=null;saveButton.disabled=loadButton.disabled=true;};
      },
      save:saveSlot,
      load:loadSlot,
      get gameId(){return config.gameId;},
      get gameName(){return config.gameName;}
    });

    folderButton.addEventListener("click",chooseFolder);
    saveButton.addEventListener("click",()=>saveSlot(Number(select.value)).catch(showError));
    loadButton.addEventListener("click",()=>loadSlot(Number(select.value)).catch(showError));

    function chordAction(){
      if(!(pressed.has("ShiftLeft")||pressed.has("ShiftRight")))return null;
      if(pressed.has("F1")&&pressed.has("F2"))return "save";
      if(pressed.has("F3")&&pressed.has("F4"))return "load";
      return null;
    }

    function runShortcut(action,digits){
      const slot=digits==="0"?10:Number(digits);
      if(slot<1||slot>40){
        status.textContent="Keyboard slots are 1–40; use 0 for slot 10.";
      }else{
        select.value=String(slot);
        const operation=action==="save"?saveSlot(slot):loadSlot(slot);
        operation.catch(showError);
      }
      pendingDigits="";
      pendingAction=null;
      clearTimeout(digitTimeout);
    }

    document.addEventListener("keydown",event=>{
      if(["F1","F2","F3","F4","ShiftLeft","ShiftRight"].includes(event.code))pressed.add(event.code);
      const action=chordAction();
      if(!action||!/^(Digit|Numpad)[0-9]$/.test(event.code))return;
      event.preventDefault();
      event.stopPropagation();
      if(event.repeat)return;
      const digit=event.code.slice(-1);
      if(digit==="0"){
        runShortcut(action,"0");
        return;
      }
      if(pendingDigits){
        const number=Number(pendingDigits+digit);
        if(number>=11&&number<=40){
          runShortcut(action,String(number));
          return;
        }
        pendingDigits="";
        pendingAction=null;
        clearTimeout(digitTimeout);
        status.textContent="Invalid two-digit slot. Choose a slot from 11 to 40.";
        return;
      }
      pendingDigits=digit;
      pendingAction=action;
      clearTimeout(digitTimeout);
      digitTimeout=setTimeout(()=>{
        if(pendingDigits)runShortcut(pendingAction,pendingDigits);
      },900);
    },true);

    document.addEventListener("keyup",event=>{
      pressed.delete(event.code);
      if(!chordAction()&&pendingDigits)runShortcut(pendingAction,pendingDigits);
    },true);
  })();</script>`;
}
