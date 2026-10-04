/**
 * ระบบการจัดการท่าข้าวแม่ดา ส.รุ่งเรือง (GAS)
 * 1) เปิด Google Sheet > Extensions > Apps Script
 * 2) วางไฟล์ Code.gs และ Index.html
 * 3) Run > setupSheet() หนึ่งครั้ง
 * 4) Deploy > New deployment > Web app
 * (ไม่บังคับ) Run > seedDemoData() เพื่อใส่ข้อมูลตัวอย่างย้อนหลัง 6 เดือน ยอดเงินรวม 1,000,000 บาท
 *
 * สิทธิ์การใช้งาน (คอลัมน์ Role ในชีต MM_Users หรือเมนู รายละเอียด > ผู้ใช้งาน)
 * - admin = ผู้บริหาร: เห็นทุกอย่าง สรุป กราฟ งบประมาณ และจัดการผู้ใช้
 * - staff = พนักงาน: กรอกรายรับ/รายจ่าย เห็นเฉพาะรายการของตัวเองทีละวัน แก้/ลบได้เฉพาะที่กรอกวันนี้
 * ทุกคนบันทึกลงสมุดบัญชีกลางเล่มเดียว (MM_BOOK) และทุกรายการเก็บชื่อผู้กรอกไว้ในคอลัมน์ CreatedBy
 */

const MM_TIME_ZONE = 'Asia/Bangkok';
const MM_SESSION_SECONDS = 21600; // 6 hours
const MM_DEFAULT_USER = 'admin';
const MM_DEFAULT_PASS = 'admin1234';

// สมุดบัญชีกลาง: ข้อมูลทั้งหมด (บัญชี หมวดหมู่ งบ ธุรกรรม) เก็บในแถวของ username นี้ ทุกคนใช้เล่มเดียวกัน
const MM_BOOK = MM_DEFAULT_USER;
// ผู้บริหาร = เห็นทุกอย่าง, บทบาทอื่น (staff) = กรอกและดูเฉพาะรายการของตัวเองรายวัน
const MM_MANAGER_ROLES = ['admin', 'manager'];
const MM_STAFF_TYPES = ['income', 'expense'];
// หน้าพนักงานเข้าได้โดยไม่ต้องล็อกอิน: รายการที่กรอกจะบันทึก CreatedBy เป็น username นี้
const MM_GUEST_USER = 'guest';
const MM_RICE_KINDS = ['buy', 'sell', 'merge'];
const MM_RICE_PREFIX = { buy: 'B', sell: 'S', merge: 'M' };

const MM_SHEETS = {
  USERS: 'MM_Users',
  SETTINGS: 'MM_Settings',
  WALLETS: 'MM_Wallets',
  CATEGORIES: 'MM_Categories',
  BUDGETS: 'MM_Budgets',
  BUDGET_CATEGORIES: 'MM_BudgetCategories',
  TRANSACTIONS: 'MM_Transactions',
  RICE: 'MM_Rice',
  AUDIT: 'MM_AuditLog'
};

const MM_HEADERS = {
  [MM_SHEETS.USERS]: [
    'Username', 'Password', 'DisplayName', 'Role', 'Active', 'CreatedAt', 'UpdatedAt'
  ],
  [MM_SHEETS.SETTINGS]: [
    'Username', 'View', 'Month', 'SelectedDate', 'FiltersJson', 'UpdatedAt'
  ],
  [MM_SHEETS.WALLETS]: [
    'Username', 'WalletID', 'Name', 'InitialBalance', 'Color', 'SortOrder', 'UpdatedAt', 'Kind', 'Goal'
  ],
  [MM_SHEETS.CATEGORIES]: [
    'Username', 'CategoryID', 'Type', 'Name', 'Icon', 'Color', 'SortOrder', 'UpdatedAt'
  ],
  [MM_SHEETS.BUDGETS]: [
    'Username', 'BudgetID', 'Name', 'Limit', 'Color', 'UpdatedAt'
  ],
  [MM_SHEETS.BUDGET_CATEGORIES]: [
    'Username', 'BudgetID', 'CategoryID'
  ],
  [MM_SHEETS.TRANSACTIONS]: [
    'Username', 'TransactionID', 'Type', 'Date', 'Amount', 'WalletID', 'TargetWalletID',
    'CategoryID', 'Person', 'DueDate', 'Status', 'Note', 'Tags', 'CreatedAt', 'UpdatedAt', 'CreatedBy', 'LoanID'
  ],
  [MM_SHEETS.RICE]: [
    'Username', 'RiceID', 'Kind', 'Date', 'BillNo', 'RiceType', 'PayKg', 'Total', 'Paid', 'TxID',
    'DataJson', 'CreatedAt', 'UpdatedAt', 'CreatedBy'
  ],
  [MM_SHEETS.AUDIT]: [
    'Timestamp', 'Username', 'Action', 'Detail'
  ]
};

function doGet(e) {
  // GitHub Pages pulls Dashboard data from the sheet: GET .../exec?action=getBackup
  if (e && e.parameter && e.parameter.action === 'getBackup') {
    try {
      ensurePublicSyncAllowed_(e.parameter);
      // Hold the lock for the whole read so we never get a half-written book while another save is in progress
      const lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        ensureSheetStructure_();
        ensureRiceSheet_();
        removeDuplicateRows_();
        return jsonOutput_({ ok: true, backup: buildBackup_(getBookState_(MM_DEFAULT_USER), riceRecords_()) });
      } finally {
        lock.releaseLock();
      }
    } catch (err) {
      return jsonOutput_({ ok: false, message: err && err.message ? err.message : String(err) });
    }
  }
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ระบบการจัดการท่าข้าวแม่ดา ส.รุ่งเรือง')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Save from GitHub Pages: merge with the data in the sheet, do not overwrite the whole thing
 * - knownIds / knownRiceIds = ids this browser has already seen; any item in the sheet it never saw (added by another device/staff) is kept
 * - Sends back the merged data so the browser shows the same thing as the sheet
 */
