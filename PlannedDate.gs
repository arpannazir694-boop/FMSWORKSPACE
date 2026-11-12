// =============================================================================
// PlannedDate.gs — standalone Apps Script Web App for the "Follow-Up Planned"
// PDF report (PDF section > Follow-Up Planned).
//
// This is a SEPARATE Google Spreadsheet from the main FMS workbook, so it is
// deployed as its OWN Web App (its own /exec URL) — same pattern as
// Store.gs. Deploy this file's URL and paste it into
// PLANNED_DATE_WEB_APP_URL near the top of web.js.
//
// WHAT IT DOES
// ------------
// Given a single "Planned Date" (YYYY-MM-DD), scans every row of the
// "PLANNED DATE" sheet and returns every record that has a matching planned
// date in ANY of these stages:
//   1. 1st Follow-up — Floor Supervisor
//   2. 1st Follow-up — In-Line QC
//   3. 2nd Follow-up — Floor Supervisor
//   4. 2nd Follow-up — In-Line QC
//   5. 3rd Follow-up — Floor Supervisor
//   6. 3rd Follow-up — In-Line QC
//   7. End-Line QC
//   8. Edge-Paint            <-- see EDGE-PAINT NOTE below
//   9. Pre-AQL
//  10. Post AQL
//  11. Shipment
//
// IMPORTANT — Floor Supervisor and In-Line QC are kept as two INDEPENDENT
// stages per follow-up round, each matched against its own date column. A
// record is never merged into one combined "Supervisor & QC" bucket — if
// only the Supervisor's date matches the selected Planned Date, the record
// appears only under "…— Floor Supervisor"; if only the QC's date matches,
// it appears only under "…— In-Line QC"; if both match, it correctly
// appears under both (two separate, independent matches, not one combined
// value).
//
// For every matching record, the following fields are returned:
//   Unit, Batch No., Fabricator Name, Brand, SKU, Style, Colour, Quantity, ETD,
//   Floor Supervisor Name, In-Line QC Name
//
// The client (web.js) groups the response by stage and renders a PDF that
// only includes the stages that actually have records for the chosen date.
//
// SHEET → COLUMN MAP (as of the sample "PLANNED DATE" sheet)
// -------------------------------------------------------------------------
//   A  FMS UPLOAD TIMESTAMP
//   B  BATCH NO.                      <- record field: batchNo
//   C  LEATHER RECEIVED DATE
//   D  CREATOR (DOER)
//   E  UNIT                           <- record field: unit
//   F  FABRICATOR NAME (NO)           <- record field: fabricatorName
//   G  BRAND                          <- record field: brand
//   H  SEASON
//   I  CATEGORY
//   J  SKU                            <- record field: sku
//   K  Style                          <- record field: style
//   L  COLOUR                         <- record field: colour
//   M  QUANTITY                       <- record field: quantity
//   N  ETD                            <- record field: etd
//   O  PO
//   P  FLOOR SUPERVISOR NAME          <- record field: floorSupervisorName
//   Q  INLINE QC NAME                 <- record field: inlineQcName
//   R  PRODUCTION DAYS
//   S  FLOOR SUPERVISOR - 1ST FOLLOW UP PLANNED   -> stage "fu1_fs"
//   T  FLOOR SUPERVISOR - 2ND FOLLOW UP PLANNED   -> stage "fu2_fs"
//   U  FLOOR SUPERVISOR - 3RD FOLLOW UP PLANNED   -> stage "fu3_fs"
//   V  IN-LINE QC 1ST FOLLOW UP PLANNED           -> stage "fu1_qc"
//   W  IN-LINE QC 2ND FOLLOW UP PLANNED           -> stage "fu2_qc"
//   X  IN-LINE QC 3RD FOLLOW UP PLANNED           -> stage "fu3_qc"
//   Y  END-LINE QC Planned Date                   -> stage "endline"
//   Z  Pre-AQL Planned Date                       -> stage "preaql"
//   AA Warehouse Planned Date                     (not part of the requested
//                                                    stages — left unused)
//   AB Post AQL Planned Date                      -> stage "postaql"
//   AC SHIPMENT Planned Date                      -> stage "shipment"
//   AD                                            <- record field: adData
//
// NOTE ON V/W/X HEADER TEXT: in the source sheet, the header cells for V, W
// and X are all literally labelled "IN-LINE QC 1ST FOLLOW UP PLANNED" (a
// copy/paste artifact in the sheet itself), but their DATA lines up
// positionally with S/T/U (1st/2nd/3rd), which is what this script relies
// on — not the header text. If you ever reorder these columns, update the
// letters in PD_STAGE_DEFS below to match, since the header text alone
// cannot be used to tell them apart.
//
// EDGE-PAINT NOTE
// ----------------
// The sample sheet does NOT currently have a dedicated "Edge-Paint Planned
// Date" column (it has "Warehouse Planned Date" in column AA instead). The
// "Edge-Paint" stage below is wired up and will appear in the report exactly
// like the others, but its dateCol is left as null until a real column
// exists. As soon as you add an "Edge-Paint Planned Date" column to the
// sheet, just set EDGE_PAINT_DATE_COL below to that column's letter and
// redeploy — no other change is needed.
// =============================================================================

