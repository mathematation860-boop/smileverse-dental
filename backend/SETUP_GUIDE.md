# 🦷 SmileVerse Dental - AI Receptionist Setup Guide

مکمل سیٹ اپ گائیڈ | Complete Installation Guide

---

## 📋 Prerequisites

آپ کے پاس ہونا چاہیے:
You need:

1. **Node.js** (v16 or higher) - [Download](https://nodejs.org/)
2. **npm** (comes with Node.js)
3. **Anthropic API Key** - [Get from here](https://console.anthropic.com)
4. **Text Editor** (VS Code recommended)
5. **Terminal/Command Prompt**

---

## 🚀 Step 1: Backend Setup

### 1a. اپنی پروجیکٹ ڈائریکٹری بنائیں | Create Project Folder

```bash
mkdir smileverse-dental
cd smileverse-dental
```

### 1b. Backend فولڈر | Create Backend Folder

```bash
mkdir backend
cd backend
```

### 1c. Package.json بنائیں | Initialize Node Project

```bash
npm init -y
```

### 1d. Dependencies انسٹال کریں | Install Dependencies

```bash
npm install express cors @anthropic-ai/sdk dotenv
npm install --save-dev nodemon
```

### 1e. server.js کاپی کریں

- اوپر دیا گیا `server.js` کوپی کریں
- اپنے `backend` فولڈر میں پیسٹ کریں

### 1f. .env فائل بنائیں | Create .env File

```bash
# .env فائل بنائیں (backend folder میں)
# Create a file named .env

ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxx
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

**⚠️ IMPORTANT:**
- اپنی حقیقی API key ڈالیں | Replace with your real API key
- یہ فائل git میں شامل نہ کریں | Never commit this to git
- Anthropic console سے API key حاصل کریں | Get key from console.anthropic.com

### 1g. Backend شروع کریں | Start Backend

```bash
npm start
```

آپ کو یہ نظر آنا چاہیے:
You should see:
```
🚀 SmileVerse Dental AI Receptionist Server
📍 Running on: http://localhost:5000
✅ Ready to accept connections!
```

---

## 🎨 Step 2: Frontend Setup

### 2a. نیا Terminal/CMD کھولیں | Open New Terminal

(backend کو چلتا رہنے دیں | Keep backend running)

### 2b. React App بنائیں | Create React App

```bash
# اگر آپ پہلے سے project میں ہیں تو پہلے باہر آئیں
cd ..

# React app بنائیں
npx create-react-app frontend
cd frontend
```

### 2c. Component فائل بنائیں | Create Component

```bash
# src/AIReceptionist.jsx بنائیں
```

- اوپر دیا گیا `ai_receptionist_with_backend.jsx` کا کوڈ
- `src/AIReceptionist.jsx` میں پیسٹ کریں

### 2d. App.js میں شامل کریں | Update App.js

```javascript
// src/App.js میں یہ لکھیں:

import AIReceptionist from './AIReceptionist';
import './App.css';

function App() {
  return (
    <div>
      <AIReceptionist />
    </div>
  );
}

export default App;
```

### 2e. Frontend شروع کریں | Start Frontend

```bash
npm start
```

یہ خود بخود http://localhost:3000 کھل جائے گا
It will automatically open http://localhost:3000

---

## ✅ Testing

### 1. دونوں سرور چل رہے ہیں؟ | Both servers running?

```
Backend:  http://localhost:5000  ✅
Frontend: http://localhost:3000  ✅
```

### 2. API Status چیک کریں | Check API Status

- Frontend میں اوپر دیکھیں
- ستارہ دیکھنا چاہیے: ✅ API Connected

### 3. Test کریں | Test the System

1. Chat میں کچھ لکھیں
2. "Cleaning price kya hai?" لکھیں
3. Claude جواب دے گا

---

## 🔧 Environment Variables

### Backend (.env file)

```env
# Required
ANTHROPIC_API_KEY=your_key_here

# Optional
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

### Frontend (.env file)

```env
# Optional - اگر backend دوسری جگہ ہو تو
REACT_APP_API_URL=http://localhost:5000
```

---

## 📱 API Endpoints

### Chat Endpoint
```
POST /api/chat
Body: {
  conversationId: "conv_123",
  message: "Appointment booking kaise kartey hain?",
  history: [...]
}
Response: {
  success: true,
  message: "Claude ka response...",
  conversationId: "conv_123"
}
```

### Clinic Info
```
GET /api/clinic-info
Response: {
  name: "SmileVerse Dental",
  hours: "9 AM - 5 PM",
  services: [...],
  ...
}
```

### Book Appointment
```
POST /api/appointments
Body: {
  name: "Patient Name",
  phone: "+1-555-0123",
  service: "Cleaning",
  date: "2024-01-15",
  time: "10:00 AM"
}
```

### Save Lead
```
POST /api/leads
Body: {
  name: "Patient Name",
  phone: "+1-555-0123",
  email: "patient@email.com",
  message: "Optional message"
}
```

---

## 🐛 Troubleshooting

### "Cannot connect to API"
- Backend چل رہا ہے؟ | Is backend running?
- Port 5000 استعمال ہو رہا ہے؟ | Is port 5000 in use?
- .env میں API key صحیح ہے؟ | Is API key correct?

### "API key not found"
- .env فائل موجود ہے؟ | Is .env file created?
- ANTHROPIC_API_KEY سیٹ ہے؟ | Is API key set?
- Backend restart کریں | Restart backend

### "CORS error"
- CORS_ORIGIN صحیح ہے؟ | Is CORS_ORIGIN correct?
- Frontend URL match کر رہا ہے؟ | Does frontend URL match?

### "Cannot find module"
```bash
# Backend میں
npm install

# Frontend میں  
npm install
```

---

## 🚀 Production Deployment

### Backend Deployment (Heroku مثال)

```bash
# 1. Heroku Account بنائیں
# 2. Heroku CLI انسٹال کریں
# 3. Backend folder میں:

heroku create your-app-name
heroku config:set ANTHROPIC_API_KEY=your_key
git push heroku main
```

### Frontend Deployment (Vercel مثال)

```bash
# Frontend folder میں:
npm run build
# Vercel پر deploy کریں یا Netlify پر
```

### Database Setup (Future)

ابھی in-memory storage استعمال ہو رہی ہے۔
اگر production میں جانا ہو تو:

1. MongoDB یا PostgreSQL سیٹ اپ کریں
2. `server.js` میں database queries شامل کریں
3. CONNECTION STRING .env میں ڈالیں

---

## 📊 Features Included

✅ AI Chat (Claude Powered)
✅ Appointment Booking
✅ Lead Capture
✅ Real-time Dashboard
✅ Urdu + English Support
✅ Clinic Information
✅ Services & Pricing
✅ Contact Management

---

## 🔐 Security Notes

1. API keys کو کبھی frontend میں expose نہ کریں
2. Production میں HTTPS استعمال کریں
3. CORS properly configure کریں
4. Database credentials محفوظ رکھیں
5. Regular updates رکھیں

---

## 📚 Further Customization

### 1. Clinic Information بدلیں
`server.js` میں `clinicInfo` object edit کریں

### 2. System Prompt بدلیں
`server.js` میں `systemPrompt` edit کریں

### 3. Database شامل کریں
MongoDB/PostgreSQL connect کریں

### 4. SMS Notifications
Twilio integration شامل کریں

### 5. Email Confirmations
Nodemailer setup کریں

---

## 🎓 Learning Resources

- [Express.js Docs](https://expressjs.com/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [React Docs](https://react.dev/)
- [Node.js Docs](https://nodejs.org/docs/)

---

## 💬 Need Help?

1. Console میں errors دیکھیں
2. .env file check کریں
3. API key valid ہے check کریں
4. Ports conflict check کریں

---

## 📝 Next Steps

1. ✅ Backend اور Frontend چلائیں
2. 🧪 مختلف سوالات کے ساتھ test کریں
3. 🎨 Design اپنی ضرورت سے بدلیں
4. 💾 Database شامل کریں
5. 🚀 Production میں deploy کریں

---

## License

MIT License - Feel free to use and modify!

---

**Happy Coding! 🚀** 
**خوشی سے کوڈنگ کریں!**

Last Updated: 2024
