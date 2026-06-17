// ============================================================
// Google Apps Script — Scan Logger Receiver
// Deploy: Web App > Execute as: Me > Who has access: Anyone
//
// PENTING: Setelah edit script, selalu buat deployment BARU
//          (Deploy > New deployment), bukan update yang lama.
// ============================================================

const SHEET_NAME = 'Log Scan';

// ── GET: ambil semua data + support CORS via callback (JSONP) ────────────────
// HTML memanggil: ?callback=cb123
// Apps Script return: cb123({...json...})
// Ini cara satu-satunya agar cross-origin GET bisa dibaca dari file lokal.
function doGet(e) {
  try {
    const callback = e.parameter.callback; // JSONP callback name
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const sheet    = ss.getSheetByName(SHEET_NAME);
    let data       = [];

    if (sheet && sheet.getLastRow() > 1) {
      const lastRow = sheet.getLastRow();
      const rows    = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      data = rows
        .filter(r => r[1] !== '')
        .map(r => ({
          no:           r[0],
          code:         String(r[1]),
          sessionLabel: String(r[2]),
          time:         String(r[3]),
          createdAt:    String(r[4]),
        }));
    }

    const json = JSON.stringify({ status: 'ok', data });

    // Jika ada callback → JSONP (untuk fetch dari file lokal)
    // Jika tidak → JSON biasa (untuk test di browser)
    const body = callback ? `${callback}(${json})` : json;
    return ContentService
      .createTextOutput(body)
      .setMimeType(callback
        ? ContentService.MimeType.JAVASCRIPT
        : ContentService.MimeType.JSON);

  } catch (err) {
    const callback = (e && e.parameter && e.parameter.callback) || null;
    const json     = JSON.stringify({ status: 'error', message: err.message });
    const body     = callback ? `${callback}(${json})` : json;
    return ContentService
      .createTextOutput(body)
      .setMimeType(callback
        ? ContentService.MimeType.JAVASCRIPT
        : ContentService.MimeType.JSON);
  }
}

// ── POST: terima scan baru ────────────────────────────────────────────────────
// POST dari fetch() dengan mode: 'no-cors' → response opaque (tidak bisa dibaca)
// Tapi data TETAP masuk ke sheet. Kita anggap sukses jika tidak throw.
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let sheet   = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      initHeader(sheet);
    }

    // Cek duplikat
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const existing = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      const isDup = existing.some(r =>
        String(r[1]) === String(data.code) &&
        String(r[2]) === String(data.sessionLabel)
      );
      if (isDup) {
        return jsonResponse({ status: 'duplicate' });
      }
    }

    const no     = lastRow; // sebelum append: lastRow = jumlah baris ada
    const newRow = [no, data.code, data.sessionLabel, data.time, data.createdAt];
    sheet.appendRow(newRow);

    const addedRow = sheet.getLastRow();
    if (addedRow % 2 === 0) {
      sheet.getRange(addedRow, 1, 1, 5).setBackground('#F0F4FF');
    }
    sheet.autoResizeColumns(1, 5);

    return jsonResponse({ status: 'ok', row: addedRow, no });

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function initHeader(sheet) {
  const headers = ['No.', 'Kode / Barcode', 'Sesi', 'Waktu Scan', 'Created At'];
  sheet.appendRow(headers);
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setBackground('#1E56A0')
       .setFontColor('#FFFFFF')
       .setFontWeight('bold')
       .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 50);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 170);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}