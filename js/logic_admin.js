"use strict";
const STORE_KEY = "bukutamu_db_v1"; // shared dengan tamu.html
const DB_FILE = "buku-tamu.db";
let SQL, db;

/* ── Boot ──────────────────────────────────────────────────────────────────── */
const fill = document.getElementById("bootFill");
let _p = 0,
  _pt = setInterval(() => {
    _p = Math.min(_p + Math.random() * 20, 80);
    fill.style.width = _p + "%";
  }, 180);

async function initDB() {
  document.getElementById("bootSub").textContent = "Memuat SQLite WASM…";
  SQL = await initSqlJs({ locateFile: () => "libs/sql-wasm.wasm" });

  document.getElementById("bootSub").textContent = "Membaca folder db/…";
  await DBManager.init();
  DBManager.onChange(updateFolderBar);
  updateFolderBar(DBManager.status());

  document.getElementById("bootSub").textContent = "Membuka database…";
  // Coba muat dari folder db/ dulu, lalu fallback ke localStorage
  let loaded = false;
  const st = DBManager.status();
  if (st.active) {
    const r = await DBManager.load(DB_FILE);
    if (r.ok && r.data) {
      try {
        db = new SQL.Database(r.data);
        loaded = true;
      } catch {}
    }
  }
  if (!loaded) {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      try {
        db = new SQL.Database(
          Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)),
        );
      } catch {
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS tamu(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL, instansi TEXT DEFAULT '',
      jabatan TEXT DEFAULT '', no_wa TEXT NOT NULL,
      email TEXT DEFAULT '',
      keperluan TEXT NOT NULL,
      no_antrian INTEGER DEFAULT 0,
      selesai INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_nama ON tamu(nama COLLATE NOCASE);
  `);
  // Migration: add columns if they don't exist
  try {
    db.run("ALTER TABLE tamu ADD COLUMN no_antrian INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.run("ALTER TABLE tamu ADD COLUMN selesai INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.run("ALTER TABLE tamu ADD COLUMN email TEXT DEFAULT ''");
  } catch (e) {}

  clearInterval(_pt);
  fill.style.width = "100%";
  setTimeout(() => document.getElementById("boot").classList.add("gone"), 450);
  renderDash();
  updateNavCnt();
  updateAntrianBadge();
  initMediaFolder();
}

/* ── Persist ────────────────────────────────────────────────────────────────── */
function persist() {
  try {
    const d = db.export();
    localStorage.setItem(STORE_KEY, btoa(String.fromCharCode(...d)));
  } catch (e) {
    console.warn(e);
  }
}
function dbRun(sql, p = []) {
  db.run(sql, p);
  persist();
}
function dbAll(sql, p = []) {
  const r = db.exec(sql, p);
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((c, i) => [c, row[i]])),
  );
}
function dbS(sql, p = []) {
  const r = db.exec(sql, p);
  return r.length && r[0].values.length ? r[0].values[0][0] : 0;
}
function parseKep(r) {
  return { ...r, keperluan: r.keperluan ? r.keperluan.split("|") : [] };
}

/* ── Folder bar UI ──────────────────────────────────────────────────────────── */
function updateFolderBar(st) {
  const bar = document.getElementById("folderBar");
  const titl = document.getElementById("fbTitle");
  const desc = document.getElementById("fbDesc");
  const setB = document.getElementById("fbSetBtn");
  const clrB = document.getElementById("fbClrBtn");

  if (!st.supported) {
    bar.className = "folder-bar inactive";
    titl.textContent = "File System Access tidak didukung browser ini";
    desc.textContent =
      "Gunakan Chrome atau Edge terbaru. File .db akan diunduh manual.";
    setB.style.display = "none";
    clrB.style.display = "none";
    return;
  }
  if (st.active) {
    bar.className = "folder-bar active";
    titl.textContent = `📂 Folder aktif: ${st.name}`;
    desc.textContent =
      "File buku-tamu.db tersimpan otomatis ke folder ini setiap kali ada perubahan.";
    setB.textContent = "↺ Ganti Folder";
    clrB.style.display = "";
  } else {
    bar.className = "folder-bar inactive";
    titl.textContent = "Folder penyimpanan belum dipilih";
    desc.textContent =
      "Pilih folder db/ di dalam buku-tamu/ agar file .db tersimpan otomatis ke sana.";
    setB.textContent = "Pilih Folder db/";
    clrB.style.display = "none";
  }
}

async function setFolder() {
  const ok = await DBManager.selectFolder();
  if (ok) {
    toast(
      "📁",
      `Folder "${DBManager.status().name}" dipilih. File .db akan otomatis disimpan ke sana.`,
    );
    // Langsung simpan file saat ini ke folder baru
    await autoSave();
  }
}
async function unsetFolder() {
  await DBManager.clearFolder();
  toast("📁", "Folder dilepas. File .db akan diunduh manual.");
}

/* ── Save / Load ────────────────────────────────────────────────────────────── */
async function autoSave() {
  const r = await DBManager.save(DB_FILE, () => db.export());
  if (!r.ok) console.warn("[autoSave]", r.error);
}

async function doSave() {
  persist();
  const r = await DBManager.save(DB_FILE, () => db.export());
  if (r.ok) {
    toast(
      "💾",
      r.path ? `Tersimpan ke ${r.path}` : `File ${DB_FILE} berhasil diunduh.`,
    );
  } else {
    toast("❌", r.error, 1);
  }
}

async function doLoad() {
  const r = await DBManager.load(DB_FILE);
  if (r.cancelled) return;
  if (!r.ok) {
    toast("❌", r.error || "Gagal membuka file.", 1);
    return;
  }
  try {
    db = new SQL.Database(r.data);
    // Migration after loading
    try {
      db.run("ALTER TABLE tamu ADD COLUMN no_antrian INTEGER DEFAULT 0");
    } catch (e) {}
    try {
      db.run("ALTER TABLE tamu ADD COLUMN selesai INTEGER DEFAULT 0");
    } catch (e) {}
    try {
      db.run("ALTER TABLE tamu ADD COLUMN email TEXT DEFAULT ''");
    } catch (e) {}
    persist();
    renderDash();
    renderTable();
    renderAntrian();
    updateAntrianBadge();
    toast("📂", `Database "${r.filename}" berhasil dimuat.`);
  } catch (e) {
    toast("❌", "File .db tidak valid: " + e.message, 1);
  }
}

/* ── Setiap dbRun juga auto-save ke folder ──────────────────────────────────── */
const _origDbRun = dbRun;
function dbRunWithSave(sql, p = []) {
  db.run(sql, p);
  persist();
  if (DBManager.status().active) autoSave();
}
// function dbRunWithSave(sql, p = []) {
//   db.run(sql, p);
//   persist();
//   const st = DBManager.status();
//   if (st.active) autoSave();
// }

/* ── Nav ───────────────────────────────────────────────────────────────────── */
function showSec(sec, btn) {
  ["dash", "antrian", "tamu"].forEach(
    (s) => (document.getElementById("sec-" + s).style.display = "none"),
  );
  document.getElementById("sec-" + sec).style.display = "block";
  document.querySelectorAll(".ni").forEach((b) => b.classList.remove("on"));
  if (btn) btn.classList.add("on");
  if (sec === "dash") renderDash();
  if (sec === "antrian") renderAntrian();
  if (sec === "tamu") renderTable();
}
function updateNavCnt() {
  document.getElementById("navCnt").textContent = dbS(
    "SELECT COUNT(*) FROM tamu",
  );
}
function updateAntrianBadge() {
  const pending = dbS(
    "SELECT COUNT(*) FROM tamu WHERE date(timestamp)=date('now','localtime') AND selesai=0",
  );
  const el = document.getElementById("navAntrian");
  el.textContent = pending;
  el.classList.toggle("pulse", pending > 0);
}
function refresh() {
  const dashVis = document.getElementById("sec-dash").style.display !== "none";
  const antrianVis =
    document.getElementById("sec-antrian").style.display !== "none";
  if (dashVis) renderDash();
  else if (antrianVis) renderAntrian();
  else renderTable();
  updateAntrianBadge();
  toast("🔄", "Data diperbarui.");
}

/* ── Toggle Selesai ─────────────────────────────────────────────────────────── */
function toggleSelesai(id) {
  const current = dbS("SELECT selesai FROM tamu WHERE id=?", [id]);
  const newVal = current ? 0 : 1;
  db.run("UPDATE tamu SET selesai=? WHERE id=?", [newVal, id]);
  persist();
  const st = DBManager.status();
  if (st.active) autoSave();
  // Re-render the active section
  const dashVis = document.getElementById("sec-dash").style.display !== "none";
  const antrianVis =
    document.getElementById("sec-antrian").style.display !== "none";
  if (dashVis) renderDash();
  if (antrianVis) renderAntrian();
  if (document.getElementById("sec-tamu").style.display !== "none")
    renderTable();
  updateAntrianBadge();
  toast(
    newVal ? "✅" : "🔄",
    newVal ? "Pelayanan ditandai selesai." : "Status dikembalikan ke menunggu.",
  );
}

/* ── Status Toggle HTML ────────────────────────────────────────────────────── */
function statusToggleHTML(id, selesai) {
  return `<label class="toggle-wrap" title="${selesai ? "Selesai" : "Menunggu"}">
    <input type="checkbox" class="toggle-input" ${selesai ? "checked" : ""} onchange="toggleSelesai(${id})">
    <span class="toggle-slider"></span>
    <span class="toggle-label ${selesai ? "tl-done" : "tl-wait"}">${selesai ? "Selesai" : "Menunggu"}</span>
  </label>`;
}

function antrianBadgeHTML(no_antrian) {
  if (!no_antrian) return '<span class="antrian-na">—</span>';
  return `<span class="antrian-badge">${no_antrian}</span>`;
}

/* ── Dashboard ──────────────────────────────────────────────────────────────── */
function renderDash() {
  const total = dbS("SELECT COUNT(*) FROM tamu");
  const today = dbS(
    "SELECT COUNT(*) FROM tamu WHERE date(timestamp)=date('now','localtime')",
  );
  const pending = dbS(
    "SELECT COUNT(*) FROM tamu WHERE date(timestamp)=date('now','localtime') AND selesai=0",
  );
  const done = dbS(
    "SELECT COUNT(*) FROM tamu WHERE date(timestamp)=date('now','localtime') AND selesai=1",
  );
  const unique = dbS("SELECT COUNT(DISTINCT LOWER(nama)) FROM tamu");
  const inst = dbS(
    "SELECT COUNT(DISTINCT LOWER(instansi)) FROM tamu WHERE instansi!=''",
  );
  document.getElementById("dashSub").textContent =
    `${total} total kunjungan · ${today} hari ini · ${new Date().toLocaleTimeString("id-ID")}`;
  document.getElementById("navCnt").textContent = total;
  updateAntrianBadge();
  document.getElementById("statsRow").innerHTML = `
    <div class="stat"><div class="stat-n">${total}</div><div class="stat-l">Total Kunjungan</div><div class="stat-ico">📋</div></div>
    <div class="stat"><div class="stat-n">${today}</div><div class="stat-l">Kunjungan Hari Ini</div><div class="stat-ico">📅</div></div>
    <div class="stat"><div class="stat-n">${pending}</div><div class="stat-l">Menunggu Dilayani</div><div class="stat-ico">⏳</div></div>
    <div class="stat"><div class="stat-n">${done}</div><div class="stat-l">Selesai Hari Ini</div><div class="stat-ico">✅</div></div>`;
  const kc = {};
  dbAll("SELECT keperluan,COUNT(*) cnt FROM tamu GROUP BY keperluan").forEach(
    (r) =>
      r.keperluan.split("|").forEach((k) => (kc[k] = (kc[k] || 0) + r.cnt)),
  );
  const ka = Object.entries(kc).sort((a, b) => b[1] - a[1]);
  const km = ka[0]?.[1] || 1;
  document.getElementById("chartKep").innerHTML = ka.length
    ? ka
        .map(
          ([k, c]) =>
            `<div class="bar-row"><div class="bar-lbl" title="${esc(k)}">${esc(k)}</div><div class="bar-track"><div class="bar-fill bf-t" style="width:${((c / km) * 100).toFixed(1)}%"></div></div><div class="bar-val">${c}</div></div>`,
        )
        .join("")
    : '<div class="chart-empty">Belum ada data</div>';
  const ir = dbAll(
    "SELECT instansi,COUNT(*) cnt FROM tamu WHERE instansi!='' GROUP BY LOWER(instansi) ORDER BY cnt DESC LIMIT 6",
  );
  const im = ir[0]?.cnt || 1;
  document.getElementById("chartInst").innerHTML = ir.length
    ? ir
        .map(
          (r) =>
            `<div class="bar-row"><div class="bar-lbl" title="${esc(r.instansi)}">${esc(r.instansi)}</div><div class="bar-track"><div class="bar-fill bf-g" style="width:${((r.cnt / im) * 100).toFixed(1)}%"></div></div><div class="bar-val">${r.cnt}</div></div>`,
        )
        .join("")
    : '<div class="chart-empty">Belum ada data</div>';
  const recent = dbAll(
    "SELECT * FROM tamu ORDER BY timestamp DESC LIMIT 5",
  ).map(parseKep);
  const re = document.getElementById("recentEmpty"),
    rb = document.getElementById("recentBody");
  if (!recent.length) {
    rb.innerHTML = "";
    re.style.display = "block";
    return;
  }
  re.style.display = "none";
  rb.innerHTML = recent
    .map(
      (r, i) =>
        `<tr class="${r.selesai ? "row-done" : ""}"><td class="td-num">${i + 1}</td><td>${antrianBadgeHTML(r.no_antrian)}</td><td><div class="td-n">${esc(r.nama)}</div><div class="td-i">${esc(r.instansi || "—")}</div></td><td>${r.keperluan.map((k) => `<span class="badge ${bc(k)}">${esc(k)}</span>`).join("")}</td><td><a class="wa-l" href="https://wa.me/${waNum(r.no_wa)}" target="_blank">${esc(r.no_wa)}</a>${r.email ? `<div class="td-i"><a href="mailto:${esc(r.email)}" style="color:var(--g400);text-decoration:none">${esc(r.email)}</a></div>` : ""}</td><td class="td-t">${fmtDt(r.timestamp)}</td><td>${statusToggleHTML(r.id, r.selesai)}</td></tr>`,
    )
    .join("");
}

/* ── Antrian Hari Ini ──────────────────────────────────────────────────────── */
function renderAntrian() {
  const rows = dbAll(
    "SELECT * FROM tamu WHERE date(timestamp)=date('now','localtime') ORDER BY no_antrian ASC",
  ).map(parseKep);
  const pending = rows.filter((r) => !r.selesai).length;
  const done = rows.filter((r) => r.selesai).length;
  document.getElementById("antrianSub").textContent =
    `${rows.length} tamu hari ini · ${pending} menunggu · ${done} selesai`;
  updateAntrianBadge();

  document.getElementById("antrianStats").innerHTML = `
    <div class="a-stat a-stat-wait"><div class="a-stat-n">${pending}</div><div class="a-stat-l">⏳ Menunggu</div></div>
    <div class="a-stat a-stat-done"><div class="a-stat-n">${done}</div><div class="a-stat-l">✅ Selesai</div></div>
    <div class="a-stat a-stat-total"><div class="a-stat-n">${rows.length}</div><div class="a-stat-l">🎫 Total Antrian</div></div>
  `;

  const te = document.getElementById("antrianEmpty"),
    tb = document.getElementById("antrianBody");
  if (!rows.length) {
    tb.innerHTML = "";
    te.style.display = "block";
    return;
  }
  te.style.display = "none";
  tb.innerHTML = rows
    .map(
      (r) =>
        `<tr class="${r.selesai ? "row-done" : ""}">
          <td>${antrianBadgeHTML(r.no_antrian)}</td>
          <td><div class="td-n">${esc(r.nama)}</div><div class="td-i">${esc(r.instansi || "—")}</div></td>
          <td>${r.keperluan.map((k) => `<span class="badge ${bc(k)}">${esc(k)}</span>`).join("")}</td>
          <td class="td-t">${fmtTime(r.timestamp)}</td>
          <td>${statusToggleHTML(r.id, r.selesai)}</td>
        </tr>`,
    )
    .join("");
}

/* ── Table ──────────────────────────────────────────────────────────────────── */
const PAGE = 15;
let _q = "",
  _pg = 1,
  _st;
function onSearch(v) {
  _q = v;
  _pg = 1;
  clearTimeout(_st);
  _st = setTimeout(renderTable, 250);
}
function renderTable() {
  const like = `%${_q.trim()}%`;
  const rows = _q.trim()
    ? dbAll(
        "SELECT * FROM tamu WHERE nama LIKE ? OR instansi LIKE ? OR jabatan LIKE ? OR no_wa LIKE ? OR keperluan LIKE ? ORDER BY timestamp DESC",
        [like, like, like, like, like],
      )
    : dbAll("SELECT * FROM tamu ORDER BY timestamp DESC");
  document.getElementById("tamuSub").textContent =
    `${rows.length} data kunjungan`;
  updateNavCnt();
  updateAntrianBadge();
  const total = rows.length,
    start = (_pg - 1) * PAGE,
    page = rows.slice(start, start + PAGE).map(parseKep);
  const te = document.getElementById("tamuEmpty"),
    tb = document.getElementById("tamuBody");
  if (!total) {
    tb.innerHTML = "";
    te.style.display = "block";
    renderPager(0);
    return;
  }
  te.style.display = "none";
  tb.innerHTML = page
    .map(
      (r, i) =>
        `<tr class="${r.selesai ? "row-done" : ""}"><td class="td-num">${start + i + 1}</td><td>${antrianBadgeHTML(r.no_antrian)}</td><td><div class="td-n">${esc(r.nama)}</div><div class="td-i">${esc(r.instansi || "—")}</div></td><td class="td-j">${esc(r.jabatan || "—")}</td><td>${r.keperluan.map((k) => `<span class="badge ${bc(k)}">${esc(k)}</span>`).join("")}</td><td><a class="wa-l" href="https://wa.me/${waNum(r.no_wa)}" target="_blank">${esc(r.no_wa)}</a>${r.email ? `<div class="td-i"><a href="mailto:${esc(r.email)}" style="color:var(--g400);text-decoration:none">${esc(r.email)}</a></div>` : ""}</td><td class="td-t">${fmtDt(r.timestamp)}</td><td>${statusToggleHTML(r.id, r.selesai)}</td><td><button class="del-btn" onclick="doDelete(${r.id})">🗑</button></td></tr>`,
    )
    .join("");
  renderPager(total);
}
function renderPager(total) {
  const pages = Math.ceil(total / PAGE) || 1,
    pg = document.getElementById("pager");
  if (pages <= 1) {
    pg.innerHTML = "";
    return;
  }
  let h = `<button class="pg" onclick="goPage(${_pg - 1})" ${_pg === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && i > 2 && i < pages - 1 && Math.abs(i - _pg) > 1) {
      if (i === 3 || i === pages - 2)
        h += '<span style="padding:0 3px;color:var(--g400)">…</span>';
      continue;
    }
    h += `<button class="pg ${i === _pg ? "on" : ""}" onclick="goPage(${i})">${i}</button>`;
  }
  pg.innerHTML =
    h +
    `<button class="pg" onclick="goPage(${_pg + 1})" ${_pg === pages ? "disabled" : ""}>›</button>`;
}
function goPage(p) {
  _pg = p;
  renderTable();
}

