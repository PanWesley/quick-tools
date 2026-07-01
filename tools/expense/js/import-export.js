/**
 * Expense Tracker - Import / Export Module (Task 6)
 * Provides CSV/JSON export, CSV/Excel import with tag auto-mapping.
 */

// Using global functions from db.js: getExpenses, getTags, addExpense, addTag, exportAllData
const SHEET_JS_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let sheetLibraryPromise = null;

function ensureSheetJSLibraryLoaded() {
  if (typeof XLSX !== 'undefined') {
    return Promise.resolve(true);
  }
  if (typeof document === 'undefined') {
    return Promise.resolve(false);
  }
  if (!sheetLibraryPromise) {
    sheetLibraryPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = SHEET_JS_URL;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        sheetLibraryPromise = null;
        console.warn('[Expense Import] SheetJS failed to load');
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }
  return sheetLibraryPromise;
}

// ============================================
// Export Functions
// ============================================

/**
 * Export expenses to CSV format.
 * @param {Array} expenses - Array of expense objects
 * @returns {string} CSV content
 */
function exportToCSV(expenses) {
  if (!Array.isArray(expenses) || expenses.length === 0) {
    return '';
  }

  const headers = ['日期', '金额', '分类', '标签', '项目名称', '备注'];
  const rows = expenses.map(exp => {
    const date = exp.date || '';
    const amount = exp.amount !== undefined ? exp.amount.toFixed(2) : '0.00';
    const category = exp.category || '';
    const tags = Array.isArray(exp.tags) ? exp.tags.join(' ') : '';
    const itemName = exp.note || '';
    const note = exp.note || '';
    return [date, amount, category, tags, itemName, note];
  });

  // Escape CSV fields
  const escape = (field) => {
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  return '\uFEFF' + csv; // BOM for Excel UTF-8
}

/**
 * Export all data (expenses + tags) to JSON.
 * @returns {Promise<string>} JSON string
 */
async function exportToJSON() {
  const data = await exportAllData();
  return JSON.stringify(data, null, 2);
}

/**
 * Trigger download of a text file.
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export expenses as CSV and trigger download.
 */
async function exportCSVAndDownload() {
  const expenses = await getExpenses();
  const csv = exportToCSV(expenses);
  if (!csv) {
    throw new Error('没有可导出的数据');
  }
  const filename = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadFile(csv, filename, 'text/csv;charset=utf-8');
}

/**
 * Export all data as JSON and trigger download.
 */
async function exportJSONAndDownload() {
  const json = await exportToJSON();
  const filename = `expense-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(json, filename, 'application/json');
}

// ============================================
// Import Parsing
// ============================================

/**
 * Parse a CSV file using FileReader.
 * @param {File} file
 * @returns {Promise<Array<Object>>} Parsed records
 */
function parseCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) {
          resolve([]);
          return;
        }

        // Detect delimiter (comma or tab)
        const firstLine = lines[0];
        const delimiter = firstLine.includes('\t') ? '\t' : ',';

        const headers = parseCSVLine(firstLine, delimiter);
        const records = [];

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i], delimiter);
          if (values.length === 0) continue;
          const record = {};
          headers.forEach((h, idx) => {
            record[h.trim()] = values[idx] !== undefined ? values[idx].trim() : '';
          });
          records.push(record);
        }

        resolve(records);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

/**
 * Parse a single CSV line respecting quotes.
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function parseCSVLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parse an Excel file using SheetJS (xlsx.js).
 * @param {File} file
 * @returns {Promise<Array<Object>>} Parsed records
 */
async function parseExcel(file) {
  const canParseExcel = await ensureSheetJSLibraryLoaded();
  if (!canParseExcel) {
    throw new Error('SheetJS (xlsx.js) failed to load. Please check your network connection.');
  }

  return new Promise((resolve, reject) => {
    if (typeof XLSX === 'undefined') {
      reject(new Error('SheetJS (xlsx.js) 未加载，请检查网络连接'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

        if (json.length === 0) {
          resolve([]);
          return;
        }

        const headers = json[0].map(h => String(h || '').trim());
        const records = [];

        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || row.every(v => v === undefined || v === null || String(v).trim() === '')) continue;
          const record = {};
          headers.forEach((h, idx) => {
            record[h] = row[idx] !== undefined ? String(row[idx]).trim() : '';
          });
          records.push(record);
        }

        resolve(records);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('读取 Excel 文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

// ============================================
// Column Auto-Mapping
// ============================================

const COLUMN_MAP = {
  date: ['date', '日期', 'date', '时间', 'time', '消费日期', '交易日期'],
  amount: ['amount', 'price', '金额', 'price', 'amount', '消费金额', '支出', 'amount', '总价', '合计', 'money', 'cost'],
  itemName: ['item', 'itemname', '项目名称', 'item', '名称', 'name', '项目', '商品', '描述', 'description', '内容', '备注'],
  tags: ['tags', 'forwho', 'category', 'category1', 'category2', 'from', 'payment', '标签', 'for who', 'category-1', 'category-2', 'from', 'payment', '分类', '类别', '支付方式', '来源', '用途', '谁']
};

/**
 * Detect column mapping from headers.
 * @param {Array<Object>} records
 * @returns {Object} { date: 'header', amount: 'header', itemName: 'header', tags: ['header1', ...] }
 */
function detectColumnMapping(records) {
  if (!records || records.length === 0) return {};
  const headers = Object.keys(records[0]);
  const mapping = {};

  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    const matched = headers.find(h => {
      const lower = h.toLowerCase().replace(/[-_\s]/g, '');
      return aliases.some(a => lower === a.toLowerCase().replace(/[-_\s]/g, ''));
    });
    if (matched) {
      if (field === 'tags') {
        mapping.tags = mapping.tags || [];
        mapping.tags.push(matched);
      } else {
        mapping[field] = matched;
      }
    }
  }

  // Also scan for any header that looks like a category/tag column
  headers.forEach(h => {
    const lower = h.toLowerCase();
    if (/分类|类别|标签|tag|category|payment|from|who/.test(lower)) {
      if (!mapping.tags) mapping.tags = [];
      if (!mapping.tags.includes(h)) mapping.tags.push(h);
    }
  });

  return mapping;
}

/**
 * Convert parsed records to expense objects using auto-mapping.
 * @param {Array<Object>} records
 * @returns {Array<Object>} { date, amount, itemName, tags[], raw }
 */
function mapRecordsToExpenses(records) {
  const mapping = detectColumnMapping(records);
  const result = [];

  for (const record of records) {
    const exp = { raw: record };

    // Date
    if (mapping.date && record[mapping.date]) {
      exp.date = normalizeDate(record[mapping.date]);
    }

    // Amount
    if (mapping.amount && record[mapping.amount]) {
      exp.amount = parseAmount(record[mapping.amount]);
    }

    // Item name
    if (mapping.itemName && record[mapping.itemName]) {
      exp.itemName = record[mapping.itemName];
    }

    // Tags (collect from multiple columns)
    const tagValues = [];
    if (mapping.tags) {
      for (const tagCol of mapping.tags) {
        const val = record[tagCol];
        if (val && String(val).trim()) {
          tagValues.push(String(val).trim());
        }
      }
    }
    exp.tagValues = tagValues;

    result.push(exp);
  }

  return result;
}

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  // Try ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [m, d, y] = str.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  // Try Excel serial number
  const num = parseFloat(str);
  if (!isNaN(num) && num > 30000 && num < 50000) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + num * 86400000);
    return d.toISOString().slice(0, 10);
  }
  // Fallback to JS Date parsing
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function parseAmount(amountStr) {
  if (!amountStr) return null;
  const cleaned = String(amountStr).replace(/[,\s¥$]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ============================================
// Import Preview (Full scrollable, all-field edit, per-row delete)
// ============================================

/**
 * Validate a mapped record.
 * @param {Object} record
 * @returns {{ valid: boolean, dateError: boolean, amountError: boolean }}
 */
function validateRecord(record) {
  const dateError = !record.date;
  const amountError = record.amount === null || isNaN(record.amount);
  return { valid: !dateError && !amountError, dateError, amountError };
}

/**
 * Escape HTML entities for safe rendering.
 */
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build a single editable row for the import preview.
 * Every field is an input so the user can edit anything.
 */
function buildImportRow(rec, idx, keepStatus) {
  const v = validateRecord(rec);
  const cls = v.valid ? 'import-row-valid' : 'import-row-invalid';
  const statusIcon = keepStatus || (v.valid ? '✅' : '❌');
  const dateVal = rec.date || '';
  const amountVal = rec.amount !== null && !isNaN(rec.amount) ? rec.amount : '';
  const itemVal = rec.itemName || '';
  const tagsVal = (rec.tagValues && rec.tagValues.length > 0) ? rec.tagValues.join(', ') : '';

  // Color the border of invalid fields red
  const dateInputCls = v.dateError ? 'import-edit-input import-edit-invalid' : 'import-edit-input';
  const amountInputCls = v.amountError ? 'import-edit-input import-edit-invalid' : 'import-edit-input';

  return `
    <tr class="${cls}" data-idx="${idx}">
      <td class="import-row-num">${idx + 1}</td>
      <td><input type="text" class="${dateInputCls} import-edit-date" data-idx="${idx}" value="${escHtml(dateVal)}" placeholder="日期"></td>
      <td><input type="number" step="0.01" min="0" class="${amountInputCls} import-edit-amount" data-idx="${idx}" value="${amountVal}" placeholder="金额"></td>
      <td><input type="text" class="import-edit-input import-edit-item" data-idx="${idx}" value="${escHtml(itemVal)}" placeholder="项目名称"></td>
      <td><input type="text" class="import-edit-input import-edit-tags" data-idx="${idx}" value="${escHtml(tagsVal)}" placeholder="标签（逗号分隔）"></td>
      <td class="import-row-status">${statusIcon}</td>
      <td class="import-row-del"><button class="import-del-btn" onclick="deleteImportRow(${idx})" title="删除此行">✕</button></td>
    </tr>`;
}

/**
 * Show full scrollable preview of all imported records.
 * Every field is editable inline. Each row has a delete button.
 * @param {Array<Object>} records - Raw parsed records
 */
function showImportPreview(records) {
  const mapped = mapRecordsToExpenses(records);
  const mapping = detectColumnMapping(records);

  let validCount = 0;
  let invalidCount = 0;
  mapped.forEach(m => {
    if (validateRecord(m).valid) validCount++; else invalidCount++;
  });

  const mappingInfo = Object.entries(mapping)
    .map(([k, v]) => {
      const display = Array.isArray(v) ? v.join(', ') : v;
      return `<span class="import-mapping-tag">${k} → ${display}</span>`;
    })
    .join('');

  const rowsHtml = mapped.map((rec, idx) => buildImportRow(rec, idx)).join('');

  const html = `
    <div class="import-preview-section" id="import-preview-section">
      <div class="import-mapping-info">
        <strong>字段映射：</strong>
        <div class="import-mapping-tags">${mappingInfo || '<span class="import-missing">未检测到可识别字段</span>'}</div>
      </div>
      <div class="import-stats" id="import-stats-bar">
        <span class="import-stat total">总计: ${mapped.length}</span>
        <span class="import-stat valid">✅ 有效: ${validCount}</span>
        <span class="import-stat invalid">⚠️ 无效: ${invalidCount}</span>
      </div>
      <div class="import-table-wrap">
        <table class="import-preview-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th class="col-date">日期</th>
              <th class="col-amount">金额</th>
              <th class="col-item">项目</th>
              <th class="col-tags">标签</th>
              <th class="col-status">状态</th>
              <th class="col-del">删除</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="import-preview-actions">
        <button class="btn-secondary" onclick="revalidateImportPreview()">🔄 重新验证</button>
        <button class="btn-secondary import-del-invalid-btn" onclick="deleteInvalidImportRows()">🗑️ 删除无效行</button>
      </div>
    </div>
  `;

  return { previewHTML: html, mapped, validCount, invalidCount };
}

/**
 * Read ALL inline-edited values from the preview table and update pendingImportRecords.
 */
function collectImportEdits() {
  if (typeof pendingImportRecords === 'undefined' || !pendingImportRecords) return;

  document.querySelectorAll('.import-edit-date').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    if (!isNaN(idx) && pendingImportRecords[idx]) {
      pendingImportRecords[idx].date = inp.value.trim() || null;
    }
  });

  document.querySelectorAll('.import-edit-amount').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    if (!isNaN(idx) && pendingImportRecords[idx]) {
      const val = parseFloat(inp.value);
      pendingImportRecords[idx].amount = isNaN(val) ? null : val;
    }
  });

  document.querySelectorAll('.import-edit-item').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    if (!isNaN(idx) && pendingImportRecords[idx]) {
      pendingImportRecords[idx].itemName = inp.value.trim() || null;
    }
  });

  document.querySelectorAll('.import-edit-tags').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    if (!isNaN(idx) && pendingImportRecords[idx]) {
      const raw = inp.value.trim();
      if (raw) {
        pendingImportRecords[idx].tagValues = raw.split(/[,，]/).map(t => t.trim()).filter(Boolean);
      } else {
        pendingImportRecords[idx].tagValues = [];
      }
    }
  });
}

/**
 * Delete a single row from the import preview by its original index.
 */
function deleteImportRow(idx) {
  if (!pendingImportRecords || idx < 0 || idx >= pendingImportRecords.length) return;

  // Remove from data
  pendingImportRecords.splice(idx, 1);

  // Rebuild the entire table to keep indices correct
  rebuildImportTable();
}

/**
 * Delete all invalid rows (rows where date or amount is missing).
 */
function deleteInvalidImportRows() {
  if (!pendingImportRecords) return;

  pendingImportRecords = pendingImportRecords.filter(rec => {
    const v = validateRecord(rec);
    return v.valid;
  });

  rebuildImportTable();
}

/**
 * Rebuild the preview table from pendingImportRecords (preserving DOM edits).
 */
function rebuildImportTable() {
  if (!pendingImportRecords) return;
  collectImportEdits(); // save any in-progress edits first

  const tbody = document.querySelector('.import-preview-table tbody');
  if (!tbody) return;

  let validCount = 0;
  let invalidCount = 0;

  const rowsHtml = pendingImportRecords.map((rec, idx) => {
    const v = validateRecord(rec);
    if (v.valid) validCount++; else invalidCount++;
    return buildImportRow(rec, idx);
  }).join('');

  tbody.innerHTML = rowsHtml;

  // Update stats
  const statsBar = document.getElementById('import-stats-bar');
  if (statsBar) {
    statsBar.innerHTML = `
      <span class="import-stat total">总计: ${pendingImportRecords.length}</span>
      <span class="import-stat valid">✅ 有效: ${validCount}</span>
      <span class="import-stat invalid">⚠️ 无效: ${invalidCount}</span>
    `;
  }
}

/**
 * Re-validate the preview table after edits and refresh row statuses.
 */
function revalidateImportPreview() {
  if (!pendingImportRecords) return;
  collectImportEdits();
  rebuildImportTable();
}

// Expose globally for onclick handlers
window.revalidateImportPreview = revalidateImportPreview;
window.deleteImportRow = deleteImportRow;
window.deleteInvalidImportRows = deleteInvalidImportRows;
window.rebuildImportTable = rebuildImportTable;

// ============================================
// Execute Import
// ============================================

/**
 * Import records with tag auto-mapping.
 * Creates missing tags automatically.
 * @param {Array<Object>} mappedRecords - Output from mapRecordsToExpenses
 * @returns {Promise<Object>} { imported: number, createdTags: number, errors: Array }
 */
async function executeImport(mappedRecords) {
  const existingTags = await getTags();
  const tagNameToId = {};
  for (const t of existingTags) {
    tagNameToId[t.name] = t.id;
  }

  let imported = 0;
  let createdTags = 0;
  const errors = [];

  for (const record of mappedRecords) {
    if (!record.date || record.amount === null || isNaN(record.amount)) {
      errors.push({ record, reason: '缺少日期或金额' });
      continue;
    }

    // Resolve tags
    const tagIds = [];
    const tagNames = record.tagValues || [];
    for (const name of tagNames) {
      if (!name) continue;
      let id = tagNameToId[name];
      if (!id) {
        const newTag = await addTag({ name, color: generateTagColor(name), parentId: 'group-category' });
        id = newTag.id;
        tagNameToId[name] = id;
        createdTags++;
      }
      if (!tagIds.includes(id)) {
        tagIds.push(id);
      }
    }

    // Determine category from first tag
    let category = '';
    if (tagIds.length > 0) {
      const firstTag = existingTags.find(t => t.id === tagIds[0]) || { name: tagNames[0] };
      category = firstTag.name;
    }
    if (!category && existingTags.length > 0) {
      category = existingTags[0].name;
    }

    try {
      await addExpense({
        amount: record.amount,
        date: record.date,
        category,
        note: record.itemName || '',
        tags: tagIds
      });
      imported++;
    } catch (err) {
      errors.push({ record, reason: err.message });
    }
  }

  return { imported, createdTags, errors };
}

function generateTagColor(name) {
  const palette = [
    '#e74c3c', '#3498db', '#f39c12', '#9b59b6', '#2ecc71',
    '#e67e22', '#1abc9c', '#95a5a6', '#34495e', '#d35400',
    '#2DBAA3', '#e91e63', '#673ab7', '#ff5722', '#795548'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

// ============================================
// Unified Import Handler
// ============================================

/**
 * Detect file type and parse accordingly.
 * @param {File} file
 * @returns {Promise<Array<Object>>} Parsed records
 */
async function parseImportFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return await parseCSV(file);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return await parseExcel(file);
  } else {
    // Try CSV first, fallback to Excel
    try {
      return await parseCSV(file);
    } catch (e) {
      return await parseExcel(file);
    }
  }
}

window.exportToCSV = exportToCSV;
window.exportToJSON = exportToJSON;
window.exportCSVAndDownload = exportCSVAndDownload;
window.exportJSONAndDownload = exportJSONAndDownload;
window.parseCSV = parseCSV;
window.parseExcel = parseExcel;
window.showImportPreview = showImportPreview;
window.executeImport = executeImport;
window.collectImportEdits = collectImportEdits;
window.parseImportFile = parseImportFile;
