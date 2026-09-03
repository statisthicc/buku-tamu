/**
 * db-manager.js
 * Mengelola folder db/ sebagai lokasi default penyimpanan file .db
 *
 * Cara kerja:
 *  1. User klik "Pilih Folder db/" sekali → showDirectoryPicker()
 *  2. Handle folder disimpan ke IndexedDB (persist lintas sesi)
 *  3. Setiap save/load otomatis baca-tulis ke folder tersebut tanpa dialog
 *  4. Fallback ke download/upload biasa jika browser tidak mendukung FSA
 */
"use strict";

const DBManager = (() => {
  /* ── IndexedDB untuk menyimpan DirectoryHandle ─────────────────────────── */
  const IDB = { NAME: "bukutamu_fsa", STORE: "handles", KEY: "dir" };

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

  /* ── State ─────────────────────────────────────────────────────────────── */
  const FSA = typeof showDirectoryPicker === "function";
  let _dir = null;
  let _onChange = null;

  /* ── Public API ─────────────────────────────────────────────────────────── */

  // async function init() {
  //   if (!FSA) return;
  //   try {
  //     const h = await idbGet();
  //     if (h) { _dir = h; _notify(); }
  //   } catch(e) { console.warn('[DBM] init:', e); }
  // }

  async function init() {
    if (!FSA) return;
    try {
      const h = await idbGet();
      if (h) {
        const opts = { mode: "read" }; // or "readwrite" for db-manager
        const perm = await h.queryPermission(opts);
        if (perm === "granted") {
          _dir = h;
        }
      }
    } catch (e) {
      console.warn("[Manager] init:", e);
    }
  }

  function onChange(fn) {
    _onChange = fn;
  }

  function status() {
    return { supported: FSA, active: !!_dir, name: _dir?.name ?? null };
  }

  async function selectFolder() {
    if (!FSA) {
      alert(
        "Browser Anda tidak mendukung File System Access API.\nGunakan Chrome atau Edge terbaru.",
      );
      return false;
    }
    try {
      const h = await showDirectoryPicker({
        id: "bukutamu-db",
        mode: "readwrite",
        startIn: "documents",
      });
      _dir = h;
      await idbPut(h);
      _notify();
      return true;
    } catch (e) {
      if (e.name !== "AbortError") console.error("[DBM] selectFolder:", e);
      return false;
    }
  }

  async function clearFolder() {
    _dir = null;
    await idbDel();
    _notify();
  }

  async function save(filename, exportFn) {
    const data = exportFn();

    if (FSA && _dir) {
      if (!(await _permit(_dir)))
        return { ok: false, error: "Izin folder ditolak." };
      try {
        const fh = await _dir.getFileHandle(filename, { create: true });
        const wr = await fh.createWritable();
        await wr.write(data);
        await wr.close();
        return { ok: true, path: `${_dir.name}/${filename}` };
      } catch (e) {
        if (e.name === "NotAllowedError") await clearFolder();
        return { ok: false, error: e.message };
      }
    }

    _download(filename, data, "application/x-sqlite3");
    return { ok: true, path: null };
  }

  async function load(preferredFilename) {
    if (FSA && _dir) {
      if (!(await _permit(_dir, false)))
        return { ok: false, error: "Izin folder ditolak." };
      if (preferredFilename) {
        try {
          const fh = await _dir.getFileHandle(preferredFilename);
          const file = await fh.getFile();
          return {
            ok: true,
            data: new Uint8Array(await file.arrayBuffer()),
            filename: file.name,
          };
        } catch (e) {
          if (e.name !== "NotFoundError")
            return { ok: false, error: e.message };
        }
      }
      return await _pickerInDir();
    }
    return await _filePicker();
  }

  async function listFiles() {
    if (!FSA || !_dir) return [];
    if (!(await _permit(_dir, false))) return [];
    const out = [];
    try {
      for await (const [name, h] of _dir.entries()) {
        if (h.kind === "file" && name.endsWith(".db")) {
          const f = await h.getFile();
          out.push({ name, size: f.size, modified: f.lastModified });
        }
      }
    } catch (e) {
      console.warn("[DBM] listFiles:", e);
    }
    return out.sort((a, b) => b.modified - a.modified);
  }

  /* ── Private ─────────────────────────────────────────────────────────────── */

  function _notify() {
    if (_onChange) _onChange(status());
  }

  async function _permit(handle, rw = true) {
    const opts = { mode: rw ? "readwrite" : "read" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    return (await handle.requestPermission(opts)) === "granted";
  }

  async function _pickerInDir() {
    try {
      const [fh] = await showOpenFilePicker({
        id: "bukutamu-open",
        startIn: _dir,
        types: [
          {
            description: "SQLite Database",
            accept: { "application/x-sqlite3": [".db"] },
          },
        ],
      });
      const file = await fh.getFile();
      return {
        ok: true,
        data: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
      };
    } catch (e) {
      if (e.name === "AbortError") return { ok: false, cancelled: true };
      return { ok: false, error: e.message };
    }
  }

  async function _filePicker() {
    if (FSA) {
      try {
        const [fh] = await showOpenFilePicker({
          types: [
            {
              description: "SQLite Database",
              accept: { "application/x-sqlite3": [".db"] },
            },
          ],
        });
        const file = await fh.getFile();
        return {
          ok: true,
          data: new Uint8Array(await file.arrayBuffer()),
          filename: file.name,
        };
      } catch (e) {
        if (e.name === "AbortError") return { ok: false, cancelled: true };
        return { ok: false, error: e.message };
      }
    }
    return new Promise((resolve) => {
      const inp = Object.assign(document.createElement("input"), {
        type: "file",
        accept: ".db",
      });
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) {
          resolve({ ok: false, cancelled: true });
          return;
        }
        resolve({
          ok: true,
          data: new Uint8Array(await f.arrayBuffer()),
          filename: f.name,
        });
      };
      inp.click();
    });
  }

  function _download(filename, data, mime) {
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([data], { type: mime })),
      download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return {
    init,
    onChange,
    status,
    selectFolder,
    clearFolder,
    save,
    load,
    listFiles,
  };
})();
