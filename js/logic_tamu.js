"use strict";
const STORE_KEY = "bukutamu_db_v1";
const DB_FILENAME = "buku-tamu.db";
let SQL, db;

const fill = document.getElementById("bootFill");
const sub = document.getElementById("bootSub");
let _p = 0,
  _pt = setInterval(() => {
    _p = Math.min(_p + Math.random() * 22, 82);
    fill.style.width = _p + "%";
  }, 180);

async function initDB() {
  await loadInstansiList();
  sub.textContent = "Memuat sql-wasm.wasm…";
  SQL = await initSqlJs({ locateFile: () => "libs/sql-wasm.wasm" });
  sub.textContent = "Membuka database…";
  await DBManager.init();
  // Coba muat dari file db/ dulu, lalu fallback ke localStorage
  const fromFolder = await tryLoadFromFolder();
  if (!fromFolder) {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      try {
        db = new SQL.Database(
          Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)),
        );
      } catch {
        db = new SQL.Database();
      }
    } else db = new SQL.Database();
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
  // Migration: add no_antrian, selesai, and email columns if they don't exist
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
}

async function tryLoadFromFolder() {
  const st = DBManager.status();
  if (!st.supported || !st.folderSet) return false;
  const r = await DBManager.load(DB_FILENAME);
  if (r.success && r.data) {
    try {
      db = new SQL.Database(r.data);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

function persist() {
  if (!db) return;
  try {
    const d = db.export();
    localStorage.setItem(STORE_KEY, btoa(String.fromCharCode(...d)));
  } catch (e) {
    console.warn(e);
  }
  // Auto-save ke folder jika sudah dipilih
  const st = DBManager.status();
  if (st.supported && st.folderSet) {
    DBManager.save(() => db.export(), DB_FILENAME).catch(console.warn);
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

let INSTANSI_LIST = [];

async function loadInstansiList() {
  try {
    const res = await fetch("data/instansi.json");
    INSTANSI_LIST = await res.json();
  } catch (e) {
    console.warn("Gagal memuat daftar instansi:", e);
    INSTANSI_LIST = [];
  }
}

// Autocomplete
let _items = [],
  _idx = -1,
  _sugg = null,
  _timer;

function onNama(v) {
  dismissSugg();
  clearTimeout(_timer);
  if (!v.trim()) {
    closeDD();
    return;
  }
  _timer = setTimeout(() => {
    const rows = dbAll(
      `SELECT t.* FROM tamu t INNER JOIN (SELECT nama,MAX(id) mid FROM tamu WHERE nama LIKE ? COLLATE NOCASE GROUP BY LOWER(nama)) l ON t.id=l.mid ORDER BY t.timestamp DESC LIMIT 6`,
      [v.trim() + "%"],
    );
    _items = rows.map((r) => ({
      ...r,
      keperluan: r.keperluan ? r.keperluan.split("|") : [],
    }));
    _idx = -1;
    const dd = document.getElementById("dd");
    if (!rows.length) {
      closeDD();
      return;
    }
    dd.innerHTML = _items
      .map(
        (m, i) =>
          `<div class="ddi" onmousedown="pick(${i})"><div class="dn">${esc(m.nama)}</div><div class="ds">${[m.instansi, m.jabatan].filter(Boolean).join(" · ") || "&nbsp;"}</div></div>`,
      )
      .join("");
    dd.classList.add("open");
  }, 140);
}

function pick(i) {
  const m = _items[i];
  if (!m) return;
  document.getElementById("fNama").value = m.nama;
  closeDD();
  _sugg = m;
  document.getElementById("suggName").textContent =
    `Selamat datang kembali, ${m.nama}!`;
  document.getElementById("suggDetail").textContent =
    `${m.instansi || "—"} · ${m.jabatan || "—"} · Data lama ditemukan. Gunakan?`;
  document.getElementById("suggBanner").classList.add("show");
}

function schedHide() {
  setTimeout(closeDD, 180);
}

function closeDD() {
  document.getElementById("dd").classList.remove("open");
}

function onKey(e) {
  const dd = document.getElementById("dd");
  if (!dd.classList.contains("open")) return;
  const its = dd.querySelectorAll(".ddi");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    _idx = Math.min(_idx + 1, its.length - 1);
    hiDD(its);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    _idx = Math.max(_idx - 1, -1);
    hiDD(its);
  } else if (e.key === "Enter" && _idx >= 0) {
    e.preventDefault();
    pick(_idx);
  } else if (e.key === "Escape") closeDD();
}

function hiDD(its) {
  its.forEach((el, i) => el.classList.toggle("hi", i === _idx));
}

let _instItems = [],
  _instIdx = -1;

function onInst(v) {
  const q = v.trim().toLowerCase();
  if (!q) {
    closeDDInst();
    return;
  }
  // Rank starts-with matches above contains-matches, then take top 3
  const matches = INSTANSI_LIST.filter((item) => item.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts;
    })
    .slice(0, 3);

  _instItems = matches;
  _instIdx = -1;
  const dd = document.getElementById("ddInst");
  if (!matches.length) {
    closeDDInst();
    return;
  }
  dd.innerHTML = matches
    .map(
      (m, i) =>
        `<div class="ddi" onmousedown="pickInst(${i})"><div class="dn">${esc(m)}</div></div>`,
    )
    .join("");
  dd.classList.add("open");
}

function pickInst(i) {
  const m = _instItems[i];
  if (!m) return;
  document.getElementById("fInst").value = m;
  closeDDInst();
}

function schedHideInst() {
  setTimeout(closeDDInst, 180);
}

function closeDDInst() {
  document.getElementById("ddInst").classList.remove("open");
}

function onKeyInst(e) {
  const dd = document.getElementById("ddInst");
  if (!dd.classList.contains("open")) return;
  const its = dd.querySelectorAll(".ddi");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    _instIdx = Math.min(_instIdx + 1, its.length - 1);
    hiDDInst(its);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    _instIdx = Math.max(_instIdx - 1, -1);
    hiDDInst(its);
  } else if (e.key === "Enter" && _instIdx >= 0) {
    e.preventDefault();
    pickInst(_instIdx);
  } else if (e.key === "Escape") closeDDInst();
}

function hiDDInst(its) {
  its.forEach((el, i) => el.classList.toggle("hi", i === _instIdx));
}

// Suggestion
function applySugg() {
  if (!_sugg) return;
  sf("fInst", _sugg.instansi, 1);
  sf("fJab", _sugg.jabatan, 1);
  sf("fWa", _sugg.no_wa, 1);
  sf("fEmail", _sugg.email, 1);
  document.querySelectorAll(".kep").forEach((el) => {
    el.classList.remove("on");
    el.querySelector("input").checked = false;
  });
  dismissSugg();
}

function dismissSugg() {
  document.getElementById("suggBanner").classList.remove("show");
  _sugg = null;
}

function sf(id, v, mark) {
  const el = document.getElementById(id);
  el.value = v || "";
  el.classList.toggle("filled", !!mark && !!v);
}

// Checkbox
function toggleKep(lbl) {
  setTimeout(
    () => lbl.classList.toggle("on", lbl.querySelector("input").checked),
    0,
  );
}

function toggleLainnya() {
  const checked = document.getElementById("kepLainnya").checked;
  const field = document.getElementById("fieldLainnya");
  field.classList.toggle("show", checked);
  if (checked) {
    document.getElementById("fLainnya").focus();
  } else {
    document.getElementById("fLainnya").value = "";
  }
}

function getKep() {
  const checked = [...document.querySelectorAll("input[name=kep]:checked")].map(
    (c) => c.value,
  );
  // Replace "Lainnya" with the actual text
  const lainnyaIdx = checked.indexOf("Lainnya");
  if (lainnyaIdx !== -1) {
    const lainnyaText = document.getElementById("fLainnya").value.trim();
    if (lainnyaText) {
      checked[lainnyaIdx] = lainnyaText;
    } else {
      checked.splice(lainnyaIdx, 1);
    }
  }
  return checked;
}

// Get next queue number for today
function getNextQueueNumber() {
  const todayNum = dbS(
    "SELECT MAX(no_antrian) FROM tamu WHERE date(timestamp)=date('now','localtime')",
  );
  return (todayNum || 0) + 1;
}

// Auto-reset countdown
let _countdownTimer = null;

// Submit
function submitForm() {
  const nama = document.getElementById("fNama").value.trim();
  const inst = document.getElementById("fInst").value.trim();
  const jab = document.getElementById("fJab").value.trim();
  const noWa = document.getElementById("fWa").value.trim();
  const email = document.getElementById("fEmail").value.trim();
  const anyKepChecked =
    document.querySelectorAll("input[name=kep]:checked").length > 0;
  const kep = getKep();

  let valid = true;
  if (!nama) {
    shake("fNama");
    valid = false;
  }
  if (!inst) {
    shake("fInst");
    valid = false;
  }
  if (!jab) {
    shake("fJab");
    valid = false;
  }

  // Validasi No HP (angka, spasi, +, -, minimal 9 digit)
  const waRegex = /^[0-9+\-\s]{9,18}$/;
  if (!noWa || !waRegex.test(noWa)) {
    shake("fWa");
    valid = false;
  }

  // Validasi Email (opsional, tapi jika diisi harus valid)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (email && !emailRegex.test(email)) {
    shake("fEmail");
    valid = false;
  }

  if (!anyKepChecked) {
    document.querySelectorAll(".kep").forEach((el) => {
      el.classList.add("err");
    });
    shakeEl(document.querySelector(".kep-list"));
    valid = false;
  }

  // if (!kep.length) {
  //   shakeEl(document.querySelector(".kep-list"));
  //   document.querySelector(".kep-list").classList.add("err");
  //   valid = false;
  // }

  // Validate "Lainnya" textfield
  if (
    document.getElementById("kepLainnya").checked &&
    !document.getElementById("fLainnya").value.trim()
  ) {
    shake("fLainnya");
    return;
  }

  if (!valid) return;

  const btn = document.getElementById("btnDaftar");
  btn.disabled = true;
  document.getElementById("btnLabel").textContent = "Menyimpan…";
  document.getElementById("btnArr").className = "spin";
  setTimeout(() => {
    try {
      const queueNum = getNextQueueNumber();
      dbRun(
        `INSERT INTO tamu(nama,instansi,jabatan,no_wa,email,keperluan,no_antrian) VALUES(?,?,?,?,?,?,?)`,
        [nama, inst, jab, noWa, email, kep.join("|"), queueNum],
      );
      document.getElementById("sucName").textContent = nama;
      document.getElementById("qtNumber").textContent = queueNum;
      document.getElementById("suc").classList.add("show");
      startCountdown();
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      btn.disabled = false;
      document.getElementById("btnLabel").textContent = "Daftar Kunjungan";
      document.getElementById("btnArr").className = "arr";
      document.getElementById("btnArr").textContent = "→";
    }
  }, 500);
}

function startCountdown() {
  let sec = 10;
  document.getElementById("qtSec").textContent = sec;
  clearInterval(_countdownTimer);
  _countdownTimer = setInterval(() => {
    sec--;
    document.getElementById("qtSec").textContent = sec;
    if (sec <= 0) {
      clearInterval(_countdownTimer);
      resetForm();
    }
  }, 1000);
}

function resetForm() {
  clearInterval(_countdownTimer);
  document.getElementById("suc").classList.remove("show");
  ["fNama", "fInst", "fJab", "fWa", "fEmail", "fLainnya"].forEach((id) => {
    const el = document.getElementById(id);
    el.value = "";
    el.classList.remove("filled", "err");
  });
  document.querySelectorAll(".kep").forEach((el) => {
    el.classList.remove("on", "err"); // add "err" here
    el.querySelector("input").checked = false;
  });
  document.querySelector(".kep-list").classList.remove("err");
  document.getElementById("fieldLainnya").classList.remove("show");
  dismissSugg();
  closeDD();
  document.getElementById("fNama").focus();
}

function shake(id) {
  shakeEl(document.getElementById(id));
  document.getElementById(id).classList.add("err");
}

function shakeEl(el) {
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "shake .4s ease";
  el.addEventListener("animationend", () => (el.style.animation = ""), {
    once: true,
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

["fNama", "fInst", "fJab", "fWa", "fEmail", "fLainnya"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("focus", () => el.classList.remove("err"));
    el.addEventListener("input", () => el.classList.remove("err"));
  }
});

document.querySelectorAll("input[name=kep]").forEach((cb) => {
  cb.addEventListener("change", () => {
    document
      .querySelectorAll(".kep")
      .forEach((el) => el.classList.remove("err"));
  });
});

initDB().catch((e) => {
  clearInterval(_pt);
  sub.textContent = "❌ Gagal: " + e.message;
  console.error(e);
});
