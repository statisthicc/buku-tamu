# 📋 Buku Tamu Digital — PST BPS Kabupaten Buton Utara

Aplikasi Buku Tamu Digital yang didesain khusus untuk Pelayanan Statistik Terpadu (PST) BPS Kabupaten Buton Utara. Berjalan 100% offline menggunakan SQLite (WASM) dan File System Access API.

## ✨ Fitur Unggulan

- **Sistem Antrian Otomatis**: Generate nomor antrian harian yang otomatis reset setiap hari.
- **Tiket Antrian Digital**: Tampilan nomor antrian setelah pendaftaran sukses dengan timer auto-reset 10 detik.
- **Dashboard Admin Interaktif**: Panel pemantauan tamu dengan statistik kunjungan real-time.
- **Manajemen Pelayanan**: Tombol toggle (switch) untuk menandai status pelayanan tamu (Menunggu/Selesai).
- **Validasi Form**: Validasi format otomatis untuk nomor WhatsApp dan Email.
- **Form Dinamis**: Opsi keperluan "Lainnya" yang memunculkan kolom input teks tambahan.
- **Pencarian & Filter**: Cari data tamu berdasarkan nama, instansi, atau keperluan secara instan.
- **Export CSV**: Unduh data tamu lengkap ke format Excel/CSV untuk pelaporan.
- **Penyimpanan Lokal**: Data tersimpan aman di browser (localStorage) dan bisa disimpan ke file `.db` lokal.

## 🚀 Persiapan Cepat

Ikuti langkah berikut untuk menyiapkan environment:

### 1. Struktur Folder

Pastikan struktur folder seperti ini:

```text
buku-tamu/
├── tamu.html
├── admin.html
├── js/
│   ├── logic_tamu.js
│   ├── logic_admin.js
│   └── db-manager.js
├── css/
│   ├── style_tamu.css
│   └── style_admin.css
├── libs/
│   ├── sql-wasm.js
│   └── sql-wasm.wasm
└── fonts/
    └── (Plus Jakarta Sans fonts)
```

### 2. Cara Menjalankan

Karena menggunakan SQLite WASM, aplikasi harus dijalankan melalui web server lokal (tidak bisa langsung klik file HTML):

**Python 3:**

```bash
python -m http.server 8080
```

Buka di browser: `http://localhost:8080/tamu.html` (untuk tamu) atau `/admin.html` (untuk admin).

**VS Code:**
Gunakan ekstensi **Live Server** lalu klik kanan pada `tamu.html` > _Open with Live Server_.

## 🛠️ Teknologi

- **Core**: HTML5, Vanilla CSS3, Modern JavaScript (ES6+).
- **Database**: SQLite via `sql.js` (WASM).
- **Storage**: Browser LocalStorage & File System Access API.
- **Design**: Modern UI/UX dengan font Plus Jakarta Sans.

---

© 2026 BPS Kabupaten Buton Utara - PST Digital Team
