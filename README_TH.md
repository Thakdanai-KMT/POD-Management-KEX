# POD Management System

ระบบจัดการงาน POD แบบใช้งานคนเดียวบน Browser เครื่องเดิม ใช้ React + TypeScript + Vite + IndexedDB (Dexie)

## คุณสมบัติ
- วางข้อมูลจาก Google Sheets ด้วย Copy & Paste เท่านั้น (ไม่มีการเชื่อมต่อ Google Sheets)
- รองรับ TSV จาก Clipboard และข้อความคั่นด้วย `|`
- ไม่มี Header ตามรูปแบบข้อมูลตัวอย่าง 15 คอลัมน์
- อ่านวันที่ `6/11/2026 16:25` เป็น 6 พฤศจิกายน 2026 (วัน/เดือน/ปี)
- แยก Pending / POD / ไม่สามารถ POD
- POD มีความสำคัญสูงสุด: เมื่อ Tracking เคย POD แล้วจะไม่ย้อนกลับอัตโนมัติ
- Tracking ซ้ำในรอบวางเดียวกัน: แถวสุดท้ายชนะ แต่ถ้ามีแถวใดเป็น POD ให้ POD ชนะ
- เริ่มรายการใหม่ตามวันที่ทำงาน แต่เก็บประวัติย้อนหลัง
- Export Excel, Backup/Restore JSON

## ติดตั้งบน Windows
1. ติดตั้ง Node.js LTS จาก https://nodejs.org/ (ถ้ายังไม่มี)
2. แตกไฟล์ ZIP
3. เปิด CMD ในโฟลเดอร์ `POD-Management`
4. รันคำสั่ง:

```cmd
npm install
npm run dev
```

5. เปิด URL ที่ Vite แสดง เช่น `http://localhost:5173`

## Build สำหรับทดสอบ
```cmd
npm run build
npm run preview
```

## รูปแบบข้อมูลนำเข้า (ไม่มี Header)
ค่าเริ่มต้นใช้ตำแหน่งคอลัมน์ตามข้อมูลที่ให้:
- 1 Tracking
- 2 Carrier
- 3 Code
- 4 วันที่ต้นทาง (วัน/เดือน/ปี)
- 5 POD Status
- 6 Remark
- 7 Priority
- 8 Payment
- 9 Ref
- 13 Amount
- 14 Due Date
- 15 Address

คอลัมน์ว่างระหว่างทางยังคงนับตำแหน่งไว้ ระบบมี Parser ที่อ่าน TSV หรือข้อความคั่นด้วย `|` ตามตัวอย่าง

## กติกาวันทำงานและประวัติ
- วันที่ทำงานเลือกได้จากตัวเลือกวันที่ด้านบน
- Import จะบันทึกเข้า Work Date ที่เลือก
- เมื่อเปลี่ยนวัน หน้ารายการจะแสดงเฉพาะวันนั้น
- ประวัติ Import และ Activity เก็บข้ามวัน
- หาก Tracking เคยเป็น POD ในประวัติวันใด วันต่อมาจะยังถือเป็น POD

## ข้อจำกัดและความปลอดภัย
- ข้อมูลอยู่ใน IndexedDB ของ Browser Profile นี้เท่านั้น ไม่ซิงก์ข้ามเครื่องหรือ Browser
- อย่าล้าง Site Data/Browser Data โดยไม่มี Backup
- แนะนำ Backup JSON เป็นประจำ
- ข้อมูลที่วางจะถูกประมวลผลใน Browser และไม่มีการส่งไป Backend
- Google Fonts ใน CSS เป็นการโหลดฟอนต์จากภายนอก หากต้องการออฟไลน์เต็มรูปแบบ ให้ลบ `@import` ใน `src/styles.css` แล้วใช้ฟอนต์ในเครื่อง

## หมายเหตุเรื่อง Column Mapping
ไฟล์นี้ตั้งค่าตำแหน่งตามตัวอย่าง 15 คอลัมน์ที่ให้มา (Tracking อยู่คอลัมน์แรก, Amount คอลัมน์ที่ 13 ฯลฯ) หากรูปแบบคอลัมน์ต้นทางเปลี่ยน ต้องปรับ `DEFAULT_MAP` ใน `src/parser.ts` ก่อนใช้งานจริง
