import { render, screen } from '@testing-library/react';
import App from './App';

// This app renders the SmileVerse Dental AI receptionist, not the default
// create-react-app starter page, so this smoke test checks for the
// practice name from the default (offline-safe) practice config instead
// of the old "learn react" placeholder text.
test('renders the SmileVerse Dental practice name in the header', () => {
  render(<App />);
  const brandHeading = screen.getByRole('heading', { name: /SmileVerse Dental/i });
  expect(brandHeading).toBeInTheDocument();
});
