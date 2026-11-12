// =============================================================================
// Machine.gs — standalone Apps Script Web App for the "Machine & Repairing
// Details" KPI (Machine section).
// =============================================================================
// This is a SEPARATE Google Spreadsheet from the main FMS workbook and from
// the Die-Less Knife Cutting Machine workbook (DieLess.gs), so it is
// deployed as its OWN Web App (its own /exec URL) — same pattern as
// DieLess.gs / PlannedDate.gs / Store.gs.
//
// Deploy this file's URL and paste it into MACHINE_URL near the top of
// main.js.
//
// WHAT IT DOES
// ------------
// Reads the "Machine & Servicing Details" sheet, range C4:T (row 4 = headers), and
// returns every non-blank row as { headers, rows } for the data table /
// Excel export in the "Machine & Repairing Details" view.
// =============================================================================

var MACHINE_SPREADSHEET_ID = '1ynkNHONkaNX_sV5E_PyEwe-S3Ra7DXVjq8JwL5POlzw';
var MACHINE_SHEET_NAME     = 'Machine & Servicing Details';
var MACHINE_START_COLUMN   = 'C';
var MACHINE_END_COLUMN     = 'T';
var MACHINE_HEADER_ROW     = 4;

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getMachineRepairingDetails') {
    return machineJsonOutput_(getMachineRepairingDetails_());
  }

  return machineJsonOutput_({ success: true, message: 'Machine endpoint is running.' });
}

// ---------------------------------------------------------------------------
// Core logic: reads MACHINE_START_COLUMN:MACHINE_END_COLUMN (B:N) from the
// "Machine Details" sheet, row 1 as headers, and returns every row that has
// at least one non-blank cell.
// ---------------------------------------------------------------------------
function getMachineRepairingDetails_() {
  try {
    var ss = SpreadsheetApp.openById(MACHINE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(MACHINE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Sheet "' + MACHINE_SHEET_NAME + '" was not found.' };

    var lastRow = sheet.getLastRow();
    if (lastRow < MACHINE_HEADER_ROW) return { success: true, headers: [], rows: [] };

    var range  = MACHINE_START_COLUMN + MACHINE_HEADER_ROW + ':' + MACHINE_END_COLUMN + lastRow;
    var values = sheet.getRange(range).getDisplayValues();

    var headers = values[0] || [];
    var rows = values.slice(1).filter(function (row) {
      return row.some(function (cell) { return String(cell).trim() !== ''; });
    });

    return { success: true, headers: headers, rows: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function machineJsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