function doPost(e) {
  try {
    ensurePublicSyncAllowed_(e && e.parameter);
    const action = clean_(e && e.parameter && e.parameter.action, 40);
    if (action !== 'saveBackup') throw new Error('ไม่รองรับ action นี้');
    const payload = parseJson_(e.parameter.payload, null);
    if (!payload) throw new Error('ไม่พบข้อมูลสำหรับบันทึก');
    const imported = unpackBackup_(payload);
    const knownIds = Array.isArray(payload.knownIds) ? payload.knownIds.map(String) : null;
    const knownRiceIds = Array.isArray(payload.knownRiceIds) ? payload.knownRiceIds.map(String) : null;
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      ensureSheetStructure_();
      ensureRiceSheet_();
      ensureDefaultAdmin_();
      saveBookState_(MM_DEFAULT_USER, imported.state, knownIds);
      if (knownRiceIds) replaceRiceRecords_(mergeRiceRecords_(riceRecords_(), imported.riceRecords, knownRiceIds));
      else replaceRiceRecords_(imported.riceRecords);
      logAudit_(MM_DEFAULT_USER, 'publicSync', 'Saved from GitHub Pages: ' + imported.state.transactions.length + ' transactions, ' + imported.riceRecords.length + ' rice records');
      return jsonOutput_({
        ok: true,
        savedAt: Utilities.formatDate(new Date(), MM_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss'),
        backup: buildBackup_(getBookState_(MM_DEFAULT_USER), riceRecords_())
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonOutput_({ ok: false, message: err && err.message ? err.message : String(err) });
  }
}

// Same principle as mergeTransactions_: keep bills others added, drop bills others deleted, use whichever was edited most recently
function mergeRiceRecords_(existing, incoming, knownIds) {
  const known = {};
  knownIds.forEach(function (id) { known[id] = true; });
  const existingById = {};
  existing.forEach(function (record) { existingById[record.id] = record; });
  const incomingIds = {};
  const merged = [];
  incoming.forEach(function (record) {
    incomingIds[record.id] = true;
    const current = existingById[record.id];
    if (!current) {
      if (!known[record.id]) merged.push(record);
      return;
    }
    merged.push(String(current.updatedAt || '') > String(record.updatedAt || '') ? current : record);
  });
  existing.forEach(function (record) {
    if (!incomingIds[record.id] && !known[record.id]) merged.push(record);
  });
  return merged;
}

/**
 * Delete duplicate rows in the sheet (transactions, wallets, categories, budgets, rice bills) — keep one of each
 * Runs automatically when GitHub Pages loads data, or Run > removeDuplicateRows by hand
 */
function removeDuplicateRows() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const message = removeDuplicateRows_();
    Logger.log(message);
    return message;
  } finally {
    lock.releaseLock();
  }
}

// The caller must already hold the lock
function removeDuplicateRows_() {
  const counts = function (sheetName) { return rowsForUser_(sheetName, MM_BOOK).length; };
  const before = {
    tx: counts(MM_SHEETS.TRANSACTIONS), wallets: counts(MM_SHEETS.WALLETS),
    categories: counts(MM_SHEETS.CATEGORIES), budgets: counts(MM_SHEETS.BUDGETS), rice: counts(MM_SHEETS.RICE)
  };
  const state = getBookState_(MM_DEFAULT_USER);
  const rice = riceRecords_();
  const removed = (before.tx - state.transactions.length) + (before.wallets - state.wallets.length) +
    (before.categories - state.categories.length) + (before.budgets - state.budgets.length) + (before.rice - rice.length);
  // getBookState_ drops cat_rice_* items; count only rows that are actually duplicates
  const riceCatRows = rowsForUser_(MM_SHEETS.TRANSACTIONS, MM_BOOK).filter(function (r) { return isRiceCategory_(r[7]); }).length +
    rowsForUser_(MM_SHEETS.CATEGORIES, MM_BOOK).filter(function (r) { return isRiceCategory_(r[1]); }).length;
  if (removed - riceCatRows <= 0) return 'ไม่พบแถวซ้ำ';
  saveBookState_(MM_DEFAULT_USER, state, null);
  replaceRiceRecords_(rice);
  const message = 'ลบแถวซ้ำแล้ว ' + (removed - riceCatRows) + ' แถว';
  logAudit_(MM_DEFAULT_USER, 'removeDuplicateRows', message);
  return message;
}

function ensurePublicSyncAllowed_(params) {
  const expected = PropertiesService.getScriptProperties().getProperty('MM_SYNC_KEY') || '';
  if (expected && String(params && params.key || '') !== expected) throw new Error('รหัส Sync ไม่ถูกต้อง');
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupSheet() {
  ensureSheetStructure_();
  resetAllData_();
  ensureDefaultAdmin_();
  logAudit_(MM_DEFAULT_USER, 'setupSheet', 'Sheets reset with blank app data');
  return 'พร้อมใช้งาน: สร้างชีต/คอลัมน์และล้างข้อมูลเป็นค่าว่างแล้ว เหลือผู้ใช้ admin สำหรับเข้าสู่ระบบ';
}

/**
 * ล้างข้อมูลทั้งหมดในชีต (บัญชี หมวดหมู่ งบ ธุรกรรม การตั้งค่า และ Audit log)
 * เก็บชีต MM_Users ไว้ครบ: ชื่อผู้ใช้ รหัสผ่าน สิทธิ์ ไม่ถูกแตะ
 * รันจาก Apps Script: เลือก clearDataKeepUsers แล้วกด Run (ย้อนกลับไม่ได้)
 */
function clearDataKeepUsers() {
  ensureSheetStructure_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const cleared = [];
  try {
    Object.keys(MM_HEADERS).forEach(function (sheetName) {
      if (sheetName === MM_SHEETS.USERS) return;
      const rows = Math.max(getSheet_(sheetName).getLastRow() - 1, 0);
      clearRows_(sheetName);
      cleared.push(sheetName + ' ' + rows + ' แถว');
    });
    ensureDefaultAdmin_();
    logAudit_(MM_DEFAULT_USER, 'clearDataKeepUsers', 'Cleared: ' + cleared.join(', '));
  } finally {
    lock.releaseLock();
  }
  const message = 'ล้างข้อมูลแล้ว (เก็บผู้ใช้ไว้ ' + listUsers_().length + ' คน): ' + cleared.join(', ');
  Logger.log(message);
  return message;
}

/**
 * ใส่ข้อมูลตัวอย่างย้อนหลังประมาณ 6 เดือน (ยอดเงินตั้งต้นรวม 1,000,000 บาท) ให้ผู้ใช้ที่ระบุ
 * รันจาก Apps Script: เลือก seedDemoData แล้วกด Run (ค่าเริ่มต้นคือผู้ใช้ admin)
 * ข้อมูลเดิมของผู้ใช้นั้นจะถูกแทนที่ทั้งหมด
 */
function seedDemoData(username) {
  ensureSheetStructure_();
  ensureDefaultAdmin_();
  username = (typeof username === 'string' && clean_(username, 80)) || MM_DEFAULT_USER;
  const state = buildDemoState_();
  state.transactions.forEach(function (tx) { tx.createdBy = username; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    saveBookState_(username, state, null);
    logAudit_(username, 'seedDemoData', 'Seeded demo data: ' + state.transactions.length + ' transactions');
  } finally {
    lock.releaseLock();
  }
  return 'ใส่ข้อมูลตัวอย่างลงสมุดบัญชีกลางแล้ว ' + state.transactions.length + ' รายการ (ยอดเงินตั้งต้นรวม 1,000,000 บาท)';
}

function buildDemoState_() {
  let seed = 20260930;
  const rand = function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = function (list) { return list[Math.floor(rand() * list.length)]; };
  const between = function (min, max, unit) { unit = unit || 5; return Math.round((min + rand() * (max - min)) / unit) * unit; };
  const dayKey = function (offset) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return Utilities.formatDate(d, MM_TIME_ZONE, 'yyyy-MM-dd');
  };
  const pad2 = function (n) { return String(n).padStart(2, '0'); };

  const wallets = [
    { id: 'wallet_demo_cash', name: 'เงินสด', kind: 'spending', initialBalance: 20000, goal: 0, color: '#1baf7a' },
    { id: 'wallet_demo_bank', name: 'บัญชีธนาคาร', kind: 'spending', initialBalance: 480000, goal: 0, color: '#2a78d6' },
    { id: 'wallet_demo_save', name: 'เงินเก็บระยะยาว', kind: 'savings', initialBalance: 500000, goal: 1000000, color: '#4a3aa7' }
  ];
  const cash = wallets[0].id, bank = wallets[1].id, save = wallets[2].id;

  const presets = [
    ['expense', 'อาหาร', '🍚', '#ffe3c2'], ['expense', 'กาแฟ/ขนม', '☕', '#f3e2cf'], ['expense', 'เดินทาง', '🚌', '#cfe6ff'],
    ['expense', 'น้ำมัน', '⛽', '#ffd9d0'], ['expense', 'ที่พัก/ค่าเช่า', '🏠', '#e2f0d9'], ['expense', 'น้ำ-ไฟ', '💡', '#fff3b0'],
    ['expense', 'โทรศัพท์/เน็ต', '📱', '#dcd6ff'], ['expense', 'ช้อปปิ้ง', '🛍️', '#ffd6e8'], ['expense', 'สุขภาพ/ยา', '💊', '#d6f5e3'],
    ['expense', 'บันเทิง', '🎬', '#ffe0f0'], ['expense', 'ท่องเที่ยว', '✈️', '#cdeefc'], ['expense', 'อื่น ๆ', '•', '#ececec'],
    ['income', 'เงินเดือน', '💼', '#cdeedd'], ['income', 'โบนัส', '🎉', '#fff0b3'], ['income', 'ค่าล่วงเวลา', '⏰', '#dbeeff'],
    ['income', 'ฟรีแลนซ์/รับจ้าง', '🧑‍💻', '#d9e9ff'], ['income', 'ขายของ', '🛒', '#ffe6cc'], ['income', 'อื่น ๆ', '฿', '#e0f3ea']
  ];
  const categories = [];
  const catId = {};
  const incomeCatId = {};
  presets.forEach(function (p, i) {
    const id = 'cat_demo_' + p[0] + '_' + i;
    if (p[0] === 'income') incomeCatId[p[1]] = id;
    else catId[p[1]] = id;
    categories.push({ id: id, type: p[0], name: p[1], icon: p[2], color: p[3] });
  });

  const transactions = [];
  let counter = 0;
  const add = function (tx) {
    counter += 1;
    transactions.push(Object.assign({
      id: 'tx_demo_' + counter,
      createdAt: tx.date + 'T' + pad2(7 + (counter % 12)) + ':' + pad2(counter % 60) + ':00.000Z',
      updatedAt: '',
      status: 'open',
      tags: [],
      targetWalletId: '',
      categoryId: '',
      person: '',
      dueDate: '',
      note: ''
    }, tx));
  };
  const expense = function (date, name, amount, walletId, note, tags) { add({ type: 'expense', date: date, amount: amount, walletId: walletId, categoryId: catId[name], note: note, tags: tags || [] }); };
  const income = function (date, name, amount, walletId, note) { add({ type: 'income', date: date, amount: amount, walletId: walletId, categoryId: incomeCatId[name], note: note }); };

  const meals = ['ข้าวเช้า', 'ข้าวกลางวัน', 'ข้าวเย็น', 'ก๋วยเตี๋ยว', 'ข้าวมันไก่', 'ส้มตำไก่ย่าง', 'ข้าวผัดกะเพรา', 'สั่งเดลิเวอรี่'];
  const drinks = ['กาแฟเย็น', 'ชานมไข่มุก', 'ขนมปัง', 'น้ำผลไม้'];
  const rides = ['BTS', 'MRT', 'วินมอเตอร์ไซค์', 'แท็กซี่', 'รถเมล์', 'Grab'];
  const shops = ['ของใช้ในบ้าน', 'เสื้อผ้า', 'ของออนไลน์', 'รองเท้า', 'หูฟัง'];
  const fun = ['ดูหนัง', 'คาราโอเกะ', 'เกม', 'คอนเสิร์ต', 'บอร์ดเกม'];

  for (let offset = 179; offset >= 0; offset -= 1) {
    const date = dayKey(offset);
    const parts = date.split('-').map(Number);
    const dow = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
    const day = parts[2];
    const isWeekend = dow === 0 || dow === 6;

    expense(date, 'อาหาร', between(45, 180), cash, pick(meals));
    if (rand() < 0.75) expense(date, 'อาหาร', between(60, 320), rand() < 0.6 ? cash : bank, pick(meals));
    if (rand() < 0.45) expense(date, 'กาแฟ/ขนม', between(45, 130), cash, pick(drinks));
    if (!isWeekend && rand() < 0.8) expense(date, 'เดินทาง', between(30, 180), cash, pick(rides), ['งาน']);
    if (isWeekend && rand() < 0.4) expense(date, 'ช้อปปิ้ง', between(300, 2600, 10), bank, pick(shops));
    if (isWeekend && rand() < 0.35) expense(date, 'บันเทิง', between(200, 900, 10), rand() < 0.5 ? cash : bank, pick(fun), ['ส่วนตัว']);
    if (rand() < 0.08) expense(date, 'สุขภาพ/ยา', between(150, 900, 10), bank, 'ร้านขายยา');

    if (day === 1) expense(date, 'ที่พัก/ค่าเช่า', 8500, bank, 'ค่าเช่าคอนโด', ['ประจำ']);
    if (day === 5) expense(date, 'น้ำ-ไฟ', between(1800, 2900, 10), bank, 'ค่าน้ำค่าไฟ', ['ประจำ']);
    if (day === 10) expense(date, 'โทรศัพท์/เน็ต', 599, bank, 'ค่ามือถือ + เน็ตบ้าน', ['ประจำ']);
    if (day === 15) expense(date, 'น้ำมัน', between(1000, 1600, 10), bank, 'เติมน้ำมันเต็มถัง');
    if (day === 25) income(date, 'เงินเดือน', 45000, bank, 'เงินเดือนประจำเดือน');
    if (day === 25) add({ type: 'transfer', date: date, amount: 10000, walletId: bank, targetWalletId: save, note: 'เก็บเงินประจำเดือน', tags: ['ออม'] });
    if (day === 18 && rand() < 0.6) income(date, 'ฟรีแลนซ์/รับจ้าง', between(3000, 12000, 100), bank, pick(['งานออกแบบ', 'งานแปลเอกสาร', 'งานถ่ายรูป', 'งานเขียนเว็บ']));
    if (day === 12 && rand() < 0.5) income(date, 'ขายของ', between(500, 3500, 50), cash, 'ขายของออนไลน์');
    if (day === 28 && rand() < 0.5) income(date, 'ค่าล่วงเวลา', between(1500, 4000, 100), bank, 'OT');
    if (day === 3) add({ type: 'transfer', date: date, amount: between(3000, 6000, 500), walletId: bank, targetWalletId: cash, note: 'ถอนเงินสด' });
  }

  // รายการพิเศษกระจายในช่วง 6 เดือน
  income(dayKey(150), 'โบนัส', 60000, bank, 'โบนัสกลางปี');
  income(dayKey(95), 'อื่น ๆ', 3000, cash, 'เงินขวัญถุงจากญาติ');
  expense(dayKey(140), 'ท่องเที่ยว', 12500, bank, 'เที่ยวเชียงใหม่ 3 วัน', ['เที่ยว']);
  expense(dayKey(110), 'สุขภาพ/ยา', 3200, bank, 'ตรวจสุขภาพประจำปี');
  expense(dayKey(80), 'ช้อปปิ้ง', 18900, bank, 'ซื้อมือถือใหม่', ['ส่วนตัว']);
  expense(dayKey(60), 'ท่องเที่ยว', 6800, bank, 'ทะเลระยอง', ['เที่ยว']);
  add({ type: 'borrow', date: dayKey(120), amount: 10000, walletId: bank, person: 'คุณแม่', dueDate: dayKey(60), note: 'ยืมค่าซ่อมรถ', status: 'paid', updatedAt: dayKey(62) + 'T10:00:00.000Z' });
  add({ type: 'lend', date: dayKey(75), amount: 5000, walletId: bank, person: 'เพื่อนดี', dueDate: dayKey(10), note: 'ให้ยืมค่าเช่าห้อง' });
  add({ type: 'borrow', date: dayKey(40), amount: 3000, walletId: cash, person: 'พี่อี', dueDate: dayKey(-15), note: 'ยืมค่าของขวัญ' });

  income(dayKey(21), 'ฟรีแลนซ์/รับจ้าง', 8000, bank, 'งานออกแบบโลโก้');
  income(dayKey(12), 'ขายของ', 1500, cash, 'ขายของมือสอง');
  income(dayKey(6), 'ค่าล่วงเวลา', 2400, bank, 'OT สัปดาห์ที่ผ่านมา');
  expense(dayKey(16), 'ท่องเที่ยว', 4200, bank, 'ที่พักหัวหิน 2 คืน', ['เที่ยว']);
  expense(dayKey(9), 'อื่น ๆ', 350, cash, 'ค่าธรรมเนียมเอกสาร');
  add({ type: 'transfer', date: dayKey(28), amount: 5000, walletId: bank, targetWalletId: cash, note: 'ถอนเงินสด' });
  add({ type: 'transfer', date: dayKey(3), amount: 3000, walletId: bank, targetWalletId: cash, note: 'ถอนเงินสด' });
  add({ type: 'borrow', date: dayKey(8), amount: 2000, walletId: cash, person: 'พี่เอ', dueDate: dayKey(-6), note: 'ยืมไปจ่ายค่ามัดจำ' });
  add({ type: 'lend', date: dayKey(18), amount: 1500, walletId: cash, person: 'น้องบี', dueDate: dayKey(2), note: 'ให้ยืมค่าเทอม' });
  add({ type: 'lend', date: dayKey(30), amount: 800, walletId: cash, person: 'เพื่อนซี', dueDate: dayKey(20), note: 'ค่าอาหารมื้อรวม', status: 'paid', updatedAt: dayKey(19) + 'T10:00:00.000Z' });

  const budgets = [
    { id: 'budget_demo_food', name: 'ค่าอาหาร', limit: 9000, color: '#eb6834', categoryIds: [catId['อาหาร'], catId['กาแฟ/ขนม']] },
    { id: 'budget_demo_travel', name: 'ค่าเดินทาง', limit: 3000, color: '#2a78d6', categoryIds: [catId['เดินทาง'], catId['น้ำมัน']] },
    { id: 'budget_demo_fun', name: 'ช้อปปิ้งและบันเทิง', limit: 6000, color: '#e87ba4', categoryIds: [catId['ช้อปปิ้ง'], catId['บันเทิง']] },
    { id: 'budget_demo_fixed', name: 'ค่าใช้จ่ายประจำ', limit: 12000, color: '#4a3aa7', categoryIds: [catId['ที่พัก/ค่าเช่า'], catId['น้ำ-ไฟ'], catId['โทรศัพท์/เน็ต']] }
  ];

  return {
    version: 1,
    ui: { view: 'home', month: currentMonth_(), selectedDate: today_(), filters: { search: '', type: 'all', wallet: 'all', category: 'all' } },
    wallets: dedupeById_(wallets),
    categories: dedupeById_(categories),
    budgets: dedupeById_(budgets),
    transactions: dedupeTransactions_(transactions)
  };
}

function ensureSheetStructure_() {
  const ss = getSpreadsheet_();
  Object.keys(MM_HEADERS).forEach(function (name) {
    const sh = getOrCreateSheet_(ss, name);
    const headers = MM_HEADERS[name];
    // Headers already correct: skip the formatting/column resizing (slow; runs on every save)
    const current = sh.getLastColumn() >= headers.length ? sh.getRange(1, 1, 1, headers.length).getValues()[0] : [];
    if (current.join('\u0001') !== headers.join('\u0001')) setupHeader_(sh, headers);
  });
  // เก็บวันที่/เวลาเป็นข้อความล้วน กันชีตแปลงเป็นวันที่เองตาม locale/เขตเวลา (เช่น ปี พ.ศ. หรือวันเลื่อน) จนข้อมูลไม่ขึ้นในเดือนที่เลือก
  const tx = ss.getSheetByName(MM_SHEETS.TRANSACTIONS);
  ['D:D', 'J:J', 'N:P'].forEach(function (a1) { tx.getRange(a1).setNumberFormat('@'); });
  ss.getSheetByName(MM_SHEETS.SETTINGS).getRange('C:D').setNumberFormat('@');
  ss.getSheetByName(MM_SHEETS.RICE).getRange('D:D').setNumberFormat('@');
  ss.getSheetByName(MM_SHEETS.RICE).getRange('L:M').setNumberFormat('@');
}

/**
 * ตรวจว่าทำไม Dashboard ไม่แสดงข้อมูล: Run > debugDashboard แล้วดูผลใน Execution log
 */
function debugDashboard() {
  const ss = getSpreadsheet_();
  const lines = [];
  lines.push('Spreadsheet locale: ' + ss.getSpreadsheetLocale() + ' | timezone: ' + ss.getSpreadsheetTimeZone() + ' | script today: ' + today_());
  lines.push('สมุดบัญชีกลาง (MM_BOOK) = "' + MM_BOOK + '"');

  [MM_SHEETS.WALLETS, MM_SHEETS.CATEGORIES, MM_SHEETS.TRANSACTIONS, MM_SHEETS.SETTINGS].forEach(function (name) {
    const values = getSheet_(name).getDataRange().getValues().slice(1);
    const byUser = {};
    values.forEach(function (r) { const k = String(r[0]); byUser[k] = (byUser[k] || 0) + 1; });
    lines.push(name + ': ' + values.length + ' แถว | แยกตาม Username: ' + JSON.stringify(byUser));
  });

  const rows = rowsForUser_(MM_SHEETS.TRANSACTIONS, MM_BOOK);
  rows.slice(0, 3).forEach(function (r, i) {
    lines.push('ตัวอย่างแถว ' + (i + 1) + ': Date ดิบ = ' + JSON.stringify(String(r[3])) + ' (' + Object.prototype.toString.call(r[3]) + ') → อ่านได้เป็น ' + sheetDate_(r[3]));
  });
  const dates = rows.map(function (r) { return sheetDate_(r[3]); }).filter(Boolean).sort();
  const month = currentMonth_();
  lines.push('ช่วงวันที่ของธุรกรรม: ' + (dates.length ? dates[0] + ' ถึง ' + dates[dates.length - 1] : 'ไม่มี'));
  lines.push('ธุรกรรมในเดือนนี้ (' + month + '): ' + dates.filter(function (d) { return d.indexOf(month) === 0; }).length + ' รายการ');

  const users = listUsers_().map(function (u) { return u.username + '(' + u.role + (u.active ? '' : ',ปิด') + ')'; });
  lines.push('ผู้ใช้: ' + users.join(', '));

  let payloadInfo;
  try {
    const state = getBookState_(MM_DEFAULT_USER);
    payloadInfo = 'getBookState_ ส่งได้ ' + state.transactions.length + ' ธุรกรรม, ขนาด ~' + Math.round(JSON.stringify(state).length / 1024) + ' KB, เดือนที่ตั้งไว้ = ' + state.ui.month;
  } catch (err) {
    payloadInfo = 'getBookState_ ผิดพลาด: ' + err.message;
  }
  lines.push(payloadInfo);

  const report = lines.join('\n');
  Logger.log(report);
  return report;
}

function login(username, password) {
  ensureSheetStructure_();
  ensureDefaultAdmin_();
  username = clean_(username, 80);
  password = String(password || '');
  if (!username || !password) return { ok: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };

  const user = findUser_(username);
  if (!user || !user.active) {
    Utilities.sleep(500);
    return { ok: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }

  if (password !== user.password) {
    Utilities.sleep(500);
    return { ok: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }

  const token = Utilities.getUuid();
  const session = {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: new Date().toISOString()
  };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(session), MM_SESSION_SECONDS);
  logAudit_(user.username, 'login', 'Login success');

  const result = {
    ok: true,
    token: token,
    user: publicUser_(user)
  };
  if (isManager_(user)) result.state = getBookState_(user.username);
  else result.staff = getStaffDay_(user, today_());
  return result;
}

/* ---------- ผู้บริหาร: เห็นและแก้ไขได้ทุกอย่าง ---------- */

function apiGetState(token) {
  const user = requireManager_(token);
  return {
    ok: true,
    user: publicUser_(user),
    state: getBookState_(user.username)
  };
}

/**
 * บันทึกทั้งสมุดบัญชี (เฉพาะผู้บริหาร)
 * knownIds = รหัสธุรกรรมที่ฝั่งผู้บริหารเคยโหลด/บันทึกแล้ว ใช้รวมกับรายการที่พนักงานเพิ่ม/แก้/ลบระหว่างนั้น
 * เพื่อไม่ให้การบันทึกของผู้บริหารเขียนทับงานของพนักงาน
 */
function apiSaveState(token, state, knownIds) {
  const user = requireManager_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const merge = saveBookState_(user.username, state || {}, Array.isArray(knownIds) ? knownIds : null);
    logAudit_(user.username, 'saveState', 'Saved app state');
    return {
      ok: true,
      savedAt: Utilities.formatDate(new Date(), MM_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss'),
      added: merge.added,
      removedIds: merge.removedIds
    };
  } finally {
    lock.releaseLock();
  }
}

function apiExportBackup(token) {
  const user = requireManager_(token);
  ensureSheetStructure_();
  ensureRiceSheet_();
  return {
    ok: true,
    backup: buildBackup_(getBookState_(user.username), riceRecords_())
  };
}

function apiImportBackup(token, backup) {
  const user = requireManager_(token);
  const payload = unpackBackup_(backup);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureSheetStructure_();
    ensureRiceSheet_();
    saveBookState_(user.username, payload.state, null);
    replaceRiceRecords_(payload.riceRecords);
    logAudit_(user.username, 'importBackup', 'Imported ' + payload.state.transactions.length + ' transactions, ' + payload.riceRecords.length + ' rice records');
    return {
      ok: true,
      state: getBookState_(user.username),
      rice: riceSnapshot_(user),
      counts: {
        transactions: payload.state.transactions.length,
        riceRecords: payload.riceRecords.length
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function buildBackup_(state, riceRecords) {
  return {
    app: 'MoneyBook',
    version: 2,
    exportedAt: new Date().toISOString(),
    state: state || createDefaultState_(),
    riceRecords: (riceRecords || []).map(stripRiceRecord_)
  };
}

function unpackBackup_(backup) {
  if (!backup || typeof backup !== 'object') throw new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง');
  const state = backup.state && typeof backup.state === 'object' ? backup.state : backup;
  if (!Array.isArray(state.wallets) || !Array.isArray(state.transactions)) {
    throw new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง');
  }
  const riceSource = Array.isArray(backup.riceRecords)
    ? backup.riceRecords
    : (backup.rice && Array.isArray(backup.rice.records) ? backup.rice.records : []);
  return {
    state: state,
    riceRecords: normalizeImportedRiceRecords_(riceSource)
  };
}

function stripRiceRecord_(record) {
  const copy = Object.assign({}, record || {});
  delete copy.canEdit;
  return copy;
}

function normalizeImportedRiceRecords_(records) {
  const used = {};
  return (Array.isArray(records) ? records : []).map(function (input, index) {
    if (!input || typeof input !== 'object') return null;
    const kind = String(input.kind || '');
    if (MM_RICE_KINDS.indexOf(kind) < 0) throw new Error('ข้อมูลซื้อ-ขายข้าวรายการที่ ' + (index + 1) + ' มีประเภทบิลไม่ถูกต้อง');
    const date = isDateKey_(input.date) ? String(input.date) : today_();
    const id = clean_(input.id, 120) || ('rice_import_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16));
    // Same bill (same id, or same bill no. + creation time) = duplicate row: keep only one
    const signature = kind + '|' + clean_(input.billNo, 80) + '|' + clean_(input.createdAt, 40);
    if (used[id] || (input.billNo && input.createdAt && used[signature])) return null;
    used[id] = true;
    used[signature] = true;
    const payKg = Math.round(number_(input.payKg));
    const pricePerKg = number_(input.pricePerKg) || (number_(input.pricePerTon) ? number_(input.pricePerTon) / 1000 : 0);
    const total = number_(input.total) || Math.round(payKg * pricePerKg * 100) / 100;
    const paid = kind === 'sell' && (input.paid === true || String(input.paid).toLowerCase() === 'true');
    const record = Object.assign({}, input, {
      id: id,
      kind: kind,
      date: date,
      billNo: clean_(input.billNo, 80) || (MM_RICE_PREFIX[kind] + String(index + 1).padStart(3, '0')),
      riceType: clean_(input.riceType, 80),
      party: kind === 'sell' ? clean_(input.party, 120) : '',
      phone: '',
      plate: '',
      payKg: payKg,
      grossKg: payKg,
      tareKg: 0,
      netKg: payKg,
      moisture: 0,
      moistureStd: 0,
      moistureKg: 0,
      impurity: 0,
      impurityKg: 0,
      pricePerKg: pricePerKg,
      pricePerTon: pricePerKg * 1000,
      subtotal: total,
      otherDeduct: 0,
      otherNote: '',
      total: total,
      paid: paid,
      paidDate: paid && isDateKey_(input.paidDate) ? String(input.paidDate) : '',
      walletId: '',
      txId: '',
      note: kind === 'buy' ? '' : clean_(input.note, 500),
      createdAt: clean_(input.createdAt, 40) || new Date().toISOString(),
      updatedAt: clean_(input.updatedAt, 40),
      createdBy: clean_(input.createdBy, 80) || userOrDefault_(input.createdBy)
    });
    if (Array.isArray(record.sources)) {
      record.sources = record.sources.map(function (source) {
        return { riceType: clean_(source && source.riceType, 80), kg: Math.round(number_(source && source.kg)) };
      }).filter(function (source) { return source.riceType && source.kg > 0; });
    }
    if (kind === 'merge') {
      // Merge bill: source weight = sum of the piles brought in (not the weight after loss)
      const sourceKg = (record.sources || []).reduce(function (sum, source) { return sum + source.kg; }, 0);
      record.netKg = sourceKg || payKg;
      record.grossKg = record.netKg;
      record.lossKg = Math.max(0, Math.round(number_(input.lossKg)));
    }
    delete record.canEdit;
    return record;
  }).filter(Boolean);
}

function userOrDefault_(username) {
  return clean_(username, 80) || MM_DEFAULT_USER;
}

function replaceRiceRecords_(records) {
  ensureRiceSheet_();
  deleteRowsByUser_(MM_SHEETS.RICE, MM_BOOK);
  appendRows_(MM_SHEETS.RICE, normalizeImportedRiceRecords_(records).map(riceRow_));
}

/* ---------- พนักงาน: กรอกรายรับรายจ่าย และดูเฉพาะรายการของตัวเองรายวัน ---------- */

function apiStaffGetDay(token, date) {
  const user = requireStaff_(token);
  return getStaffDay_(user, isDateKey_(date) ? date : today_());
}

function apiStaffSaveTransaction(token, input) {
  const user = requireStaff_(token);
  input = input || {};
  const type = String(input.type || '');
  const amount = number_(input.amount);
  const date = String(input.date || '');
  if (MM_STAFF_TYPES.indexOf(type) < 0) throw new Error('บันทึกได้เฉพาะรายรับหรือรายจ่าย');
  if (!(amount > 0)) throw new Error('กรุณาระบุจำนวนเงินมากกว่า 0');
  if (!isDateKey_(date)) throw new Error('วันที่ไม่ถูกต้อง');
  const walletId = clean_(input.walletId, 120);
  const categoryId = clean_(input.categoryId, 120);
  if (isRiceCategory_(categoryId)) throw new Error('บันทึกซื้อ-ขายข้าวได้ที่หน้าซื้อ-ขายข้าวเท่านั้น');
  if (!rowsForUser_(MM_SHEETS.WALLETS, MM_BOOK).some(function (r) { return String(r[1]) === walletId; })) {
    throw new Error('ไม่พบบัญชีที่เลือก');
  }
  if (!rowsForUser_(MM_SHEETS.CATEGORIES, MM_BOOK).some(function (r) { return String(r[1]) === categoryId && String(r[2]) === type; })) {
    throw new Error('ไม่พบหมวดหมู่ที่เลือก');
  }

  const now = new Date().toISOString();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_(MM_SHEETS.TRANSACTIONS);
    const id = clean_(input.id, 120);
    if (id) {
      const found = findBookTransactionRow_(sh, id);
      if (!found) throw new Error('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
      assertStaffCanEdit_(user, found.tx);
      assertNotRiceTx_(found.tx);
      const tx = Object.assign(found.tx, {
        type: type, date: date, amount: amount, walletId: walletId, categoryId: categoryId,
        note: clean_(input.note, 500), updatedAt: now
      });
      sh.getRange(found.row, 1, 1, MM_HEADERS[MM_SHEETS.TRANSACTIONS].length).setValues([transactionRow_(MM_BOOK, tx)]);
      logAudit_(user.username, 'staffUpdateTransaction', id);
    } else {
      const tx = {
        id: 'tx_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16),
        type: type, date: date, amount: amount, walletId: walletId, targetWalletId: '', categoryId: categoryId,
        person: '', dueDate: '', status: 'open', note: clean_(input.note, 500), tags: [],
        createdAt: now, updatedAt: '', createdBy: user.username
      };
      appendRows_(MM_SHEETS.TRANSACTIONS, [transactionRow_(MM_BOOK, tx)]);
      logAudit_(user.username, 'staffAddTransaction', tx.id);
    }
  } finally {
    lock.releaseLock();
  }
  return getStaffDay_(user, date);
}

function apiStaffDeleteTransaction(token, id, viewDate) {
  const user = requireStaff_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_(MM_SHEETS.TRANSACTIONS);
    const found = findBookTransactionRow_(sh, clean_(id, 120));
    if (!found) throw new Error('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
    assertStaffCanEdit_(user, found.tx);
    assertNotRiceTx_(found.tx);
    sh.deleteRow(found.row);
    logAudit_(user.username, 'staffDeleteTransaction', String(id));
  } finally {
    lock.releaseLock();
  }
  return getStaffDay_(user, isDateKey_(viewDate) ? viewDate : today_());
}

function getStaffDay_(user, date) {
  const wallets = rowsForUser_(MM_SHEETS.WALLETS, MM_BOOK).map(function (r) {
    return { id: String(r[1]), name: String(r[2]) };
  });
  const categories = rowsForUser_(MM_SHEETS.CATEGORIES, MM_BOOK)
    .filter(function (r) { return MM_STAFF_TYPES.indexOf(String(r[2])) >= 0 && !isRiceCategory_(r[1]); })
    .map(function (r) {
      return { id: String(r[1]), type: String(r[2]), name: String(r[3]), icon: String(r[4] || '•'), color: String(r[5] || '#79d7c4') };
    });
  const transactions = rowsForUser_(MM_SHEETS.TRANSACTIONS, MM_BOOK)
    .map(transactionFromRow_)
    .filter(function (tx) {
      return tx.date === date && tx.createdBy.toLowerCase() === user.username.toLowerCase() && MM_STAFF_TYPES.indexOf(tx.type) >= 0 && !isRiceCategory_(tx.categoryId);
    })
    .map(function (tx) {
      return {
        id: tx.id, type: tx.type, date: tx.date, amount: tx.amount, walletId: tx.walletId, categoryId: tx.categoryId,
        note: tx.note, createdAt: tx.createdAt, updatedAt: tx.updatedAt, canEdit: staffCanEdit_(user, tx)
      };
    });
  return { ok: true, date: date, today: today_(), wallets: wallets, categories: categories, transactions: transactions };
}

// พนักงานแก้ไข/ลบได้เฉพาะรายการที่ตัวเองกรอก และต้องเป็นรายการที่กรอกในวันนี้เท่านั้น
function staffCanEdit_(user, tx) {
  if (String(tx.createdBy).toLowerCase() !== String(user.username).toLowerCase()) return false;
  if (MM_STAFF_TYPES.indexOf(tx.type) < 0) return false;
  const created = new Date(tx.createdAt);
  if (isNaN(created.getTime())) return false;
  return Utilities.formatDate(created, MM_TIME_ZONE, 'yyyy-MM-dd') === today_();
}

function assertStaffCanEdit_(user, tx) {
  if (isManager_(user)) return;
  if (!staffCanEdit_(user, tx)) throw new Error('แก้ไข/ลบได้เฉพาะรายการของตัวเองที่กรอกในวันนี้เท่านั้น');
}

function findBookTransactionRow_(sh, id) {
  const values = sh.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]) === MM_BOOK && String(values[r][1]) === String(id)) {
      return { row: r + 1, tx: transactionFromRow_(values[r]) };
    }
  }
  return null;
}

/* ---------- ซื้อ-ขายข้าว: บันทึกสต็อกแยกจากบัญชีรายรับรายจ่าย ----------
 * - รับซื้อ: เก็บชนิดข้าว น้ำหนักรวม และราคาซื้อบาท/กก.
 * - ขายออก: เก็บผู้ซื้อ น้ำหนักรวม ราคาขายบาท/กก. ราคาสุทธิ สถานะจ่าย และวันที่จ่าย
 * - ข้อมูลซื้อ-ขายข้าวไม่สร้างธุรกรรมในบัญชีรายรับรายจ่าย
 * - รวมข้าว: ย้ายสต็อกข้าวหลายชนิด/หลายกองมารวมเป็นกองเดียว ไม่กระทบยอดเงิน
 * พนักงาน (รวมที่ไม่ได้ล็อกอิน) เห็นเฉพาะบิลของตัวเอง แก้/ลบได้เฉพาะที่บันทึกวันนี้ ผู้บริหารเห็นและแก้ได้ทุกบิล
 */

function apiRiceGet(token) {
  const user = requireStaff_(token);
  return riceSnapshot_(user);
}

function apiRiceSave(token, input) {
  const user = requireStaff_(token);
  input = input || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let removedTxId = '';
  let record;
  try {
    const sh = ensureRiceSheet_();
    const id = clean_(input.id, 120);
    const found = id ? findRiceRow_(sh, id) : null;
    if (id && !found) throw new Error('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
    if (found && !riceCanEdit_(user, found.record)) throw new Error('แก้ไขได้เฉพาะบิลของตัวเองที่บันทึกในวันนี้เท่านั้น');
    if (found && found.record.kind !== String(input.kind)) throw new Error('เปลี่ยนประเภทบิลไม่ได้ กรุณาลบแล้วบันทึกใหม่');

    record = riceCompute_(input);
    const now = new Date().toISOString();
    record.id = found ? found.record.id : 'rice_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    record.billNo = found ? found.record.billNo : nextRiceBillNo_(riceRecords_(), record.kind, record.date);
    removedTxId = found && found.record.txId ? removeRiceTransaction_(found.record.txId) : '';
    record.txId = '';
    record.createdAt = found ? found.record.createdAt : now;
    record.createdBy = found ? found.record.createdBy : user.username;
    record.updatedAt = found ? now : '';

    if (found) sh.getRange(found.row, 1, 1, MM_HEADERS[MM_SHEETS.RICE].length).setValues([riceRow_(record)]);
    else appendRows_(MM_SHEETS.RICE, [riceRow_(record)]);
    logAudit_(user.username, found ? 'riceUpdate' : 'riceAdd', record.billNo);
  } finally {
    lock.releaseLock();
  }
  const result = riceSnapshot_(user);
  result.saved = record;
  result.tx = null;
  result.removedTxId = removedTxId;
  return result;
}

function apiRiceDelete(token, id) {
  const user = requireStaff_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let removedTxId = '';
  try {
    const sh = ensureRiceSheet_();
    const found = findRiceRow_(sh, clean_(id, 120));
    if (!found) throw new Error('ไม่พบบิลนี้ อาจถูกลบไปแล้ว');
    if (!riceCanEdit_(user, found.record)) throw new Error('ลบได้เฉพาะบิลของตัวเองที่บันทึกในวันนี้เท่านั้น');
    removedTxId = removeRiceTransaction_(found.record.txId);
    sh.deleteRow(found.row);
    logAudit_(user.username, 'riceDelete', found.record.billNo);
  } finally {
    lock.releaseLock();
  }
  const result = riceSnapshot_(user);
  result.removedTxId = removedTxId;
  return result;
}

function riceSnapshot_(user) {
  ensureRiceSheet_();
  const all = riceRecords_();
  const manager = isManager_(user);
  const records = all
    .filter(function (r) { return manager || String(r.createdBy).toLowerCase() === String(user.username).toLowerCase(); })
    .map(function (r) { r.canEdit = riceCanEdit_(user, r); return r; });
  const types = {};
  const parties = {};
  all.forEach(function (r) {
    if (r.riceType) types[r.riceType] = true;
    (r.sources || []).forEach(function (s) { if (s.riceType) types[s.riceType] = true; });
    if (r.party) parties[r.party] = true;
  });
  return {
    ok: true,
    today: today_(),
    canManage: manager,
    records: records,
    stock: riceStock_(all),
    riceTypes: Object.keys(types).sort(),
    parties: Object.keys(parties).sort()
  };
}

// ตรวจและคำนวณบิล (สูตรเดียวกับ computeRice ใน Index.html)
function riceCompute_(input) {
  const kind = String(input.kind || '');
  if (MM_RICE_KINDS.indexOf(kind) < 0) throw new Error('ประเภทบิลไม่ถูกต้อง');
  const date = String(input.date || '');
  if (!isDateKey_(date)) throw new Error('วันที่ไม่ถูกต้อง');
  const rec = { kind: kind, date: date, note: clean_(input.note, 500), riceType: clean_(input.riceType, 80) };

  if (kind === 'merge') {
    const sources = (Array.isArray(input.sources) ? input.sources : []).map(function (s) {
      return { riceType: clean_(s && s.riceType, 80), kg: Math.round(number_(s && s.kg)) };
    }).filter(function (s) { return s.riceType && s.kg > 0; });
    if (!sources.length) throw new Error('กรุณาระบุข้าวที่จะนำมารวมอย่างน้อย 1 รายการ');
    if (!rec.riceType) throw new Error('กรุณาระบุชื่อกอง/ชนิดข้าวหลังรวม');
    const sum = sources.reduce(function (total, s) { return total + s.kg; }, 0);
    const lossKg = Math.max(0, Math.round(number_(input.lossKg)));
    if (lossKg >= sum) throw new Error('น้ำหนักสูญเสียต้องน้อยกว่าน้ำหนักรวม');
    return Object.assign(rec, {
      sources: sources, lossKg: lossKg, netKg: sum, payKg: sum - lossKg, total: 0,
      paid: false, paidDate: '', walletId: '', party: clean_(input.party, 120)
    });
  }

  rec.party = clean_(input.party, 120);
  if (kind === 'buy') rec.note = '';
  if (kind === 'sell' && !rec.party) throw new Error('กรุณาระบุชื่อผู้ซื้อ');
  if (!rec.riceType) throw new Error('กรุณาระบุชนิดข้าว');
  const legacyGross = number_(input.grossKg);
  const legacyTare = number_(input.tareKg);
  const payKg = Math.max(0, Math.round(number_(input.payKg) || Math.max(0, legacyGross - legacyTare)));
  const pricePerKg = number_(input.pricePerKg) || (number_(input.pricePerTon) ? number_(input.pricePerTon) / 1000 : 0);
  if (!(payKg > 0)) throw new Error('กรุณาระบุน้ำหนักรวมข้าว');
  if (!(pricePerKg > 0)) throw new Error(kind === 'buy' ? 'กรุณาระบุราคาซื้อบาทต่อกก.' : 'กรุณาระบุราคาขายบาทต่อกก.');
  const pricePerTon = pricePerKg * 1000;
  const subtotal = Math.round(payKg * pricePerKg * 100) / 100;
  const paid = kind === 'sell' && (input.paid === true || input.paid === 'true');
  const paidDate = paid ? (isDateKey_(input.paidDate) ? String(input.paidDate) : date) : '';
  return Object.assign(rec, {
    phone: '', plate: '',
    grossKg: payKg, tareKg: 0, netKg: payKg, moisture: 0, moistureStd: 0,
    moistureKg: 0, impurity: 0, impurityKg: 0, payKg: payKg,
    pricePerKg: pricePerKg, pricePerTon: pricePerTon, subtotal: subtotal, otherDeduct: 0, otherNote: '',
    total: subtotal,
    paid: paid, paidDate: paidDate, walletId: '', txId: ''
  });
}

function removeRiceTransaction_(txId) {
  if (!txId) return '';
  const txSheet = getSheet_(MM_SHEETS.TRANSACTIONS);
  const tx = findBookTransactionRow_(txSheet, txId);
  if (tx) txSheet.deleteRow(tx.row);
  return txId;
}

function riceTypeKey_(type) {
  return clean_(type, 80).replace(/\s+/g, ' ').toLowerCase();
}

function riceStock_(records) {
  const map = {};
  const row = function (type) {
    const label = clean_(type, 80);
    if (!label) return null;
    const key = riceTypeKey_(label);
    if (!map[key]) map[key] = { riceType: label, buyKg: 0, sellKg: 0, mergeInKg: 0, mergeOutKg: 0, balanceKg: 0 };
    return map[key];
  };
  records.forEach(function (r) {
    if (r.kind === 'buy') {
      const stockRow = row(r.riceType);
      if (stockRow) stockRow.buyKg += number_(r.payKg);
    }
    if (r.kind === 'sell') {
      const stockRow = row(r.riceType);
      if (stockRow) stockRow.sellKg += number_(r.payKg);
    }
    if (r.kind === 'merge') {
      (r.sources || []).forEach(function (s) {
        const stockRow = row(s.riceType);
        if (stockRow) stockRow.mergeOutKg += number_(s.kg);
      });
      const stockRow = row(r.riceType);
      if (stockRow) stockRow.mergeInKg += number_(r.payKg);
    }
  });
  return Object.keys(map).sort(function (a, b) { return map[a].riceType.localeCompare(map[b].riceType, 'th'); }).map(function (key) {
    const s = map[key];
    s.balanceKg = s.buyKg + s.mergeInKg - s.sellKg - s.mergeOutKg;
    return s;
  });
}

function nextRiceBillNo_(records, kind, date) {
  const base = MM_RICE_PREFIX[kind] + String(Number(date.slice(0, 4)) + 543).slice(2) + date.slice(5, 7) + date.slice(8, 10) + '-';
  const max = records.reduce(function (top, r) {
    if (String(r.billNo).indexOf(base) !== 0) return top;
    return Math.max(top, Number(String(r.billNo).slice(base.length)) || 0);
  }, 0);
  return base + String(max + 1).padStart(3, '0');
}

function riceCanEdit_(user, record) {
  if (isManager_(user)) return true;
  if (String(record.createdBy).toLowerCase() !== String(user.username).toLowerCase()) return false;
  const created = new Date(record.createdAt);
  return !isNaN(created.getTime()) && Utilities.formatDate(created, MM_TIME_ZONE, 'yyyy-MM-dd') === today_();
}

function riceRecords_() {
  const seen = {};
  return rowsForUser_(MM_SHEETS.RICE, MM_BOOK).map(riceFromRow_).filter(function (record) {
    const signature = record.kind + '|' + record.billNo + '|' + record.createdAt;
    if (seen[record.id] || (record.billNo && record.createdAt && seen[signature])) return false;
    seen[record.id] = true;
    seen[signature] = true;
    return true;
  });
}

// Remove duplicate rows by id (on a repeat, keep the most recently edited one)
function dedupeById_(list) {
  const byId = {};
  const order = [];
  (list || []).forEach(function (item) {
    const id = String(item && item.id || '');
    if (!id) { order.push(item); return; }
    if (!byId[id]) { byId[id] = item; order.push(id); return; }
    if (String(item.updatedAt || '') > String(byId[id].updatedAt || '')) byId[id] = item;
  });
  return order.map(function (key) { return typeof key === 'string' ? byId[key] : key; });
}

// Transactions: besides the same id, an item with identical created-at time + content is also a duplicate copy
function dedupeTransactions_(list) {
  const seen = {};
  return dedupeById_(list).filter(function (tx) {
    if (!tx.createdAt) return true;
    const signature = [tx.createdAt, tx.type, tx.date, tx.amount, tx.walletId, tx.targetWalletId, tx.categoryId, tx.person, tx.note].join('|');
    if (seen[signature]) return false;
    seen[signature] = true;
    return true;
  });
}

function riceFromRow_(r) {
  return Object.assign(parseJson_(r[10], {}), {
    id: String(r[1]),
    kind: String(r[2]),
    date: sheetDate_(r[3]),
    billNo: String(r[4] || ''),
    riceType: String(r[5] || ''),
    payKg: number_(r[6]),
    total: number_(r[7]),
    paid: String(r[8]).toLowerCase() === 'true',
    txId: String(r[9] || ''),
    createdAt: toIso_(r[11]),
    updatedAt: toIso_(r[12]),
    createdBy: String(r[13] || '')
  });
}

function riceRow_(record) {
  const data = Object.assign({}, record);
  delete data.canEdit;
  return [
    MM_BOOK, record.id, record.kind, record.date, record.billNo, record.riceType, record.payKg, record.total,
    Boolean(record.paid), record.txId || '', JSON.stringify(data), record.createdAt || '', record.updatedAt || '', record.createdBy || ''
  ];
}

function findRiceRow_(sh, id) {
  const values = sh.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]) === MM_BOOK && String(values[r][1]) === String(id)) {
      return { row: r + 1, record: riceFromRow_(values[r]) };
    }
  }
  return null;
}

