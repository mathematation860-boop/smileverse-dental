# ⚡ Quick Start Guide - 5 منٹ میں شروع کریں

## 🔑 Step 1: Anthropic API Key حاصل کریں (2 منٹ)

1. جاؤ: https://console.anthropic.com
2. Sign Up کریں (یا Login کریں)
3. "API Keys" سیکشن میں جاؤ
4. "Create Key" کلک کریں
5. اپنی key کاپی کریں (بعد میں چاہیے ہوگی)

```
API Key کی شکل: sk-ant-xxxxxxxxxxxxxxxxxxxxx
```

---

## 🎯 Step 2: Backend Setup (2 منٹ)

### Windows/Mac/Linux میں:

```bash
# 1. Folder بنائیں
mkdir smileverse-backend
cd smileverse-backend

# 2. Node Project شروع کریں
npm init -y

# 3. Dependencies انسٹال کریں
npm install express cors @anthropic-ai/sdk dotenv

# 4. .env فائل بنائیں
# اپنے text editor میں .env نام کی فائل بنائیں اور لکھیں:
ANTHROPIC_API_KEY=sk-ant-xxxxx (اپنی key ڈالیں)
PORT=5000
NODE_ENV=development

# 5. server.js بنائیں
# اوپر دیا گیا server.js کوڈ اس فائل میں paste کریں

# 6. شروع کریں
node server.js
```

**اگر کامیاب ہو تو دیکھیں:**
```
🚀 SmileVerse Dental AI Receptionist Server
📍 Running on: http://localhost:5000
✅ Ready to accept connections!
```

---

## 🎨 Step 3: Frontend Setup (1 منٹ)

### نیا Terminal کھولیں (Backend کو چلتا رہنے دیں):

```bash
# 1. React App بنائیں
npx create-react-react frontend
cd frontend

# 2. Component فائل بنائیں
# اوپر دیا گیا ai_receptionist_with_backend.jsx
# src/AIReceptionist.jsx میں paste کریں

# 3. App.js بدلیں:
```

**src/App.js میں یہ لکھیں:**
```javascript
import AIReceptionist from './AIReceptionist';

function App() {
  return <AIReceptionist />;
}

export default App;
```

```bash
# 4. Frontend شروع کریں
npm start
```

---

## ✅ Testing (1 منٹ)

اب آپ کے پاس ہے:
- Backend: http://localhost:5000
- Frontend: http://localhost:3000

Frontend کھولیں اور:
1. "Hello" لکھیں
2. صرف "Cleaning price" لکھیں
3. Claude جواب دے گا!

---

## 🎉 Done!

آپ کے پاس ہے:
✅ Working AI Receptionist
✅ Real Claude API
✅ Appointment Booking
✅ Lead Capture
✅ Dashboard

---

## 🚨 Common Issues

### "Cannot connect to API"
```bash
# اگر یہ error آئے:
# 1. .env میں API key check کریں
# 2. Backend port 5000 پر چل رہا ہے؟
# 3. Backend restart کریں: Ctrl+C اور پھر node server.js
```

### "API key not found"
```bash
# .env فائل صحیح جگہ ہے؟
# backend folder میں ہونی چاہیے
ls .env  # یہ چلائیں
```

### "Module not found"
```bash
# Backend میں:
npm install

# Frontend میں:
npm install
```

---

## 📚 Files You Need

1. **server.js** (Backend)
   - Express server
   - Claude API integration
   - 4 endpoints

2. **ai_receptionist_with_backend.jsx** (Frontend)
   - React component
   - Chat UI
   - Forms

3. **.env** (Configuration)
   - ANTHROPIC_API_KEY
   - PORT
   - NODE_ENV

---

## 🚀 Next: Production

جب development میں کام کر رہی ہو تو:

1. Database add کریں (MongoDB/PostgreSQL)
2. SMS notifications (Twilio)
3. Email confirmations (Nodemailer)
4. Heroku/Vercel پر deploy کریں
5. Custom domain setup کریں

---

## 📞 Quick Help

**Backend نہیں چل رہا؟**
```bash
# Port 5000 استعمال ہو رہا ہے؟
# دوسری port آزمائیں
PORT=5001 node server.js
```

**API key error آ رہا ہے؟**
```bash
# .env اچھی طرح save ہے؟
# Backend restart کریں
```

**Frontend کنکٹ نہیں ہو رہا؟**
```bash
# Browser console میں error دیکھیں
# F12 دبائیں
```

---

## 🎯 Success Checklist

- [ ] Node.js installed
- [ ] API key حاصل کیا
- [ ] Backend folder بنایا
- [ ] npm install کیا
- [ ] .env بنایا (API key ڈالی)
- [ ] server.js paste کیا
- [ ] node server.js چلایا
- [ ] Frontend folder بنایا
- [ ] React component paste کیا
- [ ] App.js بدلا
- [ ] npm start چلایا
- [ ] Browser میں test کیا

---

**اب آپ تیار ہیں!** 🚀

کوئی سوال ہو تو پوچھیں!
