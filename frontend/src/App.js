import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AIReceptionist from './AIReceptionist';
import { LanguageProvider } from './i18n/LanguageContext';
import AdminApp from './admin/AdminApp';
import './App.css';

// Phase 3: the public receptionist widget is completely untouched — it's
// still the exact same component tree it always was, just now reached via
// a route instead of being the only thing App ever rendered. Everything
// admin-related lives under /admin and is a fully separate tree (its own
// CSS, its own auth context) so nothing here can affect the public site.
function PublicReceptionist() {
  return (
    <div className="App">
      <LanguageProvider>
        <AIReceptionist />
      </LanguageProvider>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<PublicReceptionist />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;