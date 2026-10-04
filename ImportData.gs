/**
 * ImportData.gs — copies the GitHub Pages data into this Google Sheet and adds a "MoneyBook" menu with save buttons
 * Use: in Apps Script, create a new file named ImportData (alongside code.gs), paste everything here, and save
 * Then go back to Google Sheet > reload the page > the menu "💾 MoneyBook" appears at the top > click "Import data from GitHub Pages"
 * (On the first run Google asks for permission: Allow)
 *
 * The data below comes from the backup file exported from GitHub Pages on 2026-10-03
 * (8 wallets, 21 categories, 45 transactions, 2 rice bills)
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💾 MoneyBook')
    .addItem('Import data from GitHub Pages', 'importGithubPagesData')
    .addItem('Save / tidy sheets (create missing columns)', 'saveSheetStructure')
    .addSeparator()
    .addItem('Show data summary', 'showDataSummary')
    .addToUi();
}

/** Writes MM_IMPORT_DATA into every MM_ sheet (replaces the MoneyBook book's old data; MM_Users is untouched) */
function importGithubPagesData() {
  const data = Object.assign({}, MM_IMPORT_DATA);
  // the backup file was saved through PowerShell, so the array is wrapped as { value: [...], Count }
  if (data.riceRecords && Array.isArray(data.riceRecords.value)) data.riceRecords = data.riceRecords.value;
  const imported = unpackBackup_(data);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureSheetStructure_();
    ensureRiceSheet_();
    ensureDefaultAdmin_();
    saveBookState_(MM_DEFAULT_USER, imported.state, null);
    replaceRiceRecords_(imported.riceRecords);
    logAudit_(MM_DEFAULT_USER, 'importGithubPagesData',
      'Imported ' + imported.state.transactions.length + ' transactions, ' + imported.riceRecords.length + ' rice records');
  } finally {
    lock.releaseLock();
  }
  SpreadsheetApp.flush();
  const msg = 'Import complete\n'
    + 'Wallets: ' + imported.state.wallets.length + '\n'
    + 'Categories: ' + imported.state.categories.length + '\n'
    + 'Transactions: ' + imported.state.transactions.length + '\n'
    + 'Rice bills: ' + imported.riceRecords.length;
  notify_(msg);
  return msg;
}

/** Save button: creates missing sheets/columns without deleting existing data */
function saveSheetStructure() {
  ensureSheetStructure_();
  ensureRiceSheet_();
  ensureDefaultAdmin_();
  SpreadsheetApp.flush();
  notify_('Saved: sheets and columns are complete');
}

function showDataSummary() {
  const ss = SpreadsheetApp.getActive();
  const lines = Object.keys(MM_SHEETS).map(function (key) {
    const sh = ss.getSheetByName(MM_SHEETS[key]);
    return MM_SHEETS[key] + ': ' + (sh ? Math.max(sh.getLastRow() - 1, 0) + ' rows' : 'none yet');
  });
  notify_(lines.join('\n'));
}

function notify_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor: see the Execution log */ }
}