var PLANNED_DATE_SPREADSHEET_ID = '1_SkPmFfQ9mcmcc5-oqcSIboeEXa8Uds-PXB0cVrI8Uw';
var PLANNED_DATE_SHEET_NAME     = 'PLANNED DATE';

// Set this once an "Edge-Paint Planned Date" column exists in the sheet.
var EDGE_PAINT_DATE_COL = null; // e.g. 'AD'

// ---------------------------------------------------------------------------
// Record field columns (letters, 1 header row assumed)
// ---------------------------------------------------------------------------
var PD_FIELD_COLS = {
  unit:                 'E',
  batchNo:              'B',
  adData:               'AD',
  fabricatorName:       'F',
  brand:                'G',
  sku:                  'J',
  style:                'K',
  colour:               'L',
  quantity:             'M',
  etd:                  'N',
  floorSupervisorName:  'P',
  inlineQcName:         'Q'
};

// ---------------------------------------------------------------------------
// Units to always exclude from the report/PDF entirely, regardless of stage
// or date match. Comparison is case-insensitive and ignores surrounding
// whitespace, so "14-b", " 114 ", etc. are also excluded.
// ---------------------------------------------------------------------------
var PD_EXCLUDED_UNITS = ['14-B', '114'];

function isExcludedUnit_(unitValue) {
  var normalized = String(unitValue == null ? '' : unitValue).trim().toUpperCase();
  for (var i = 0; i < PD_EXCLUDED_UNITS.length; i++) {
    if (normalized === String(PD_EXCLUDED_UNITS[i]).trim().toUpperCase()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The 11 stages, in display order. Every stage is matched against exactly
// ONE date column — Floor Supervisor and In-Line QC are always separate
// stages, never merged into a single match.
// ---------------------------------------------------------------------------
var PD_STAGE_DEFS = [
  { key: 'fu1_fs',    label: '1st Follow-up — Floor Supervisor', dateCol: 'S' },
  { key: 'fu1_qc',    label: '1st Follow-up — In-Line QC',       dateCol: 'V' },
  { key: 'fu2_fs',    label: '2nd Follow-up — Floor Supervisor', dateCol: 'T' },
  { key: 'fu2_qc',    label: '2nd Follow-up — In-Line QC',       dateCol: 'W' },
  { key: 'fu3_fs',    label: '3rd Follow-up — Floor Supervisor', dateCol: 'U' },
  { key: 'fu3_qc',    label: '3rd Follow-up — In-Line QC',       dateCol: 'X' },
  { key: 'endline',   label: 'End-Line QC',                      dateCol: 'Y' },
  { key: 'edgepaint', label: 'Edge-Paint',                       dateCol: EDGE_PAINT_DATE_COL },
  { key: 'preaql',    label: 'Pre-AQL',                          dateCol: 'Z' },
  { key: 'postaql',   label: 'Post AQL',                         dateCol: 'AB' },
  { key: 'shipment',  label: 'Shipment',                         dateCol: 'AC' }
];

// ---------------------------------------------------------------------------
// doGet — ?action=getPlannedDateReport&date=YYYY-MM-DD
// ---------------------------------------------------------------------------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getPlannedDateReport') {
    var date = ((e.parameter && e.parameter.date) || '').trim();
    return plannedDateJsonOutput_(getPlannedDateReport_(date));
  }

  return plannedDateJsonOutput_({ success: true, message: 'Planned Date endpoint is running.' });
}

// ---------------------------------------------------------------------------
// Core logic: build the report for a single Planned Date.
// Returns:
//   {
//     success: true,
//     date: 'YYYY-MM-DD',
//     stages: [
//       { key, label, count, records: [ {unit, batchNo, adData, brand, sku,
//         style, colour, quantity, etd, floorSupervisorName, inlineQcName} ] }
//       , ...
//     ]
//   }
// Stages with zero matching records are still returned (count: 0, records: [])
// so the client can decide how to display them; the PDF builder skips any
// stage with count 0.
// ---------------------------------------------------------------------------
function getPlannedDateReport_(dateStr) {
  try {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { success: false, error: 'A valid Planned Date (YYYY-MM-DD) is required.' };
    }

    var ss = SpreadsheetApp.openById(PLANNED_DATE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PLANNED_DATE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Sheet "' + PLANNED_DATE_SHEET_NAME + '" was not found.' };

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) return { success: true, date: dateStr, stages: buildEmptyStages_() };

    // Keep both raw and displayed values: dates must be matched as Date
    // objects, while the AD field must retain exactly the text visible in
    // the spreadsheet (including formula results such as "MANY ITEMS DUE").
    var reportRange = sheet.getRange(1, 1, lastRow, lastCol);
    var values = reportRange.getValues();
    var displayValues = reportRange.getDisplayValues();
    var tz = ss.getSpreadsheetTimeZone();

    var batchColIdx = colLetterToIndex_(PD_FIELD_COLS.batchNo);
    var unitColIdx  = colLetterToIndex_(PD_FIELD_COLS.unit);
    var adColIdx    = colLetterToIndex_(PD_FIELD_COLS.adData);
    var adColumnLabel = String((displayValues[0] && displayValues[0][adColIdx]) || '').trim() || 'AD';

    var stagesOut = PD_STAGE_DEFS.map(function (stage) {
      var records = [];

      // Stage has no usable date column configured (e.g. Edge-Paint before
      // its column exists) — return it with count 0 instead of erroring.
      if (stage.dateCol) {
        var stageColIdx = colLetterToIndex_(stage.dateCol);
        for (var r = 1; r < values.length; r++) {
          var row = values[r];
          if (!row[batchColIdx]) continue; // skip blank rows
          if (!cellMatchesDate_(row[stageColIdx], dateStr, tz)) continue;
          if (isExcludedUnit_(row[unitColIdx])) continue; // e.g. "14-B", "114"

          records.push({
            unit:                 row[colLetterToIndex_(PD_FIELD_COLS.unit)] || '',
            batchNo:              row[colLetterToIndex_(PD_FIELD_COLS.batchNo)] || '',
            adData:               (displayValues[r] && displayValues[r][adColIdx]) || '',
            fabricatorName:       row[colLetterToIndex_(PD_FIELD_COLS.fabricatorName)] || '',
            brand:                row[colLetterToIndex_(PD_FIELD_COLS.brand)] || '',
            sku:                  row[colLetterToIndex_(PD_FIELD_COLS.sku)] || '',
            style:                row[colLetterToIndex_(PD_FIELD_COLS.style)] || '',
            colour:               row[colLetterToIndex_(PD_FIELD_COLS.colour)] || '',
            quantity:             row[colLetterToIndex_(PD_FIELD_COLS.quantity)] || '',
            etd:                  formatCellForDisplay_(row[colLetterToIndex_(PD_FIELD_COLS.etd)], tz),
            floorSupervisorName:  row[colLetterToIndex_(PD_FIELD_COLS.floorSupervisorName)] || '',
            inlineQcName:         row[colLetterToIndex_(PD_FIELD_COLS.inlineQcName)] || ''
          });
        }
      }

      records.sort(compareForStage_(stage.key));

      return { key: stage.key, label: stage.label, count: records.length, records: records };
    });

    return { success: true, date: dateStr, adColumnLabel: adColumnLabel, stages: stagesOut };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function buildEmptyStages_() {
  return PD_STAGE_DEFS.map(function (stage) {
    return { key: stage.key, label: stage.label, count: 0, records: [] };
  });
}

// True if the given cell value is a Date that falls on dateStr (YYYY-MM-DD),
// compared in the spreadsheet's own timezone.
function cellMatchesDate_(value, dateStr, tz) {
  if (Object.prototype.toString.call(value) !== '[object Date]' || isNaN(value)) return false;
  return Utilities.formatDate(value, tz, 'yyyy-MM-dd') === dateStr;
}

// Formats a date cell as dd/MM/yyyy for display in the report/PDF; passes
// through non-date values (e.g. already-text ETDs) unchanged.
function formatCellForDisplay_(value, tz) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, tz, 'dd/MM/yyyy');
  }
  return value || '';
}