// หน้าพนักงานที่ไม่ได้ล็อกอินไม่ผ่าน login() จึงต้องสร้างหัวตารางเองถ้ายังไม่มี
function ensureRiceSheet_() {
  const ss = getSpreadsheet_();
  const sh = getOrCreateSheet_(ss, MM_SHEETS.RICE);
  if (sh.getLastRow() === 0) {
    setupHeader_(sh, MM_HEADERS[MM_SHEETS.RICE]);
    sh.getRange('D:D').setNumberFormat('@');
    sh.getRange('L:M').setNumberFormat('@');
  }
  return sh;
}

function isRiceCategory_(categoryId) {
  return String(categoryId || '').indexOf('cat_rice_') === 0;
}

function assertNotRiceTx_(tx) {
  if (isRiceCategory_(tx.categoryId)) throw new Error('รายการนี้มาจากบิลซื้อ-ขายข้าว กรุณาแก้ไขที่หน้าซื้อ-ขายข้าว');
}

/* ---------- จัดการผู้ใช้ (เฉพาะผู้บริหาร) ---------- */

function apiListUsers(token) {
  requireManager_(token);
  return { ok: true, users: listUsers_() };
}

function apiSaveUser(token, input) {
  const actor = requireManager_(token);
  input = input || {};
  const username = clean_(input.username, 40);
  const displayName = clean_(input.displayName, 80) || username;
  const role = MM_MANAGER_ROLES.indexOf(String(input.role)) >= 0 ? 'admin' : 'staff';
  const active = input.active !== false;
  const password = String(input.password || '');
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new Error('ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ยาว 3-40 ตัวอักษร');
  if (password && password.length < 6) throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_(MM_SHEETS.USERS);
    const values = sh.getDataRange().getValues();
    let rowIndex = -1;
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][0]).toLowerCase() === username.toLowerCase()) { rowIndex = r; break; }
    }

    if (input.isNew) {
      if (rowIndex >= 0) throw new Error('มีชื่อผู้ใช้ "' + username + '" อยู่แล้ว');
      if (!password) throw new Error('กรุณาตั้งรหัสผ่าน');
      sh.appendRow([username, password, displayName, role, active, new Date(), new Date()]);
      logAudit_(actor.username, 'createUser', username + ' (' + role + ')');
    } else {
      if (rowIndex < 0) throw new Error('ไม่พบผู้ใช้');
      const isSelf = String(values[rowIndex][0]).toLowerCase() === actor.username.toLowerCase();
      if (isSelf && (!active || role !== 'admin')) throw new Error('ไม่สามารถปิดการใช้งานหรือลดสิทธิ์บัญชีของตัวเองได้');
      const remainingManagers = values.slice(1).filter(function (r, i) {
        if (i + 1 === rowIndex) return active && role === 'admin';
        return MM_MANAGER_ROLES.indexOf(String(r[3])) >= 0 && String(r[4]).toLowerCase() !== 'false';
      }).length;
      if (!remainingManagers) throw new Error('ต้องมีผู้บริหารที่ใช้งานได้อย่างน้อย 1 คน');
      const row = rowIndex + 1;
      if (password) sh.getRange(row, 2).setValue(password);
      sh.getRange(row, 3, 1, 3).setValues([[displayName, role, active]]);
      sh.getRange(row, 7).setValue(new Date());
      logAudit_(actor.username, 'updateUser', username + ' (' + role + (active ? '' : ', inactive') + ')');
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, users: listUsers_() };
}