const MM_IMPORT_DATA ={
    "app":  "MoneyBook",
    "version":  2,
    "exportedAt":  "2026-10-03T17:09:02.9368605+07:00",
    "state":  {
                  "version":  1,
                  "ui":  {
                             "view":  "details",
                             "tab":  "loans",
                             "month":  "2026-10",
                             "selectedDate":  "2026-10-03",
                             "filters":  {
                                             "search":  "",
                                             "range":  "month",
                                             "type":  "all",
                                             "wallet":  "all",
                                             "category":  "all"
                                         }
                         },
                  "wallets":  [
                                  {
                                      "id":  "wallet_muozucw2_cu5vxc",
                                      "name":  "บัญชีตุ้ม",
                                      "kind":  "spending",
                                      "initialBalance":  5379,
                                      "goal":  0,
                                      "color":  "#20bc2a"
                                  },
                                  {
                                      "id":  "wallet_muozy48v_oczim2",
                                      "name":  "บัญชีพี่แจง",
                                      "kind":  "spending",
                                      "initialBalance":  920,
                                      "goal":  0,
                                      "color":  "#8df778"
                                  },
                                  {
                                      "id":  "wallet_mup0242v_2vywav",
                                      "name":  "พี่ลิ",
                                      "kind":  "spending",
                                      "initialBalance":  9000,
                                      "goal":  0,
                                      "color":  "#9bf8a1"
                                  },
                                  {
                                      "id":  "wallet_mup0aox9_vynfzl",
                                      "name":  "บัญชีเงินสด",
                                      "kind":  "spending",
                                      "initialBalance":  74265,
                                      "goal":  0,
                                      "color":  "#1c98b0"
                                  },
                                  {
                                      "id":  "wallet_mup0sqc2_8nnm2u",
                                      "name":  "บัญชีแม่กรุงเทพ",
                                      "kind":  "spending",
                                      "initialBalance":  225523,
                                      "goal":  0,
                                      "color":  "#629af3"
                                  },
                                  {
                                      "id":  "wallet_mup1y0sd_g5yp1q",
                                      "name":  "บัญชียืมตุ้ม",
                                      "kind":  "spending",
                                      "initialBalance":  0,
                                      "goal":  0,
                                      "color":  "#ec8ee4"
                                  },
                                  {
                                      "id":  "wallet_mupdy0qd_u42wb1",
                                      "name":  "บัญชีแม่กสิกร",
                                      "kind":  "spending",
                                      "initialBalance":  6934,
                                      "goal":  0,
                                      "color":  "#1baf7a"
                                  },
                                  {
                                      "id":  "wallet_mupe35kb_i42e22",
                                      "name":  "บัญชีแม่กรุงไทย",
                                      "kind":  "spending",
                                      "initialBalance":  5196,
                                      "goal":  0,
                                      "color":  "#58c1e4"
                                  }
                              ],
                  "categories":  [
                                     {
                                         "id":  "cat_mup0ce8v_y8qjk8",
                                         "type":  "income",
                                         "name":  "ขายข้าวเหนียวปี",
                                         "icon":  "🚌",
                                         "color":  "#d6f5e3"
                                     },
                                     {
                                         "id":  "cat_mup0ut56_1fpi7s",
                                         "type":  "expense",
                                         "name":  "คืนเงิน",
                                         "icon":  "฿",
                                         "color":  "#cfe6ff"
                                     },
                                     {
                                         "id":  "cat_mup55dcg_v9pt0a",
                                         "type":  "expense",
                                         "name":  "คนงาน",
                                         "icon":  "🏃",
                                         "color":  "#f3e2cf"
                                     },
                                     {
                                         "id":  "cat_mup57t68_xobfpv",
                                         "type":  "expense",
                                         "name":  "ค่าไฟ",
                                         "icon":  "💡",
                                         "color":  "#fff3b0"
                                     },
                                     {
                                         "id":  "cat_mup58jdp_m61t58",
                                         "type":  "expense",
                                         "name":  "น้ำมัน",
                                         "icon":  "⛽",
                                         "color":  "#ffd9d0"
                                     },
                                     {
                                         "id":  "cat_mup59bfy_929txl",
                                         "type":  "expense",
                                         "name":  "อาหาร",
                                         "icon":  "🍚",
                                         "color":  "#ffe3c2"
                                     },
                                     {
                                         "id":  "cat_mup59oq6_klt8n0",
                                         "type":  "expense",
                                         "name":  "บริจาค/ทำบุญ",
                                         "icon":  "🙏",
                                         "color":  "#fff0cc"
                                     },
                                     {
                                         "id":  "cat_mup59tz7_dc19mv",
                                         "type":  "expense",
                                         "name":  "ประกัน",
                                         "icon":  "🛡️",
                                         "color":  "#dbe7f5"
                                     },
                                     {
                                         "id":  "cat_mup59v55_84yei1",
                                         "type":  "expense",
                                         "name":  "ของใช้ในบ้าน",
                                         "icon":  "🧴",
                                         "color":  "#d9f4f2"
                                     },
                                     {
                                         "id":  "cat_mup59xhw_kh2tpq",
                                         "type":  "expense",
                                         "name":  "โทรศัพท์/เน็ต",
                                         "icon":  "📱",
                                         "color":  "#dcd6ff"
                                     },
                                     {
                                         "id":  "cat_mup5a6h1_qvfac8",
                                         "type":  "expense",
                                         "name":  "ค่างวดรถ",
                                         "icon":  "🚗",
                                         "color":  "#dfe9ff"
                                     },
                                     {
                                         "id":  "cat_mup5a78h_n8v8qq",
                                         "type":  "expense",
                                         "name":  "ซ่อมบำรุง",
                                         "icon":  "🔧",
                                         "color":  "#e8e8e8"
                                     },
                                     {
                                         "id":  "cat_mup5a8tk_z761pt",
                                         "type":  "expense",
                                         "name":  "ภาษี/ค่าธรรมเนียม",
                                         "icon":  "🧾",
                                         "color":  "#eee6d8"
                                     },
                                     {
                                         "id":  "cat_mup5ahx3_xdwc8r",
                                         "type":  "expense",
                                         "name":  "ของแม่",
                                         "icon":  "🎁",
                                         "color":  "#ffd9e6"
                                     },
                                     {
                                         "id":  "cat_mup5bmr9_kidun9",
                                         "type":  "expense",
                                         "name":  "หวย",
                                         "icon":  "🎉",
                                         "color":  "#ffe0f0"
                                     },
                                     {
                                         "id":  "cat_mup5cj9k_o40wom",
                                         "type":  "expense",
                                         "name":  "ร้านค่า",
                                         "icon":  "🏠",
                                         "color":  "#e2f0d9"
                                     },
                                     {
                                         "id":  "cat_mup5e6i8_m5x9zd",
                                         "type":  "expense",
                                         "name":  "ทำนา",
                                         "icon":  "🚌",
                                         "color":  "#cfe6ff"
                                     },
                                     {
                                         "id":  "cat_mup5gk7k_dhjcta",
                                         "type":  "expense",
                                         "name":  "จ่ายดอก",
                                         "icon":  "💳",
                                         "color":  "#e1e5f7"
                                     },
                                     {
                                         "id":  "cat_muqwweoe_zm96fx",
                                         "type":  "expense",
                                         "name":  "อื่น ๆ",
                                         "icon":  "•",
                                         "color":  "#ececec"
                                     },
                                     {
                                         "id":  "cat_muqx76sr_onya5m",
                                         "type":  "income",
                                         "name":  "ติดบวก",
                                         "icon":  "•",
                                         "color":  "#ffd6e8"
                                     },
                                     {
                                         "id":  "cat_muqx8lgq_hcqvgo",
                                         "type":  "income",
                                         "name":  "ถูกหวย",
                                         "icon":  "🎉",
                                         "color":  "#d9f4f2"
                                     }
                                 ],
                  "budgets":  [

                              ],
                  "transactions":  [
                                       {
                                           "id":  "tx_mup14vr0_4xabh7",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  7000,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "แม่ต้อย-พ่อป่อง",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:24:01.980Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup15on8_2rco72",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  5000,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "ยายเทียบ",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:24:39.428Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup16lu4_ahopcb",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  14500,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "ตาอู๋-แม่หรัด",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:25:22.444Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup177po_2emkxt",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  20000,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "พ่อมง",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:25:50.796Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup17yrc_l0acgt",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  12000,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "แม่ต้อย-พ่อศร",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:26:25.848Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup18ip5_363xw6",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  5000,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "แม่แก้ว",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:26:51.689Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup19hn2_pzhab0",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  70000,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "พ่อสมบัติ-แม่น้อย",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:27:36.974Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup1ar4n_5cma8i",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  83020,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "พี่ปู-พ่อพงษ์",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:28:35.928Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup1barh_033dpy",
                                           "type":  "lend",
                                           "date":  "2026-10-01",
                                           "amount":  2000,
                                           "walletId":  "wallet_mup0sqc2_8nnm2u",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "ยายเรียน",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดหนี้",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:29:01.373Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup2d9f7_ftmwcr",
                                           "type":  "borrow",
                                           "date":  "2026-10-01",
                                           "amount":  221297,
                                           "walletId":  "wallet_mup1y0sd_g5yp1q",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "ตุ้ม",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอด สค",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:58:32.564Z",
                                           "updatedAt":  "2026-10-01T07:55:24.855Z",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup5z83v_l60t0d",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  2900,
                                           "walletId":  "wallet_mup0242v_2vywav",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup5bmr9_kidun9",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T06:39:36.139Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup5zxr1_lfunh4",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  530,
                                           "walletId":  "wallet_mup0242v_2vywav",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup5a8tk_z761pt",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "สรรพสามิต",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T06:40:09.373Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup84hu2_ygshak",
                                           "type":  "borrow",
                                           "date":  "2026-10-01",
                                           "amount":  20293,
                                           "walletId":  "wallet_mup1y0sd_g5yp1q",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "ตุ้ม",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ค่าข้าวลัดดาวัลย์",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T07:39:41.258Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup85udr_ff5xqs",
                                           "type":  "borrow",
                                           "date":  "2026-10-01",
                                           "amount":  125853,
                                           "walletId":  "wallet_mup1y0sd_g5yp1q",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "ตุ้ม",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ค่าข้าวอุมารินทร์",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T07:40:44.175Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup86vlx_i722ld",
                                           "type":  "borrow",
                                           "date":  "2026-10-01",
                                           "amount":  96600,
                                           "walletId":  "wallet_mup1y0sd_g5yp1q",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "ตุ้ม",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ค่าข้าวสีประไพ",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T07:41:32.421Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupbvie0_5g2pgw",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  2870,
                                           "walletId":  "wallet_mup0242v_2vywav",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup5a78h_n8v8qq",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ซ่อมลูกตี เครื่องสีข้าว",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T09:24:40.536Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfc6k0_afhtw6",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  200,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup55dcg_v9pt0a",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "สองตักข้าว",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:01:37.200Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfcnzv_3bk2zl",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  80,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup59bfy_929txl",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "น้ำแข็ง",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:01:59.803Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfdq79_xyoygo",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  278,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup5ahx3_xdwc8r",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:02:49.318Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfeaip_pldzct",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  148,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup5ahx3_xdwc8r",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:03:15.649Z",
                                           "updatedAt":  "2026-10-01T11:09:51.648Z",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfm2di_jeii4i",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  140,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup5a78h_n8v8qq",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ดูดส้วม",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:09:18.342Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfmi2g_ip1mgj",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  148,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup5ahx3_xdwc8r",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:09:38.680Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqwxgd8_icey4h",
                                           "type":  "expense",
                                           "date":  "2026-10-02",
                                           "amount":  80,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup59bfy_929txl",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "น้ำแข็ง",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:01:49.340Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqwylw3_vn26qr",
                                           "type":  "expense",
                                           "date":  "2026-10-02",
                                           "amount":  2511,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup59xhw_kh2tpq",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "เครื่องเดิม",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:02:43.155Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqwzb3g_9203m9",
                                           "type":  "expense",
                                           "date":  "2026-10-02",
                                           "amount":  427,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup59xhw_kh2tpq",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "เครื่องใหม่",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:03:15.820Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqx02yq_5z2j7r",
                                           "type":  "expense",
                                           "date":  "2026-10-02",
                                           "amount":  749,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup59xhw_kh2tpq",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "3bb ลานข้าว",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:03:51.938Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqx0sww_8764d3",
                                           "type":  "expense",
                                           "date":  "2026-10-02",
                                           "amount":  632,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup59xhw_kh2tpq",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "3bb บ้านใหญ่",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:04:25.568Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqx3ufe_03bawq",
                                           "type":  "expense",
                                           "date":  "2026-10-02",
                                           "amount":  387,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_mup59bfy_929txl",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "อาหาร+ตัดผมฌอห์น+ของเล่นฌอห์น",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:06:47.498Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqx7f4a_qbkaoq",
                                           "type":  "income",
                                           "date":  "2026-10-02",
                                           "amount":  14,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_muqx76sr_onya5m",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ติดบวก",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:09:34.282Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqx8us8_pjqab8",
                                           "type":  "income",
                                           "date":  "2026-10-02",
                                           "amount":  18000,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_muqx8lgq_hcqvgo",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:10:41.240Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqxbc1z_65hc6g",
                                           "type":  "income",
                                           "date":  "2026-10-02",
                                           "amount":  100,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_muqx76sr_onya5m",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ลงเหรียญ  5",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:12:36.935Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mus1316p_imlr2r",
                                           "type":  "borrow",
                                           "date":  "2026-10-02",
                                           "amount":  100000,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "",
                                           "person":  "ตุ้ม",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "โอนให้พี่ลิกดเงินสด",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-03T06:45:54.241Z",
                                           "updatedAt":  "2026-10-03T06:46:21.675Z",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mus19rh8_0qambt",
                                           "type":  "income",
                                           "date":  "2026-10-03",
                                           "amount":  61,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_muqx76sr_onya5m",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-03T06:51:08.252Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mup0dc7v_tf9fyc",
                                           "type":  "income",
                                           "date":  "2026-10-01",
                                           "amount":  125562,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_sell",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "เหนียวปี",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T04:02:36.955Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfr3zy_f0mi3e",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  16348,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ปรังสด",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:13:13.726Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfs807_na4r68",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  50948,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "เหนียวปี",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:14:05.575Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupfxdnh_z2wclx",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  25739,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "มะลิ",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:18:06.173Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupg1hfe_l3l0w4",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  120,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "เบรค",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:21:17.690Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_mupg5rol_trajj8",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  96600,
                                           "walletId":  "wallet_mup1y0sd_g5yp1q",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ตักมะลิ",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:24:37.605Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muph44n4_xflnv5",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  125853,
                                           "walletId":  "wallet_mup1y0sd_g5yp1q",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ตักข้าว อุมารินทร์",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:51:20.704Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muph4ywk_3176lt",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  20293,
                                           "walletId":  "wallet_mup1y0sd_g5yp1q",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ตักข้าว ลัดลาวัลย์",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-01T11:51:59.924Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqwkmnx_5evljh",
                                           "type":  "expense",
                                           "date":  "2026-10-01",
                                           "amount":  221297,
                                           "walletId":  "wallet_mup1y0sd_g5yp1q",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ยกยอดยืมตุ้มตักข้าว",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T11:51:50.973Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqx57sl_8i1hj4",
                                           "type":  "expense",
                                           "date":  "2026-10-02",
                                           "amount":  48905,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "เหนียวปี",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:07:51.477Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqx5onl_wfqc38",
                                           "type":  "expense",
                                           "date":  "2026-10-02",
                                           "amount":  9175,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_buy",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "มะลิ",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:08:13.329Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       },
                                       {
                                           "id":  "tx_muqx9tyu_gtc9td",
                                           "type":  "income",
                                           "date":  "2026-10-02",
                                           "amount":  5194,
                                           "walletId":  "wallet_mup0aox9_vynfzl",
                                           "targetWalletId":  "",
                                           "categoryId":  "cat_rice_sell",
                                           "person":  "",
                                           "dueDate":  "",
                                           "status":  "open",
                                           "note":  "ปรังแห้ง",
                                           "tags":  [

                                                    ],
                                           "loanId":  "",
                                           "createdAt":  "2026-10-02T12:11:26.838Z",
                                           "updatedAt":  "",
                                           "createdBy":  "admin"
                                       }
                                   ]
              },
    "riceRecords":  {
                        "value":  [
                                      {
                                          "kind":  "sell",
                                          "date":  "2026-10-01",
                                          "note":  "",
                                          "riceType":  "มะลิใหม่",
                                          "party":  "องุ่น",
                                          "grossKg":  13230,
                                          "tareKg":  0,
                                          "netKg":  13230,
                                          "moisture":  0,
                                          "moistureStd":  15,
                                          "moistureKg":  0,
                                          "impurity":  0,
                                          "impurityKg":  0,
                                          "payKg":  13230,
                                          "pricePerTon":  19100,
                                          "subtotal":  252693,
                                          "otherDeduct":  0,
                                          "total":  252693,
                                          "phone":  "",
                                          "plate":  "แม่",
                                          "otherNote":  "",
                                          "paid":  false,
                                          "paidDate":  "",
                                          "walletId":  "wallet_muozucw2_cu5vxc",
                                          "id":  "rice_muqxnzon_i3c9wt",
                                          "billNo":  "S691001-001",
                                          "txId":  "",
                                          "createdAt":  "2026-10-02T12:22:27.431Z",
                                          "createdBy":  "admin",
                                          "updatedAt":  ""
                                      },
                                      {
                                          "kind":  "sell",
                                          "date":  "2026-10-02",
                                          "note":  "",
                                          "riceType":  "ปรังแห้ง",
                                          "party":  "ชาวนา",
                                          "grossKg":  5194,
                                          "tareKg":  0,
                                          "netKg":  5194,
                                          "moisture":  0,
                                          "moistureStd":  15,
                                          "moistureKg":  0,
                                          "impurity":  0,
                                          "impurityKg":  0,
                                          "payKg":  5194,
                                          "pricePerTon":  9800,
                                          "subtotal":  50901.2,
                                          "otherDeduct":  0,
                                          "total":  50901.2,
                                          "phone":  "",
                                          "plate":  "",
                                          "otherNote":  "",
                                          "paid":  true,
                                          "paidDate":  "2026-10-02",
                                          "walletId":  "wallet_mup0aox9_vynfzl",
                                          "id":  "rice_muqxryo4_62cj8v",
                                          "billNo":  "S691002-001",
                                          "txId":  "tx_muqxryo4_0wflzg",
                                          "createdAt":  "2026-10-02T12:25:32.740Z",
                                          "createdBy":  "admin",
                                          "updatedAt":  ""
                                      }
                                  ],
                        "Count":  2
                    }
};