// Sorts records by their "Unit" field (e.g. "14-B", "P-32", "S-18", "S-37")
// using a natural/numeric-aware comparison, so "S-9" sorts before "S-18"
// rather than after it (which a plain string sort would get wrong). Used to
// order records Unit-wise before they're returned to the client, so both
// the on-screen table and the "Download PDF" export are sorted consistently.
function compareByUnit_(a, b) {
  return naturalCompare_(String(a && a.unit || ''), String(b && b.unit || ''));
}

// Picks the right comparator for a given stage:
//   - "…_fs"  (Floor Supervisor stages)  -> sort A-Z by floorSupervisorName
//   - "…_qc"  (In-Line QC stages)        -> sort A-Z by inlineQcName
//   - everything else (End-Line QC, Edge-Paint, Pre-AQL, Post AQL, Shipment)
//     -> keep the original Unit-wise natural sort
function compareForStage_(stageKey) {
  if (/_fs$/.test(stageKey)) return compareByField_('floorSupervisorName');
  if (/_qc$/.test(stageKey)) return compareByField_('inlineQcName');
  return compareByUnit_;
}

// Case-insensitive A-Z comparator for a given record field (e.g. Floor
// Supervisor Name / In-Line QC Name). Blank values sort last.
function compareByField_(field) {
  return function (a, b) {
    var av = String((a && a[field]) || '').trim();
    var bv = String((b && b[field]) || '').trim();
    if (av === '' && bv === '') return 0;
    if (av === '') return 1;
    if (bv === '') return -1;
    return av.toLowerCase().localeCompare(bv.toLowerCase());
  };
}

// Splits each string into alternating runs of digits and non-digits, then
// compares run-by-run — numeric runs are compared as numbers, everything
// else is compared as case-insensitive text.
function naturalCompare_(a, b) {
  var re = /(\d+)|(\D+)/g;
  var aParts = String(a).match(re) || [];
  var bParts = String(b).match(re) || [];
  var len = Math.max(aParts.length, bParts.length);

  for (var i = 0; i < len; i++) {
    var ap = aParts[i], bp = bParts[i];
    if (ap === undefined) return -1;
    if (bp === undefined) return 1;

    var aIsNum = /^\d+$/.test(ap);
    var bIsNum = /^\d+$/.test(bp);

    if (aIsNum && bIsNum) {
      var diff = parseInt(ap, 10) - parseInt(bp, 10);
      if (diff !== 0) return diff;
    } else {
      var cmp = ap.toLowerCase().localeCompare(bp.toLowerCase());
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

// Converts a column letter ('A', 'B', ..., 'Z', 'AA', 'AB', ...) to a 0-based
// column index.
function colLetterToIndex_(letter) {
  var idx = 0;
  var s = String(letter).toUpperCase();
  for (var i = 0; i < s.length; i++) {
    idx = idx * 26 + (s.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function plannedDateJsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