function listUsers_() {
  const values = getSheet_(MM_SHEETS.USERS).getDataRange().getValues();
  return values.slice(1).filter(function (r) { return String(r[0]); }).map(function (r) {
    return {
      username: String(r[0]),
      displayName: String(r[2] || r[0]),
      role: MM_MANAGER_ROLES.indexOf(String(r[3])) >= 0 ? 'admin' : 'staff',
      active: String(r[4]).toLowerCase() !== 'false',
      createdAt: r[5] instanceof Date ? r[5].toISOString() : String(r[5] || '')
    };
  });
}

function apiLogout(token) {
  if (token) CacheService.getScriptCache().remove(sessionKey_(token));
  return { ok: true };
}

function changePassword(username, oldPassword, newPassword) {
  const user = findUser_(username);
  if (!user || String(oldPassword || '') !== user.password) {
    return { ok: false, message: 'รหัสผ่านเดิมไม่ถูกต้อง' };
  }
  if (String(newPassword || '').length < 6) {
    return { ok: false, message: 'รหัสผ่านใหม่ควรมีอย่างน้อย 6 ตัวอักษร' };
  }

  const sh = getSheet_(MM_SHEETS.USERS);
  const values = sh.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]) === username) {
      sh.getRange(r + 1, 2).setValue(String(newPassword));
      sh.getRange(r + 1, 7).setValue(new Date());
      logAudit_(username, 'changePassword', 'Password changed');
      return { ok: true };
    }
  }
  return { ok: false, message: 'ไม่พบผู้ใช้' };
}

