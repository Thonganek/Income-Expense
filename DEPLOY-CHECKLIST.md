# Checklist เปิดใช้งาน MoneyBook

ระบบนี้รองรับทั้ง HTML Standalone และ Google Apps Script Web App

## ทดสอบแบบ Standalone

1. เปิด `Index.html` ใน Browser
2. Login ด้วย `admin / admin1234`
3. ข้อมูลจะถูกบันทึกใน Browser ของเครื่องนั้น

## Deploy แบบ GAS + Google Sheet

1. สร้าง Google Sheet ใหม่
2. เปิด `Extensions > Apps Script`
3. สร้างไฟล์ให้ครบตามนี้ แล้ววางเนื้อหาจากโฟลเดอร์นี้
   - `code.gs`
   - `Index.html`
   - `appsscript.json` ผ่าน Project Settings > Show appsscript.json
4. เลือก function `setupSheet` แล้วกด Run หนึ่งครั้ง
5. กลับไปดู Google Sheet ต้องมีชีต `MM_Users`, `MM_Transactions` และชีตอื่น ๆ
6. กด `Deploy > New deployment > Web app`
7. ตั้งค่า
   - Execute as: `Me`
   - Who has access: เลือกตามการใช้งาน เช่น `Anyone` หรือ `Anyone with Google account`
8. เปิด Web app URL แล้ว login
   - Username: `admin`
   - Password: `admin1234`
9. (ไม่บังคับ) ถ้าต้องการข้อมูลตัวอย่างย้อนหลัง 1 เดือน ยอดเงินรวม 1,000,000 บาท ให้เลือก function `seedDemoData` แล้วกด Run
   หรือกดปุ่ม "ใส่ข้อมูลตัวอย่าง" ในแอปที่แท็บ รายละเอียด › ข้อมูล

## อัปเดตจากเวอร์ชันเก่า

- วางทับ `code.gs` และ `Index.html` แล้ว Deploy › Manage deployments › แก้ไข › New version
- **อย่ารัน `setupSheet()` ซ้ำ** เพราะจะล้างข้อมูลทั้งหมด คอลัมน์ใหม่ (`Kind`, `Goal` ในชีต `MM_Wallets`) จะถูกเติมให้เองตอนเข้าสู่ระบบครั้งถัดไป

## ย้ายข้อมูลจาก GitHub Pages เข้า Google Sheet

1. เปิด GitHub Pages ใน Browser ที่มีข้อมูลเดิม แล้วกด รายละเอียด › ข้อมูล › `ส่งออกไฟล์สำรอง (JSON)`
2. เปิด Web App URL ของ Apps Script ที่ผูกกับ Google Sheet แล้ว login ผู้บริหาร
3. กด รายละเอียด › ข้อมูล › `นำเข้าไฟล์สำรอง`
4. เลือกไฟล์ JSON ที่ได้จาก GitHub Pages ระบบจะนำเข้าทั้งธุรกรรมและบิลซื้อ-ขายข้าวลงชีต

## ให้ GitHub Pages กดบันทึกลง Google Sheet ได้

1. อัปเดต `code.gs` และ `Index.html` ใน Apps Script แล้ว Deploy › Manage deployments › แก้ไข › New version
2. คัดลอก Web App URL ที่ลงท้ายด้วย `/exec`
3. เปิด GitHub Pages แล้วไปที่ รายละเอียด › ข้อมูล › บันทึกลง Google Sheet
4. วาง Web App URL แล้วกด `บันทึกค่า`
5. กด `บันทึกลง Google Sheet ตอนนี้` หรือปุ่ม `บันทึก GS`

ถ้าต้องการให้ต้องมีรหัสก่อนรับข้อมูล ให้ตั้ง Script Property ชื่อ `MM_SYNC_KEY` ใน Apps Script แล้วใส่รหัสเดียวกันในช่อง `รหัส Sync`

## หมายเหตุระบบสต็อกข้าว

- ข้อมูลซื้อ-ขายข้าวอยู่ในชีต `MM_Rice`
- บิลซื้อ/ขายข้าวไม่สร้างรายการในบัญชีรายรับรายจ่าย (`MM_Transactions`)
- ราคาซื้อ/ขายใช้หน่วยบาทต่อกิโลกรัม

ในโหมด GAS ข้อมูลและรหัสผ่านจะอยู่ใน Google Sheet โดยรหัสผ่านอยู่ที่ชีต `MM_Users` คอลัมน์ `Password`

หลังเข้าใช้งานจริง แนะนำให้เปลี่ยนรหัสผ่านเริ่มต้นในชีต `MM_Users`
