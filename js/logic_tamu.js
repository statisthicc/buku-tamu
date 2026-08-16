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
  const instansiPromise = loadInstansiList();
  const pekerjaanPromise = loadPekerjaanList();
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
  try {
    db.run("ALTER TABLE tamu ADD COLUMN pekerjaan TEXT DEFAULT ''");
  } catch (e) {}

  await Promise.all([instansiPromise, pekerjaanPromise]);

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
  _nameCache = null; // invalidate cache so next search rebuilds it with fresh data
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
  _timer,
  _nameCache = null;

function refreshNameCache() {
  _nameCache = dbAll(
    `SELECT t.* FROM tamu t INNER JOIN (
       SELECT nama, MAX(id) mid FROM tamu GROUP BY LOWER(nama)
     ) l ON t.id = l.mid`,
  );
}

function onNama(v) {
  dismissSugg();
  clearTimeout(_timer);
  const q = v.trim();

  if (q.length < 4) {
    closeDD();
    return;
  }

  _timer = setTimeout(() => {
    if (!_nameCache) refreshNameCache(); // build cache only if missing

    const scored = _nameCache
      .map((r) => ({ ...r, _score: nameSimilarity(q, r.nama) }))
      .filter((r) => r._score > 0) // nameSimilarity already returns 0 for rejected matches
      .sort((a, b) => b._score - a._score)
      .slice(0, 3);

    _items = scored.map((r) => ({
      ...r,
      keperluan: r.keperluan ? r.keperluan.split("|") : [],
    }));
    _idx = -1;
    const dd = document.getElementById("dd");
    if (!_items.length) {
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
    `${m.instansi || "—"} · ${m.jabatan || "—"} — Data pengguna ditemukan. Gunakan?`;
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

// Suggestion
function applySugg() {
  if (!_sugg) return;
  sf("fInst", _sugg.instansi, 1);
  sf("fJab", _sugg.jabatan, 1);
  sf("fWa", _sugg.no_wa, 1);
  sf("fEmail", _sugg.email, 1);

  // Apply Pekerjaan if it exists in the suggested record
  if (_sugg.pekerjaan) {
    applyPekerjaanSugg(_sugg.pekerjaan);
  }

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

//Pekerjaan Utama
let PEKERJAAN_LIST = [];

async function loadPekerjaanList() {
  try {
    const res = await fetch("data/pekerjaan.json");
    PEKERJAAN_LIST = await res.json();
  } catch (e) {
    console.warn("Gagal memuat daftar pekerjaan:", e);
    PEKERJAAN_LIST = [];
  }
  renderPekerjaanDD(); // add this line — builds the dropdown items once loaded
}

function renderPekerjaanDD() {
  const dd = document.getElementById("csDD");
  dd.innerHTML = PEKERJAAN_LIST.map(
    (p) =>
      `<div class="cs-item" onclick="pickPekerjaan('${esc(p).replace(/'/g, "\\'")}')">${esc(p)}</div>`,
  ).join("");
}

function togglePekerjaanDD() {
  document.getElementById("csPekerjaan").classList.toggle("open");
}

// function pickPekerjaan(val) {
//   document.getElementById("fPekerjaan").value = val;
//   document.getElementById("csLabel").textContent = val;
//   document.getElementById("csTrigger").classList.add("filled");
//   document.getElementById("csTrigger").classList.remove("err");
//   document.getElementById("csPekerjaan").classList.remove("open");
// }

function pickPekerjaan(val) {
  document.getElementById("fPekerjaan").value = val;
  document.getElementById("csLabel").textContent = val;
  document.getElementById("csTrigger").classList.add("has-value");
  document.getElementById("csTrigger").classList.remove("filled");
  document.getElementById("csTrigger").classList.remove("err");
  document.getElementById("csPekerjaan").classList.remove("open");

  toggleJabatanField(val);
}

function applyPekerjaanSugg(val) {
  document.getElementById("fPekerjaan").value = val;
  document.getElementById("csLabel").textContent = val;
  document.getElementById("csTrigger").classList.add("has-value");
  document.getElementById("csTrigger").classList.add("filled");
  document.getElementById("csTrigger").classList.remove("err");
  document.getElementById("csPekerjaan").classList.remove("open");

  toggleJabatanField(val);
}

// Close when clicking outside
document.addEventListener("click", (e) => {
  const cs = document.getElementById("csPekerjaan");
  if (cs && !cs.contains(e.target)) {
    cs.classList.remove("open");
  }
});

function toggleJabatanField(pekerjaan) {
  const jabatanInput = document.getElementById("fJab");
  // const jabReq = document.getElementById("jabReq");
  const isUmum = pekerjaan === "Masyarakat Umum";

  jabatanInput.disabled = isUmum;
  jabatanInput.classList.remove("err");
  // jabReq.style.display = isUmum ? "none" : "inline-block";

  if (isUmum) {
    jabatanInput.value = "";
    jabatanInput.placeholder = "-";
  } else {
    jabatanInput.placeholder = "Jabatan Anda…";
  }
}

//Instansi
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
        `<div class="ddi" onmousedown="pickInst(${i})"><div class="dn-inst">${esc(m)}</div></div>`,
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
  const pekerjaan = document.getElementById("fPekerjaan").value;
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

  if (!pekerjaan) {
    shakeEl(document.getElementById("csTrigger"));
    document.getElementById("csTrigger").classList.add("err");
    valid = false;
  }

  if (!inst) {
    shake("fInst");
    valid = false;
  }

  if (!document.getElementById("fJab").disabled && !jab) {
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
  // document.getElementById("btnArr").className = "spin";
  document.getElementById("btnArrIcon").style.display = "none";
  document.getElementById("btnSpinner").style.display = "inline-block";
  setTimeout(() => {
    try {
      const queueNum = getNextQueueNumber();
      dbRun(
        `INSERT INTO tamu(nama,instansi,jabatan,no_wa,email,pekerjaan,keperluan,no_antrian) VALUES(?,?,?,?,?,?,?,?)`,
        [nama, inst, jab, noWa, email, pekerjaan, kep.join("|"), queueNum],
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
      document.getElementById("btnSpinner").style.display = "none";
      document.getElementById("btnArrIcon").style.display = "block";
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
  document.getElementById("fPekerjaan").value = "";
  document.getElementById("csLabel").textContent = "Pilih pekerjaan…";
  document
    .getElementById("csTrigger")
    .classList.remove("filled", "err", "has-value");
  document.querySelector(".kep-list").classList.remove("err");
  document.getElementById("fieldLainnya").classList.remove("show");
  document.getElementById("fJab").disabled = false;
  document.getElementById("fJab").placeholder = "Jabatan Anda…";
  document.getElementById("jabReq").style.display = "inline-block";
  dismissSugg();
  closeDD();
  document.getElementById("fNama").focus();
}

function resetAllInputs() {
  if (!confirm("Hapus semua isian?")) return;
  ["fNama", "fInst", "fJab", "fWa", "fEmail", "fLainnya"].forEach((id) => {
    const el = document.getElementById(id);
    el.value = "";
    el.classList.remove("filled", "err");
  });

  document.querySelectorAll(".kep").forEach((el) => {
    el.classList.remove("on", "err");
    el.querySelector("input").checked = false;
  });

  document.getElementById("fieldLainnya").classList.remove("show");

  // Reset Pekerjaan Utama custom dropdown
  document.getElementById("fPekerjaan").value = "";
  document.getElementById("csLabel").textContent = "Pilih pekerjaan…";
  document
    .getElementById("csTrigger")
    .classList.remove("filled", "err", "has-value");
  document.getElementById("fJab").disabled = false;
  document.getElementById("fJab").placeholder = "Jabatan Anda…";
  document.getElementById("jabReq").style.display = "inline-block";
  dismissSugg();
  closeDD();
  closeDDInst();

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

// Standard Levenshtein distance
function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// Compares typed query against the START of a word (same length as query),
// so partial typing + small typos still score high
function prefixSimilarity(query, word) {
  query = query.toLowerCase();
  word = word.toLowerCase();
  if (!word.length) return 0;
  const prefix = word.slice(0, query.length);
  const dist = levenshtein(query, prefix);
  const maxLen = Math.max(query.length, prefix.length);
  return maxLen === 0 ? 0 : 1 - dist / maxLen;
}

function nameSimilarity(query, fullName) {
  const queryWords = query.trim().split(/\s+/);
  const nameWords = fullName.trim().split(/\s+/);

  const perWordScores = queryWords.map((qw) => {
    let best = 0;
    for (const nw of nameWords) {
      const s = prefixSimilarity(qw, nw);
      if (s > best) best = s;
    }
    return best;
  });

  // Every typed word must individually clear a lower bar (e.g. 70%)
  const allWordsPass = perWordScores.every((s) => s >= 0.8);
  if (!allWordsPass) return 0; // reject immediately if any word is way off

  // Return the average as the "display" score, but gating already happened above
  return perWordScores.reduce((a, b) => a + b, 0) / perWordScores.length;
}

["fNama", "fInst", "fJab", "fWa", "fEmail", "fLainnya"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("focus", () => el.classList.remove("err"));
    el.addEventListener("input", () => el.classList.remove("err"));
  }
});

["fInst", "fJab", "fWa", "fEmail"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", () => el.classList.remove("filled"));
  }
});

document.getElementById("fPekerjaan").addEventListener("change", function () {
  this.classList.remove("err");
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
