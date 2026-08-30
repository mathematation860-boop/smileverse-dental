// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom (the test environment react-scripts test uses) does not implement
// Element.scrollIntoView — ChatPanel calls it to auto-scroll to the latest
// message, which is real browser behavior, not something to remove. This
// is the standard no-op polyfill so component tests can render without
// throwing; it has no effect on the real app in a real browser.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoViewPolyfill() {};
}
