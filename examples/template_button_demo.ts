// Template Button Demo - Showcases button functionality using template literals
// Demonstrates fixed button sizing with HTML-style syntax

import {
  createApp,
  melker,
  getThemeColor,
  type ClickEvent,
  type KeyPressEvent,
} from '../mod.ts';

let engine: any;

function handleKeyPress(event: KeyPressEvent): void {
  if (event.key === 'Escape') {
    Deno.exit(0);
  }
}

function createButtonDemo() {
  const containerStyle = {
    width: 65,
    height: 18,
    display: 'flex',
    flexDirection: 'column',
    border: 'thin',
    borderColor: getThemeColor('primary'),
    padding: 2,
  };

  const headerStyle = {
    backgroundColor: getThemeColor('primary'),
    color: getThemeColor('surface'),
    fontWeight: 'bold',
    padding: 1,
    textAlign: 'center',
    marginBottom: 2,
  };

  const rowStyle = {
    display: 'flex',
    flexDirection: 'row',
    gap: 1,
    marginBottom: 2,
    border: 'thin',
    padding: 1,
  };

  return melker`
    <container id="main" style=${containerStyle}>
      <text style=${headerStyle}>🎯 Template Button Demo</text>

      <text style=${{ marginBottom: 1 }}>1. Default button sizing (no flex):</text>
      <container style=${rowStyle}>
        <button title="Button A" tabIndex=${1} />
        <button title="Button B" tabIndex=${2} />
        <button title="Button C" tabIndex=${3} />
      </container>

      <text style=${{ marginBottom: 1 }}>2. Buttons with flex: 1:</text>
      <container style=${rowStyle}>
        <button title="Button A" style=${{ flex: 1 }} tabIndex=${4} />
        <button title="Button B" style=${{ flex: 1 }} tabIndex=${5} />
        <button title="Button C" style=${{ flex: 1 }} tabIndex=${6} />
      </container>

      <text style=${{ marginBottom: 1 }}>3. Different content lengths (no flex):</text>
      <container style=${rowStyle}>
        <button title="Short" tabIndex=${7} />
        <button title="Medium Length" tabIndex=${8} />
        <button title="Very Long Button Text" tabIndex=${9} />
      </container>

      <text style=${{ marginTop: 1, color: getThemeColor('success'), fontWeight: 'bold' }}>✅ Buttons now size correctly in flex containers!</text>
      <text style=${{ color: getThemeColor('success'), fontWeight: 'bold' }}>✅ Template literals provide clean, HTML-like syntax!</text>
      <text style=${{ marginTop: 1 }}>Press Escape to exit</text>
    </container>
  `;
}

async function runButtonDemo() {
  console.log('=== Template Button Demo ===');
  console.log('Demonstrates fixed button sizing using template literal syntax');
  console.log('Compare different button sizing approaches:');
  console.log('1. Default buttons size to content');
  console.log('2. flex: 1 buttons distribute space evenly');
  console.log('3. Different content lengths handled correctly');
  console.log('');

  const ui = createButtonDemo();
  engine = await createApp(ui);

  // Add key handler for ESC to exit
  if (engine.addEventListener) {
    engine.addEventListener('keyPress', handleKeyPress);
  }

  console.log('Demo running. Press Escape to exit.');
}

runButtonDemo().catch(console.error);