function ensureDefaultAdmin_() {
  if (findUser_(MM_DEFAULT_USER)) return;
  const sh = getSheet_(MM_SHEETS.USERS);
  sh.appendRow([
    MM_DEFAULT_USER,
    MM_DEFAULT_PASS,
    'ผู้ดูแลระบบ',
    'admin',
    true,
    new Date(),
    new Date()
  ]);
}

// ข้อมูลอยู่ในสมุดบัญชีกลาง (MM_BOOK) ส่วนการตั้งค่าหน้าจอ (เดือน/มุมมอง/ตัวกรอง) แยกตามผู้ใช้ที่เปิดดู
function getBookState_(viewerUsername) {
  const username = MM_BOOK;
  const settingsRow = rowsForUser_(MM_SHEETS.SETTINGS, viewerUsername)[0];
  const filters = settingsRow ? parseJson_(settingsRow[4], { search: '', type: 'all', wallet: 'all', category: 'all' }) : {};

  const wallets = rowsForUser_(MM_SHEETS.WALLETS, username).map(function (r) {
    return {
      id: String(r[1]),
      name: String(r[2]),
      initialBalance: number_(r[3]),
      color: String(r[4] || '#55c7a6'),
      kind: String(r[7] || '') === 'savings' ? 'savings' : 'spending',
      goal: number_(r[8])
    };
  });

  const categories = rowsForUser_(MM_SHEETS.CATEGORIES, username).map(function (r) {
    return {
      id: String(r[1]),
      type: String(r[2] || 'expense'),
      name: String(r[3]),
      icon: String(r[4] || '•'),
      color: String(r[5] || '#79d7c4')
    };
  }).filter(function (category) {
    return !isRiceCategory_(category.id);
  });

  const budgetCategoryMap = {};
  rowsForUser_(MM_SHEETS.BUDGET_CATEGORIES, username).forEach(function (r) {
    const budgetId = String(r[1]);
    if (!budgetCategoryMap[budgetId]) budgetCategoryMap[budgetId] = [];
    budgetCategoryMap[budgetId].push(String(r[2]));
  });

  const budgets = rowsForUser_(MM_SHEETS.BUDGETS, username).map(function (r) {
    const id = String(r[1]);
    return {
      id: id,
      name: String(r[2]),
      limit: number_(r[3]),
      color: String(r[4] || '#ffd84d'),
      categoryIds: (budgetCategoryMap[id] || []).filter(function (categoryId) { return !isRiceCategory_(categoryId); })
    };
  });

  const transactions = rowsForUser_(MM_SHEETS.TRANSACTIONS, username).map(transactionFromRow_).filter(function (tx) {
    return !isRiceCategory_(tx.categoryId);
  });

  return {
    version: 1,
    ui: {
      view: settingsRow ? String(settingsRow[1] || 'dashboard') : 'dashboard',
      month: settingsRow ? sheetMonth_(settingsRow[2]) : currentMonth_(),
      selectedDate: settingsRow ? sheetDate_(settingsRow[3]) : today_(),
      filters: {
        search: String(filters.search || ''),
        type: String(filters.type || 'all'),
        wallet: String(filters.wallet || 'all'),
        category: isRiceCategory_(filters.category) ? 'all' : String(filters.category || 'all')
      }
    },
    wallets: dedupeById_(wallets),
    categories: dedupeById_(categories),
    budgets: dedupeById_(budgets),
    transactions: dedupeTransactions_(transactions)
  };
}

