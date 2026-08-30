import React from 'react';
import AIReceptionist from './AIReceptionist';
import { LanguageProvider } from './i18n/LanguageContext';
import './App.css';

function App() {
  return (
    <div className="App">
      <LanguageProvider>
        <AIReceptionist />
      </LanguageProvider>
    </div>
  );
}

export default App;