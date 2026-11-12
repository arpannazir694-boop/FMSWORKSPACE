// =============================================================================
// OT.gs — deploy this file as its OWN standalone Apps Script project / Web App
// =============================================================================
// This is a SEPARATE Google Apps Script project from Code.gs and DICE_FORMA.gs.
// It is bound to a different Google Sheet and must be deployed as its own Web
// App. It powers the three "OT & Leave" sub-views in the FMS FORM UI:
//
//   1. OT Details            -> "Additional Work Details" sheet, range B2:I
//   2. Leave Details         -> "Leave Attendance Details" sheet, range B2:H
//   3. OT & Leave Analysis   -> "Additional Work Details" sheet, range B2:O
//
// In every range above, row 2 (the FIRST row of the range) holds the table
// headers, and every row after that is data.
//
// SETUP
// -----
// 1. Create/open a new Apps Script project (Extensions > Apps Script) from
//    the OT & Leave spreadsheet itself, OR create a standalone script and
//    keep OT_LEAVE_SPREADSHEET_ID pointed at the sheet below.
// 2. Paste this file in as OT.gs.
// 3. Deploy > New deployment > Web app > Execute as: Me > Who has access:
//    Anyone (or "Anyone with Google account", matching the rest of the app).
// 4. Copy the resulting /exec URL into OT_LEAVE_URL near the top of main.js.
//    (The URL already wired into main.js is the one supplied when this
//    integration was built: see main.js for the current value.)
// =============================================================================

var OT_LEAVE_SPREADSHEET_ID = '1JwMG1jv7_rVUC4zx3EJy9Do7P1qRJdZWiWpqxRKGzFs';

var OT_DETAILS_SHEET       = 'Additional Work Details';
var LEAVE_DETAILS_SHEET    = 'Leave Attendance Details';
var OT_ANALYSIS_SHEET      = 'Additional Work Details';

var OT_DETAILS_RANGE       = 'B2:I';
var LEAVE_DETAILS_RANGE    = 'B2:H';
var OT_ANALYSIS_RANGE      = 'B2:O';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getOtDetailsData') {
    return jsonOutput_(getOtLeaveRangeData_(OT_DETAILS_SHEET, OT_DETAILS_RANGE));
  }
  if (action === 'getLeaveDetailsData') {
    return jsonOutput_(getOtLeaveRangeData_(LEAVE_DETAILS_SHEET, LEAVE_DETAILS_RANGE));
  }
  if (action === 'getOtLeaveAnalysisData') {
    return jsonOutput_(getOtLeaveRangeData_(OT_ANALYSIS_SHEET, OT_ANALYSIS_RANGE));
  }

  return jsonOutput_({ success: true, message: 'OT & Leave web app endpoint is running.' });
}

// ---------------------------------------------------------------------------
// Reads a sheet range where the FIRST row of the range is the header row and
// every subsequent row is data. Returns { success, headers: [...], rows: [[...]] }.
// Uses display values so dates/numbers appear formatted exactly as in the sheet.
// ---------------------------------------------------------------------------
function getOtLeaveRangeData_(sheetName, rangeA1) {
  try {
    var ss = SpreadsheetApp.openById(OT_LEAVE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { success: false, error: 'Sheet "' + sheetName + '" was not found in the OT & Leave spreadsheet.' };
    }

    // rangeA1 is a column-bounded range like "B2:I" — pin it to the sheet's
    // actual last row so we don't read millions of empty cells.
    var lastRow = sheet.getLastRow();
    var colMatch = rangeA1.match(/^([A-Z]+)(\d+):([A-Z]+)$/i);
    if (!colMatch) {
      return { success: false, error: 'Invalid range configuration: ' + rangeA1 };
    }
    var startCol   = colMatch[1];
    var headerRow  = parseInt(colMatch[2], 10);
    var endCol     = colMatch[3];

    if (lastRow < headerRow) {
      return { success: true, headers: [], rows: [] };
    }

    var fullRange = startCol + headerRow + ':' + endCol + lastRow;
    var values = sheet.getRange(fullRange).getDisplayValues();

    var headers = values[0] || [];
    var rows    = values.slice(1).filter(function (row) {
      // Skip fully-blank trailing rows
      return row.some(function (cell) { return String(cell).trim() !== ''; });
    });

    return { success: true, headers: headers, rows: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