/* ── Delete / Clear ─────────────────────────────────────────────────────────── */
let _delId = null;
function doDelete(id) {
  _delId = id;
  document.getElementById("delModal").classList.add("open");
  document.getElementById("btnDel").onclick = () => {
    dbRunWithSave("DELETE FROM tamu WHERE id=?", [_delId]);
    closeMdl();
    renderTable();
    renderDash();
    updateAntrianBadge();
    toast("🗑", "Data berhasil dihapus.");
  };
}
// function doDelete(id) {
//   _delId = id;
//   document.getElementById("delModal").classList.add("open");
//   document.getElementById("btnDel").onclick = () => {
//     db.run("DELETE FROM tamu WHERE id=?", [_delId]);
//     persist();
//     const st = DBManager.status();
//     if (st.active) autoSave();
//     closeMdl();
//     renderTable();
//     renderDash();
//     updateAntrianBadge();
//     toast("🗑", "Data berhasil dihapus.");
//   };
// }
function closeMdl() {
  document.getElementById("delModal").classList.remove("open");
  _delId = null;
}

function clearAll() {
  document.getElementById("clearModal").classList.add("open");
  document.getElementById("btnClear").onclick = () => {
    dbRunWithSave("DELETE FROM tamu");
    closeMdl2();
    renderTable();
    renderDash();
    renderAntrian();
    updateAntrianBadge();
    toast("🗑", "Semua data berhasil dihapus.");
  };
}
// function clearAll() {
//   document.getElementById("clearModal").classList.add("open");
//   document.getElementById("btnClear").onclick = () => {
//     db.run("DELETE FROM tamu");
//     persist();
//     const st = DBManager.status();
//     if (st.active) autoSave();
//     closeMdl2();
//     renderTable();
//     renderDash();
//     renderAntrian();
//     updateAntrianBadge();
//     toast("🗑", "Semua data berhasil dihapus.");
//   };
// }

