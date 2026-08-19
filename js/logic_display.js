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

let POSTER_MEDIA = [];
let _posterIdx = 0;
let _posterTimer = null;

async function initPosterLoop() {
  await MediaManager.init();
  const st = MediaManager.status();

  if (!st.active) {
    console.warn("[Display] Folder assets/display/ belum dipilih dari Admin.");
    return; // silently do nothing — no prompt, no button
  }

  POSTER_MEDIA = await MediaManager.listMedia();
  if (!POSTER_MEDIA.length) {
    console.warn("[Display] Tidak ada media di folder assets/display/.");
    return;
  }
  showPoster(0);
}

// function showFolderPrompt() {
//   const container = document.getElementById("posterMedia");
//   container.innerHTML = `
//     <div class="poster-prompt">
//       <p>Pilih folder <b>assets/display/</b> untuk menampilkan poster/video</p>
//       <button onclick="selectMediaFolder()">Pilih Folder</button>
//     </div>`;
// }

// async function selectMediaFolder() {
//   const ok = await MediaManager.selectFolder();
//   if (ok) initPosterLoop();
// }

// function showPoster(i) {
//   clearTimeout(_posterTimer);
//   const item = POSTER_MEDIA[i];
//   const container = document.getElementById("posterMedia");

//   if (item.type === "image") {
//     container.innerHTML = `<img src="${item.url}" alt="" />`;
//     _posterTimer = setTimeout(nextPoster, 8000);
//   } else if (item.type === "video") {
//     container.innerHTML = `<video src="${item.url}" autoplay muted playsinline></video>`;
//     const vid = container.querySelector("video");
//     vid.addEventListener("ended", nextPoster, { once: true });
//     vid.addEventListener("error", nextPoster, { once: true });
//   }
// }

function showPoster(i) {
  clearTimeout(_posterTimer);
  const item = POSTER_MEDIA[i];
  const container = document.getElementById("posterMedia");

  if (item.type === "image") {
    container.innerHTML = `<img src="${item.url}" alt="" />`;
    _posterTimer = setTimeout(nextPoster, 8000);
  } else if (item.type === "video") {
    container.innerHTML = `
      <video src="${item.url}" autoplay muted playsinline id="posterVideo"></video>
      <button class="mute-btn" id="muteBtn" onclick="toggleMute(event)">
        <img src="img/volume-x.svg" alt="" id="muteIcon" />
      </button>
    `;
    const vid = document.getElementById("posterVideo");
    vid.muted = _videoMuted; // respect last-known mute state across videos
    updateMuteIcon();

    vid.addEventListener("ended", nextPoster, { once: true });
    vid.addEventListener(
      "error",
      (e) => {
        console.error("[Display] Video gagal diputar:", item.name, vid.error);
        nextPoster();
      },
      { once: true },
    );
  }
}

let _videoMuted = true;

function toggleMute(e) {
  e.stopPropagation();
  const vid = document.getElementById("posterVideo");
  if (!vid) return;
  _videoMuted = !_videoMuted;
  vid.muted = _videoMuted;
  updateMuteIcon();
}

function updateMuteIcon() {
  const icon = document.getElementById("muteIcon");
  if (!icon) return;
  icon.src = _videoMuted ? "img/volume-off.svg" : "img/volume-on.svg";
}

function nextPoster() {
  _posterIdx = (_posterIdx + 1) % POSTER_MEDIA.length;
  showPoster(_posterIdx);
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

initPosterLoop();
