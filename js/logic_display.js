"use strict";
const STORE_KEY = "bukutamu_db_v1";
const DB_FILENAME = "buku-tamu.db";
let SQL, db;

const fill = document.getElementById("bootFill");
const sub = document.getElementById("bootSub");

async function initDB() {
  sub.textContent = "Memuat sql-wasm.wasm…";
  SQL = await initSqlJs({ locateFile: () => "libs/sql-wasm.wasm" });
  sub.textContent = "Membuka database…";
  await DBManager.init();
  await loadFromStorage();

  document.getElementById("boot").classList.add("gone");
  refreshDisplay();
  updateDateTime();
  setInterval(refreshDisplay, 5000);
  setInterval(updateDateTime, 1000);
}

async function loadFromStorage() {
  const st = DBManager.status();
  let loaded = false;
  if (st.active) {
    const r = await DBManager.load(DB_FILENAME);
    if (r.ok && r.data) {
      try {
        db = new SQL.Database(r.data);
        loaded = true;
      } catch (e) {}
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
}

function dbAll(sql, p = []) {
  const r = db.exec(sql, p);
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((c, i) => [c, row[i]])),
  );
}

function refreshDisplay() {
  const today = dbAll(
    `SELECT nama, no_antrian, selesai FROM tamu
     WHERE date(timestamp)=date('now','localtime') AND no_antrian > 0
     ORDER BY no_antrian ASC`,
  );

  const waiting = today.filter((r) => !r.selesai);
  const serving = waiting[0];
  const upcoming = waiting.slice(1, 6);

  const numEl = document.getElementById("servingNumber");
  if (serving) {
    numEl.textContent = serving.no_antrian;
    numEl.classList.add("pulse");
  } else {
    numEl.textContent = "—";
    numEl.classList.remove("pulse");
  }

  const list = document.getElementById("queueList");
  if (!upcoming.length) {
    list.innerHTML = `<div class="tvq-empty">Tidak ada antrian menunggu</div>`;
  } else {
    list.innerHTML = upcoming
      .map(
        (r) =>
          `<div class="tvq-item"><span class="tvq-num">${r.no_antrian}</span><span class="tvq-name">${esc(r.nama)}</span></div>`,
      )
      .join("");
  }
}

function updateDateTime() {
  const now = new Date();
  document.getElementById("tvDate").textContent = now.toLocaleDateString(
    "id-ID",
    {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    },
  );
  const time = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
  document.getElementById("tvTime").textContent = time + " Wita";
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// function syncColumnHeights() {
//   const box = document.querySelector(".poster-box");
//   const right = document.getElementById("tvColRight");
//   if (box && right) {
//     right.style.height = box.offsetHeight + "px";
//   }
// }

// window.addEventListener("load", syncColumnHeights);
// window.addEventListener("resize", syncColumnHeights);
// document.addEventListener("fullscreenchange", () => {
//   setTimeout(syncColumnHeights, 100); // slight delay so layout settles after fullscreen toggle
// });

window.addEventListener("storage", (e) => {
  if (e.key === STORE_KEY) {
    loadFromStorage().then(refreshDisplay);
  }
});

initDB().catch((e) => {
  sub.textContent = "❌ Gagal: " + e.message;
  console.error(e);
});