function transactionFromRow_(r) {
  return {
    id: String(r[1]),
    type: String(r[2] || 'expense'),
    date: sheetDate_(r[3]),
    amount: number_(r[4]),
    walletId: String(r[5] || ''),
    targetWalletId: String(r[6] || ''),
    categoryId: String(r[7] || ''),
    person: String(r[8] || ''),
    dueDate: sheetDate_(r[9]),
    status: String(r[10] || 'open'),
    note: String(r[11] || ''),
    tags: String(r[12] || '').split('|').filter(Boolean),
    createdAt: toIso_(r[13]) || new Date().toISOString(),
    updatedAt: toIso_(r[14]),
    createdBy: String(r[15] || ''),
    loanId: String(r[16] || '') // type = 'repay' (คืนเงินยืม) อ้างถึงรายการยืม/ให้ยืม
  };
}

function transactionRow_(bookUsername, t) {
  return [
    bookUsername,
    clean_(t.id, 120),
    clean_(t.type || 'expense', 20),
    clean_(t.date || today_(), 10),
    number_(t.amount),
    clean_(t.walletId, 120),
    clean_(t.targetWalletId, 120),
    clean_(t.categoryId, 120),
    clean_(t.person, 160),
    clean_(t.dueDate, 10),
    clean_(t.status || 'open', 20),
    clean_(t.note, 500),
    (t.tags || []).map(function (tag) { return clean_(tag, 60); }).filter(Boolean).join('|'),
    clean_(t.createdAt || new Date().toISOString(), 40),
    clean_(t.updatedAt || '', 40),
    clean_(t.createdBy || '', 80),
    clean_(t.loanId || '', 120)
  ];
}

