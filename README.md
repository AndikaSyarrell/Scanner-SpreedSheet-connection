# Panduan Implementasi — Scan Logger ke Google Sheets

## Yang Diperlukan
- Akun Google
- Google Spreadsheet (baru atau yang sudah ada)
- Browser modern (Chrome, Edge, Firefox)

---

## Langkah 1 — Siapkan Google Spreadsheet

1. Buka [sheets.google.com](https://sheets.google.com)
2. Buat spreadsheet baru, atau buka yang sudah ada
3. Beri nama spreadsheet sesuai kebutuhan (misal: `Data Scan Gudang`)

---

## Langkah 2 — Setup Apps Script

1. Di dalam spreadsheet, klik menu **Extensions → Apps Script**
2. Tab baru akan terbuka dengan editor script
3. **Hapus semua kode** yang ada (kode default `function myFunction() {}`)
4. **Buka file `apps_script.gs`** yang sudah didownload, copy semua isinya
5. **Paste** ke editor Apps Script
6. Klik ikon **Save** atau tekan `Ctrl+S`
7. Beri nama project jika diminta (misal: `ScanLogger`)

---

## Langkah 3 — Deploy sebagai Web App

1. Klik tombol **Deploy** (pojok kanan atas) → pilih **New deployment**
2. Klik ikon **Gear** di sebelah "Select type" → pilih **Web app**
3. Isi konfigurasi:
   - **Description**: `Scan Logger v1` (bebas)
   - **Execute as**: `Me (email@gmail.com)`
   - **Who has access**: `Anyone`
4. Klik **Deploy**
5. Google akan minta izin akses → klik **Authorize access**
   - Pilih akun Google yang sama
   - Klik **Advanced** → **Go to ScanLogger (unsafe)** (ini normal untuk script pribadi)
   - Klik **Allow**
6. Setelah berhasil, **copy URL** yang muncul — bentuknya seperti:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```
   > Simpan URL ini, akan dipakai di langkah berikutnya

---

## Langkah 4 — Hubungkan HTML ke Sheets

1. **Buka file `scan_to_gsheet.html`** di browser (double-click file-nya)
2. Di kolom **"Koneksi Google Sheets"**, paste URL dari langkah 3
3. Klik tombol **Hubungkan**
4. Tunggu sebentar — aplikasi akan:
   - Mengambil data existing dari spreadsheet
   - Menampilkan semua data yang sudah ada di tabel
   - Status berubah menjadi **"Terhubung"** (dot hijau)
5. Siap scan!

---

## Cara Penggunaan Harian

### Scan barcode / QR
- Arahkan scanner ke input → tekan Enter otomatis
- Atau ketik manual → tekan Enter
- Data langsung terkirim ke Google Sheets

### Indikator status di kolom "Sheets":
| Simbol | Arti |
|--------|------|
| `●` | Data lama yang dimuat dari Sheets |
| `…` | Sedang dikirim |
| `✓` | Berhasil disimpan |
| `✗` | Gagal — akan di-retry otomatis tiap 15 detik |
| `≠` | Terdeteksi duplikat oleh server |

### Multi-sesi
- Klik **+ Sesi Baru** untuk memulai sesi scan berikutnya
- Kode yang sama boleh masuk di sesi berbeda
- Kode yang sama di sesi yang sama akan **ditolak** (duplikat)

---

## Membuka di Hari Berikutnya

1. Buka `scan_to_gsheet.html` di browser
2. Paste URL Apps Script yang sama → klik **Hubungkan**
3. Data dari hari sebelumnya otomatis dimuat — deduplikasi langsung aktif
4. Lanjutkan scan

> **Tips:** Simpan URL Apps Script di suatu tempat (notepad, sticky note) agar tidak perlu mencarinya lagi setiap hari.

---

## Jika Ada Error

### "Gagal terhubung"
- Pastikan URL diawali `https://script.google.com/macros/s/`
- Pastikan deployment sudah dibuat (bukan hanya save script)
- **Setelah update script, WAJIB buat deployment baru** (Deploy > New deployment), bukan update yang lama — URL lama tidak akan reflect perubahan kode
- Coba buka URL di tab baru dan tambahkan `?callback=test` di akhir URL — harusnya muncul `test({"status":"ok","data":[...]})`

### "Scan gagal terkirim (✗)"
- Cek koneksi internet
- Scan akan di-retry otomatis tiap 15 detik
- Jika terus gagal, refresh halaman dan hubungkan ulang

### Data tidak muncul saat connect
- Pastikan nama sheet di spreadsheet adalah **"Log Scan"** (huruf besar/kecil sensitif)
- Atau biarkan aplikasi membuat sheet baru otomatis (scan pertama akan membuatnya)

### Minta izin ulang / "Authorization required"
- Buka Apps Script → Deploy → Manage deployments
- Klik edit → update version → redeploy

---

## Struktur Data di Spreadsheet

Sheet `Log Scan` akan berisi kolom:

| No. | Kode / Barcode | Sesi | Waktu Scan | Created At |
|-----|----------------|------|------------|------------|
| 1 | ABC123 | Sesi #1 | 08:32:10 | 17/06/2026, 08:32:10 |
| 2 | XYZ789 | Sesi #1 | 08:33:45 | 17/06/2026, 08:33:45 |

- Header berwarna biru, frozen (tidak ikut scroll)
- Baris bergantian warna untuk keterbacaan
- Lebar kolom auto-resize mengikuti konten


---

## Catatan Teknis

### Kenapa pakai JSONP bukan fetch biasa?
Saat HTML dibuka sebagai file lokal (`file://`), browser menerapkan kebijakan CORS ketat.
Google Apps Script tidak mendukung penambahan header `Access-Control-Allow-Origin` secara manual.
Solusinya: **JSONP** — browser mengizinkan load `<script>` cross-origin tanpa batasan CORS.

### Kenapa POST pakai `no-cors`?
Dengan `mode: 'no-cors'`, browser mengirim request tanpa membaca response (opaque).
Data **tetap masuk** ke spreadsheet — hanya statusnya yang tidak bisa dibaca.
Deduplikasi ditangani di sisi browser menggunakan data yang sudah di-fetch saat connect.

### Alur lengkap
```
Buka HTML
  → Paste URL → Hubungkan
  → JSONP GET ke Apps Script
  → Apps Script baca sheet → return JSON via callback
  → Browser muat data, bangun existingKeys untuk deduplikasi
  → Siap scan

Setiap scan:
  → Cek duplikat di existingKeys (browser)
  → POST no-cors ke Apps Script
  → Apps Script append row ke sheet
  → Browser tandai sync ✓
```