function closeMdl2() {
  document.getElementById("clearModal").classList.remove("open");
}

/* ── Export CSV ─────────────────────────────────────────────────────────────── */
function exportCSV() {
  const rows = dbAll("SELECT * FROM tamu ORDER BY timestamp DESC").map(
    parseKep,
  );
  if (!rows.length) {
    toast("⚠️", "Belum ada data.", 1);
    return;
  }
  const lines = [
    [
      "No",
      "No. Antrian",
      "Nama",
      "Instansi",
      "Jabatan",
      "Keperluan",
      "No. WA",
      "Email",
      "Status",
      "Waktu",
    ],
    ...rows.map((r, i) => [
      i + 1,
      r.no_antrian || "",
      r.nama,
      r.instansi || "",
      r.jabatan || "",
      r.keperluan.join("; "),
      r.no_wa,
      r.email || "",
      r.selesai ? "Selesai" : "Menunggu",
      r.timestamp,
    ]),
  ].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `buku-tamu-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast("⬇", "File CSV berhasil diunduh.");
}

async function initMediaFolder() {
  await MediaManager.init();
  updateMediaFolderBar(MediaManager.status());
}

function updateMediaFolderBar(st) {
  const bar = document.getElementById("mediaFolderBar");
  const titl = document.getElementById("mfbTitle");
  const desc = document.getElementById("mfbDesc");
  const setB = document.getElementById("mfbSetBtn");
  const clrB = document.getElementById("mfbClrBtn");

  if (!st.supported) {
    bar.className = "folder-bar inactive";
    titl.textContent = "File System Access tidak didukung browser ini";
    desc.textContent = "Gunakan Chrome atau Edge terbaru.";
    setB.style.display = "none";
    clrB.style.display = "none";
    return;
  }
  if (st.active) {
    bar.className = "folder-bar active";
    titl.textContent = `📂 Folder aktif: ${st.name}`;
    desc.textContent =
      "Poster/video akan tampil otomatis di layar TV dari folder ini.";
    setB.textContent = "↺ Ganti Folder";
    clrB.style.display = "";
  } else {
    bar.className = "folder-bar inactive";
    titl.textContent = "Folder media display belum dipilih";
    desc.textContent =
      "Pilih folder assets/display/ agar poster/video otomatis tampil di layar TV.";
    setB.textContent = "Pilih Folder assets/display/";
    clrB.style.display = "none";
  }
}

async function setMediaFolder() {
  const ok = await MediaManager.selectFolder();
  if (ok) {
    updateMediaFolderBar(MediaManager.status());
    toast(
      "🖼️",
      `Folder "${MediaManager.status().name}" dipilih untuk layar TV.`,
    );
  }
}

async function unsetMediaFolder() {
  await MediaManager.clearFolder();
  updateMediaFolderBar(MediaManager.status());
  toast("🖼️", "Folder media dilepas.");
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function bc(k) {
  if (k === "Perpustakaan") return "bp";
  if (k === "Konsultasi Statistik") return "bk";
  if (k === "Rekomendasi Statistik") return "br";
  return "bo"; // Other/Lainnya
}
function waNum(n) {
  return (n || "").replace(/\D/g, "").replace(/^0/, "62");
}
function fmtDt(dt) {
  if (!dt) return "—";
  const d = new Date(dt.includes("T") ? dt : dt.replace(" ", "T"));
  return (
    d.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) +
    "<br>" +
    d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
  );
}
function fmtTime(dt) {
  if (!dt) return "—";
  const d = new Date(dt.includes("T") ? dt : dt.replace(" ", "T"));
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
let _tt;
function toast(ico, msg, err = 0) {
  clearTimeout(_tt);
  const t = document.getElementById("toast");
  document.getElementById("tIco").textContent = ico;
  document.getElementById("tMsg").textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  void t.offsetWidth;
  t.classList.add("show");
  _tt = setTimeout(() => t.classList.remove("show"), 4000);
}

// Auto-refresh data dari tab tamu setiap 10 detik (faster polling)
setInterval(() => {
  const saved = localStorage.getItem(STORE_KEY);
  if (!saved) return;
  try {
    db = new SQL.Database(Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)));
  } catch {
    return;
  }
  if (document.getElementById("sec-dash").style.display !== "none")
    renderDash();
  if (document.getElementById("sec-antrian").style.display !== "none")
    renderAntrian();
  updateNavCnt();
  updateAntrianBadge();
}, 10000);

initDB().catch((e) => {
  clearInterval(_pt);
  document.getElementById("bootSub").textContent = "❌ " + e.message;
  console.error(e);
});