/**
 * รวมธุรกรรมที่ผู้บริหารส่งมา กับของในชีต (ที่พนักงานอาจเพิ่ม/แก้/ลบระหว่างนั้น)
 * - ในชีตแต่ไม่อยู่ในที่ส่งมา และผู้บริหารไม่เคยเห็น → คนอื่นเพิ่มใหม่ → เก็บไว้
 * - ที่ส่งมาแต่ไม่อยู่ในชีต และผู้บริหารเคยเห็น → คนอื่นลบไปแล้ว → ตัดออก
 * - อยู่ทั้งสองฝั่ง แต่ในชีตแก้ไขล่าสุดกว่า → ใช้ของในชีต
 */
function mergeTransactions_(existing, incoming, knownIds) {
  const known = {};
  knownIds.forEach(function (id) { known[String(id)] = true; });
  const existingById = {};
  existing.forEach(function (tx) { existingById[tx.id] = tx; });
  const incomingIds = {};
  incoming.forEach(function (tx) { incomingIds[String(tx.id)] = true; });

  const added = [];
  const removedIds = [];
  const merged = [];
  incoming.forEach(function (tx) {
    const current = existingById[String(tx.id)];
    if (!current) {
      if (known[String(tx.id)]) removedIds.push(String(tx.id));
      else merged.push(tx);
      return;
    }
    if (String(current.updatedAt || '') > String(tx.updatedAt || '')) {
      merged.push(current);
      added.push(current);
      return;
    }
    if (!tx.createdBy && current.createdBy) tx.createdBy = current.createdBy;
    merged.push(tx);
  });
  existing.forEach(function (tx) {
    if (!incomingIds[tx.id] && !known[tx.id]) {
      merged.push(tx);
      added.push(tx);
    }
  });
  return { merged: merged, added: added, removedIds: removedIds };
}

