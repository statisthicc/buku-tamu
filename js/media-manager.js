"use strict";

const MediaManager = (() => {
  const IDB = { NAME: "bukutamu_media_fsa", STORE: "handles", KEY: "dir" };

  function openIdb() {
    return new Promise((ok, ng) => {
      const r = indexedDB.open(IDB.NAME, 1);
      r.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB.STORE);
      r.onsuccess = (e) => ok(e.target.result);
      r.onerror = (e) => ng(e.target.error);
    });
  }
  async function idbPut(val) {
    const db = await openIdb();
    return new Promise((ok, ng) => {
      const tx = db.transaction(IDB.STORE, "readwrite");
      tx.objectStore(IDB.STORE).put(val, IDB.KEY);
      tx.oncomplete = ok;
      tx.onerror = (e) => ng(e.target.error);
    });
  }
  async function idbGet() {
    const db = await openIdb();
    return new Promise((ok, ng) => {
      const tx = db.transaction(IDB.STORE, "readonly");
      const r = tx.objectStore(IDB.STORE).get(IDB.KEY);
      r.onsuccess = (e) => ok(e.target.result ?? null);
      r.onerror = (e) => ng(e.target.error);
    });
  }
  async function idbDel() {
    const db = await openIdb();
    return new Promise((ok, ng) => {
      const tx = db.transaction(IDB.STORE, "readwrite");
      tx.objectStore(IDB.STORE).delete(IDB.KEY);
      tx.oncomplete = ok;
      tx.onerror = (e) => ng(e.target.error);
    });
  }

  async function clearFolder() {
    _dir = null;
    await idbDel();
  }

  const FSA = typeof showDirectoryPicker === "function";
  let _dir = null;

  const IMG_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  const VID_EXT = [".mp4", ".webm"];

  async function init() {
    if (!FSA) return;
    try {
      const h = await idbGet();
      if (h && (await _permit(h))) _dir = h;
    } catch (e) {
      console.warn("[MediaManager] init:", e);
    }
  }

  function status() {
    return { supported: FSA, active: !!_dir, name: _dir?.name ?? null };
  }

  async function selectFolder() {
    if (!FSA) {
      alert("Browser Anda tidak mendukung File System Access API.");
      return false;
    }
    try {
      const h = await showDirectoryPicker({
        id: "bukutamu-media",
        mode: "read",
      });
      _dir = h;
      await idbPut(h);
      return true;
    } catch (e) {
      if (e.name !== "AbortError")
        console.error("[MediaManager] selectFolder:", e);
      return false;
    }
  }

  async function _permit(handle) {
    const opts = { mode: "read" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    return (await handle.requestPermission(opts)) === "granted";
  }

  async function listMedia() {
    if (!FSA || !_dir) return [];
    if (!(await _permit(_dir))) return [];
    const out = [];
    try {
      for await (const [name, h] of _dir.entries()) {
        if (h.kind !== "file") continue;
        const lower = name.toLowerCase();
        const ext = lower.slice(lower.lastIndexOf("."));
        if (IMG_EXT.includes(ext) || VID_EXT.includes(ext)) {
          const file = await h.getFile();
          out.push({
            name,
            type: VID_EXT.includes(ext) ? "video" : "image",
            url: URL.createObjectURL(file),
          });
        }
      }
    } catch (e) {
      console.warn("[MediaManager] listMedia:", e);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  return { init, status, selectFolder, clearFolder, listMedia };
})();
