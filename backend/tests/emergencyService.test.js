const { test } = require('node:test');
const assert = require('node:assert/strict');
const emergencyService = require('../services/emergencyService');

test('classifies life-threatening symptoms', () => {
  assert.equal(emergencyService.classifyUrgency("I can't breathe and my face is swollen"), 'life_threatening');
  assert.equal(emergencyService.classifyUrgency('My throat is closing up'), 'life_threatening');
  assert.equal(emergencyService.classifyUrgency('I have uncontrollable bleeding'), 'life_threatening');
});

test('classifies urgent (non-life-threatening) dental issues', () => {
  assert.equal(emergencyService.classifyUrgency('I have severe tooth pain'), 'urgent');
  assert.equal(emergencyService.classifyUrgency('I broke my tooth'), 'urgent');
  assert.equal(emergencyService.classifyUrgency('I need an emergency appointment'), 'urgent');
});

test('classifies ordinary messages as none', () => {
  assert.equal(emergencyService.classifyUrgency('What are your prices?'), 'none');
  assert.equal(emergencyService.classifyUrgency('I want to book a cleaning'), 'none');
});

test('combineUrgency picks the more severe of two labels', () => {
  assert.equal(emergencyService.combineUrgency('none', 'severe'), 'severe');
  assert.equal(emergencyService.combineUrgency('urgent', 'life_threatening'), 'life_threatening');
  assert.equal(emergencyService.combineUrgency('moderate', 'none'), 'moderate');
});
