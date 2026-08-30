import React, { useMemo, useState } from 'react';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Lightweight, dependency-free month calendar. `openDates` is the set of
 * bookable YYYY-MM-DD strings (from the availability API) — every other
 * day renders disabled. No external calendar library needed.
 */
function MiniCalendar({ openDates, selectedDate, onSelect }) {
  const openSet = useMemo(() => new Set(openDates), [openDates]);
  const today = useMemo(() => new Date(new Date().toDateString()), []);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today));

  const minMonth = startOfMonth(today);
  const maxMonth = useMemo(() => {
    if (!openDates.length) return startOfMonth(today);
    const lastOpen = new Date(`${openDates[openDates.length - 1]}T00:00:00`);
    return startOfMonth(lastOpen);
  }, [openDates, today]);

  const canGoPrev = viewMonth.getTime() > minMonth.getTime();
  const canGoNext = viewMonth.getTime() < maxMonth.getTime();

  const cells = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const leadingBlanks = first.getDay();
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    const list = [];
    for (let i = 0; i < leadingBlanks; i++) list.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      list.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day));
    }
    return list;
  }, [viewMonth]);

  return (
    <div className="sv-calendar">
      <div className="sv-calendar-nav">
        <button
          type="button"
          className="sv-calendar-nav-btn"
          disabled={!canGoPrev}
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="sv-calendar-month-label">
          {viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          className="sv-calendar-nav-btn"
          disabled={!canGoNext}
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="sv-calendar-grid sv-calendar-weekdays">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={`${w}-${i}`} className="sv-calendar-weekday">{w}</span>
        ))}
      </div>
      <div className="sv-calendar-grid">
        {cells.map((date, idx) => {
          if (!date) return <span key={`blank-${idx}`} className="sv-calendar-cell sv-calendar-blank" />;
          const dateStr = toDateStr(date);
          const isOpen = openSet.has(dateStr);
          const isSelected = dateStr === selectedDate;
          const isPast = date < today;
          return (
            <button
              type="button"
              key={dateStr}
              className={`sv-calendar-cell sv-calendar-day ${isOpen ? 'sv-calendar-open' : ''} ${isSelected ? 'sv-calendar-selected' : ''}`}
              disabled={!isOpen || isPast}
              onClick={() => onSelect(dateStr)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MiniCalendar;