function saveBookState_(viewerUsername, state, knownIds) {
  const username = MM_BOOK;
  const now = new Date();
  state = Object.assign({}, state, {
    wallets: dedupeById_(state.wallets),
    categories: dedupeById_(state.categories),
    budgets: dedupeById_(state.budgets),
    transactions: dedupeTransactions_(state.transactions)
  });
  const ui = state.ui || {};
  const filters = ui.filters || {};

  deleteRowsByUser_(MM_SHEETS.SETTINGS, viewerUsername);
  appendRows_(MM_SHEETS.SETTINGS, [[
    viewerUsername,
    clean_(ui.view || 'dashboard', 40),
    clean_(ui.month || currentMonth_(), 10),
    clean_(ui.selectedDate || today_(), 10),
    JSON.stringify(filters),
    now
  ]]);

  deleteRowsByUser_(MM_SHEETS.WALLETS, username);
  appendRows_(MM_SHEETS.WALLETS, (state.wallets || []).map(function (w, i) {
    return [
      username,
      clean_(w.id, 120),
      clean_(w.name, 120),
      number_(w.initialBalance),
      clean_(w.color || '#55c7a6', 20),
      i + 1,
      now,
      w.kind === 'savings' ? 'savings' : 'spending',
      number_(w.goal)
    ];
  }));

  deleteRowsByUser_(MM_SHEETS.CATEGORIES, username);
  const categories = (state.categories || []).filter(function (c) { return !isRiceCategory_(c.id); });
  appendRows_(MM_SHEETS.CATEGORIES, categories.map(function (c, i) {
    return [
      username,
      clean_(c.id, 120),
      clean_(c.type || 'expense', 20),
      clean_(c.name, 120),
      clean_(c.icon || '•', 10),
      clean_(c.color || '#79d7c4', 20),
      i + 1,
      now
    ];
  }));

  deleteRowsByUser_(MM_SHEETS.BUDGETS, username);
  appendRows_(MM_SHEETS.BUDGETS, (state.budgets || []).map(function (b) {
    return [
      username,
      clean_(b.id, 120),
      clean_(b.name, 120),
      number_(b.limit),
      clean_(b.color || '#ffd84d', 20),
      now
    ];
  }));

  deleteRowsByUser_(MM_SHEETS.BUDGET_CATEGORIES, username);
  const budgetCategoryRows = [];
  (state.budgets || []).forEach(function (b) {
    (b.categoryIds || []).forEach(function (categoryId) {
      if (isRiceCategory_(categoryId)) return;
      budgetCategoryRows.push([username, clean_(b.id, 120), clean_(categoryId, 120)]);
    });
  });
  appendRows_(MM_SHEETS.BUDGET_CATEGORIES, budgetCategoryRows);

  let transactions = (state.transactions || []).filter(function (tx) { return !isRiceCategory_(tx.categoryId); });
  let merge = { added: [], removedIds: [] };
  if (knownIds) {
    merge = mergeTransactions_(rowsForUser_(MM_SHEETS.TRANSACTIONS, username).map(transactionFromRow_), transactions, knownIds);
    transactions = dedupeTransactions_(merge.merged);
  }
  deleteRowsByUser_(MM_SHEETS.TRANSACTIONS, username);
  appendRows_(MM_SHEETS.TRANSACTIONS, transactions.map(function (t) { return transactionRow_(username, t); }));
  return { added: merge.added, removedIds: merge.removedIds };
}

function createDefaultState_() {
  const month = currentMonth_();
  return {
    version: 1,
    ui: {
      view: 'dashboard',
      month: month,
      selectedDate: today_(),
      filters: { search: '', type: 'all', wallet: 'all', category: 'all' }
    },
    wallets: [],
    categories: [],
    budgets: [],
    transactions: []
  };
}

function findUser_(username) {
  const sh = getSheet_(MM_SHEETS.USERS);
  const values = sh.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]).toLowerCase() === String(username).toLowerCase()) {
      return {
        username: String(values[r][0]),
        password: String(values[r][1] || ''),
        displayName: String(values[r][2] || values[r][0]),
        role: String(values[r][3] || 'user'),
        active: String(values[r][4]).toLowerCase() !== 'false'
      };
    }
  }
  return null;
}

function requireSession_(token) {
  const raw = token ? CacheService.getScriptCache().get(sessionKey_(token)) : '';
  if (!raw) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  return JSON.parse(raw);
}

// อ่านสิทธิ์ล่าสุดจากชีตทุกครั้ง เพื่อให้การเปลี่ยนบทบาท/ปิดการใช้งานมีผลทันที
function requireUser_(token) {
  const session = requireSession_(token);
  const user = findUser_(session.username);
  if (!user || !user.active) throw new Error('บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้บริหาร');
  return user;
}

// หน้าพนักงาน: ไม่มี token = พนักงานทั่วไปที่ไม่ได้ล็อกอิน, มี token = ผู้ใช้ที่ล็อกอินอยู่
function requireStaff_(token) {
  if (!token) return { username: MM_GUEST_USER, displayName: 'พนักงาน', role: 'staff', active: true };
  return requireUser_(token);
}

function requireManager_(token) {
  const user = requireUser_(token);
  if (!isManager_(user)) throw new Error('เฉพาะผู้บริหารเท่านั้น');
  return user;
}

function isManager_(user) {
  return MM_MANAGER_ROLES.indexOf(String(user && user.role)) >= 0;
}

function publicUser_(user) {
  return { username: user.username, displayName: user.displayName, role: isManager_(user) ? 'admin' : 'staff' };
}

function isDateKey_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function toIso_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value);
}

function sessionKey_(token) {
  return 'MM_SESSION_' + token;
}

function getSpreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('ไม่พบ Spreadsheet: กรุณาเปิด Apps Script จาก Google Sheet');
  return ss;
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getSheet_(name) {
  return getSpreadsheet_().getSheetByName(name) || getOrCreateSheet_(getSpreadsheet_(), name);
}

function setupHeader_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#272a35')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.autoResizeColumns(1, headers.length);
  if (!sh.getFilter()) sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), headers.length).createFilter();
}

function rowsForUser_(sheetName, username) {
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  return values.slice(1).filter(function (r) {
    return String(r[0]) === String(username);
  });
}

function appendRows_(sheetName, rows) {
  if (!rows || !rows.length) return;
  const sh = getSheet_(sheetName);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function resetAllData_() {
  Object.keys(MM_HEADERS).forEach(function (sheetName) {
    clearRows_(sheetName);
  });
}

// ใช้ clearContent แทน deleteRows: ชีตไม่ยอมให้ลบแถวที่ไม่ได้ freeze ทั้งหมด (จะ error เมื่อข้อมูลเต็มทุกแถว)
function clearRows_(sheetName) {
  const sh = getSheet_(sheetName);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, Math.max(sh.getLastColumn(), 1)).clearContent();
}

// ลบแถวของ username ด้วยการอ่าน-เขียนครั้งเดียว (deleteRow ทีละแถวช้ามากเมื่อมีหลายพันแถว)
function deleteRowsByUser_(sheetName, username) {
  const sh = getSheet_(sheetName);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const width = sh.getLastColumn();
  const range = sh.getRange(2, 1, lastRow - 1, width);
  const values = range.getValues();
  const keep = values.filter(function (r) { return String(r[0]) !== String(username); });
  if (keep.length === values.length) return;
  range.clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
}

function logAudit_(username, action, detail) {
  const sh = getSpreadsheet_().getSheetByName(MM_SHEETS.AUDIT);
  if (!sh) return;
  sh.appendRow([new Date(), username || '', action || '', detail || '']);
}

function parseJson_(value, fallback) {
  try {
    return JSON.parse(String(value || ''));
  } catch (err) {
    return fallback;
  }
}

function sheetDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, MM_TIME_ZONE, 'yyyy-MM-dd');
  }
  return String(value).slice(0, 10);
}

function sheetMonth_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, MM_TIME_ZONE, 'yyyy-MM');
  }
  const text = String(value || '');
  return /^\d{4}-\d{2}$/.test(text) ? text : currentMonth_();
}

function today_() {
  return Utilities.formatDate(new Date(), MM_TIME_ZONE, 'yyyy-MM-dd');
}

function currentMonth_() {
  return Utilities.formatDate(new Date(), MM_TIME_ZONE, 'yyyy-MM');
}

function clean_(value, max) {
  const text = String(value == null ? '' : value).trim();
  return max ? text.slice(0, max) : text;
}

function number_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}
