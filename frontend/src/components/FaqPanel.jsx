import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useLanguage } from '../i18n/LanguageContext';

function FaqPanel({ onClose }) {
  const { t, language } = useLanguage();
  const [categories, setCategories] = useState([]);
  const [openCategory, setOpenCategory] = useState(null);
  const [openItem, setOpenItem] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getFaqs()
      .then((data) => setCategories(data || []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="sv-modal-overlay" role="dialog" aria-modal="true">
      <div className="sv-modal sv-faq-modal">
        <div className="sv-modal-header">
          <h3>❓ {t.faq.title}</h3>
          <button type="button" className="sv-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="sv-modal-body sv-faq-body">
          {loading && <p className="sv-loading-text">…</p>}
          {categories.map((cat) => {
            const isOpenCat = openCategory === cat.id;
            return (
              <div key={cat.id} className="sv-faq-category">
                <button
                  type="button"
                  className="sv-faq-category-header"
                  onClick={() => setOpenCategory(isOpenCat ? null : cat.id)}
                >
                  <span>{language === 'ur' ? cat.labelUr : cat.label}</span>
                  <span className="sv-faq-caret">{isOpenCat ? '−' : '+'}</span>
                </button>
                {isOpenCat && (
                  <div className="sv-faq-items">
                    {cat.items.map((item) => {
                      const isOpenQ = openItem === item.id;
                      return (
                        <div key={item.id} className="sv-faq-item">
                          <button
                            type="button"
                            className="sv-faq-question"
                            onClick={() => setOpenItem(isOpenQ ? null : item.id)}
                          >
                            {language === 'ur' ? item.questionUr : item.question}
                          </button>
                          {isOpenQ && (
                            <p className="sv-faq-answer">{language === 'ur' ? item.answerUr : item.answer}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default FaqPanel;
