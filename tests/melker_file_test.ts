// Tests for .melker file parsing

import { assertEquals, assertExists, assertThrows, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { parseMelkerFile } from '../src/template.ts';

// ============================================
// Simple .melker files (no wrapper, no scripts)
// ============================================

Deno.test('parseMelkerFile parses simple container', () => {
  const content = `
    <container style="width: 20; height: 10;">
      <text>Hello World</text>
    </container>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'container');
  assertEquals(result.scripts.length, 0);
  assertEquals(result.title, undefined);
});

Deno.test('parseMelkerFile parses container with style properties', () => {
  const content = `
    <container style="width: 50; height: 15; border: thin; padding: 2; display: flex; flex-direction: column;">
      <text>Test</text>
    </container>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'container');
  assertExists(result.element.props.style);
  assertEquals(result.element.props.style.width, 50);
  assertEquals(result.element.props.style.height, 15);
  assertEquals(result.element.props.style.border, 'thin');
  assertEquals(result.element.props.style.padding, 2);
  assertEquals(result.element.props.style.display, 'flex');
  assertEquals(result.element.props.style.flexDirection, 'column');
});

Deno.test('parseMelkerFile parses text element with content', () => {
  const content = `<text>Hello from Melker!</text>`;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'text');
  assertEquals(result.element.props.text, 'Hello from Melker!');
});

Deno.test('parseMelkerFile parses button with title', () => {
  const content = `<button title="Click Me!" style="background-color: blue;" />`;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'button');
  assertEquals(result.element.props.title, 'Click Me!');
});

Deno.test('parseMelkerFile parses nested children', () => {
  const content = `
    <container>
      <text>First</text>
      <text>Second</text>
      <container>
        <text>Nested</text>
      </container>
    </container>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'container');
  const children = result.element.children!;
  assertEquals(children.length, 3);
  assertEquals(children[0].type, 'text');
  assertEquals(children[0].props.text, 'First');
  assertEquals(children[1].type, 'text');
  assertEquals(children[1].props.text, 'Second');
  assertEquals(children[2].type, 'container');
  const nestedChildren = children[2].children!;
  assertEquals(nestedChildren.length, 1);
  assertEquals(nestedChildren[0].props.text, 'Nested');
});

Deno.test('parseMelkerFile parses input element', () => {
  const content = `
    <input id="myInput" placeholder="Enter text..." style="width: 20; border: thin;" />
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'input');
  assertEquals(result.element.props.id, 'myInput');
  assertEquals(result.element.props.placeholder, 'Enter text...');
});

Deno.test('parseMelkerFile parses element with id', () => {
  const content = `<text id="status">Ready</text>`;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'text');
  assertEquals(result.element.props.id, 'status');
  assertEquals(result.element.props.text, 'Ready');
});

// ============================================
// .melker files with <melker> wrapper (no scripts)
// ============================================

Deno.test('parseMelkerFile parses melker wrapper without scripts', () => {
  const content = `
    <melker>
      <container style="width: 40; height: 15;">
        <text>Content</text>
      </container>
    </melker>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'container');
  assertEquals(result.scripts.length, 0);
});

Deno.test('parseMelkerFile extracts title from melker wrapper', () => {
  const content = `
    <melker>
      <title>My App Title</title>
      <container>
        <text>Content</text>
      </container>
    </melker>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.title, 'My App Title');
  assertEquals(result.element.type, 'container');
});

// ============================================
// .melker files with scripts
// ============================================

Deno.test('parseMelkerFile extracts inline script', () => {
  const content = `
    <melker>
      <script type="typescript">
        const greeting = "Hello";
        exports = { greeting };
      </script>
      <container>
        <text>Content</text>
      </container>
    </melker>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.scripts.length, 1);
  assertEquals(result.scripts[0].type, 'typescript');
  assertStringIncludes(result.scripts[0].content, 'const greeting');
  assertStringIncludes(result.scripts[0].content, 'exports = { greeting }');
});

Deno.test('parseMelkerFile extracts script with default type', () => {
  const content = `
    <melker>
      <script>
        var x = 1;
      </script>
      <container>
        <text>Test</text>
      </container>
    </melker>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.scripts.length, 1);
  assertEquals(result.scripts[0].type, 'javascript'); // Default type
  assertStringIncludes(result.scripts[0].content, 'var x = 1');
});

Deno.test('parseMelkerFile extracts external script src', () => {
  const content = `
    <melker>
      <script type="typescript" src="./utils.ts"></script>
      <container>
        <text>Test</text>
      </container>
    </melker>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.scripts.length, 1);
  assertEquals(result.scripts[0].type, 'typescript');
  assertEquals(result.scripts[0].src, './utils.ts');
});

Deno.test('parseMelkerFile handles multiple scripts', () => {
  const content = `
    <melker>
      <script type="typescript">
        const fn1 = () => "first";
      </script>
      <script type="typescript">
        const fn2 = () => "second";
      </script>
      <container>
        <text>Test</text>
      </container>
    </melker>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.scripts.length, 2);
  assertStringIncludes(result.scripts[0].content, 'fn1');
  assertStringIncludes(result.scripts[1].content, 'fn2');
});

Deno.test('parseMelkerFile parses complex script with exports', () => {
  const content = `
    <melker>
      <script type="typescript">
        const formatMessage = (name) => {
          return "Hello, " + name;
        };

        const validate = (value) => {
          return value.length > 0;
        };

        exports = {
          formatMessage,
          validate
        };
      </script>
      <container style="width: 50; height: 20;">
        <text id="output">Ready</text>
        <button title="Click" />
      </container>
    </melker>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.scripts.length, 1);
  assertStringIncludes(result.scripts[0].content, 'formatMessage');
  assertStringIncludes(result.scripts[0].content, 'validate');
  assertStringIncludes(result.scripts[0].content, 'exports = {');

  assertEquals(result.element.type, 'container');
  assertEquals(result.element.children!.length, 2);
});

// ============================================
// Event handlers in .melker files
// ============================================

Deno.test('parseMelkerFile parses onClick handler', () => {
  const content = `
    <button
      title="Click Me"
      onClick="
        const el = context.getElementById('counter');
        el.props.text = 'Clicked!';
        context.render();
      "
    />
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'button');
  assertExists(result.element.props.onClick);
  // Event handlers are stored as { __isStringHandler: true, __handlerCode: string }
  const handler = result.element.props.onClick;
  assertEquals(handler.__isStringHandler, true);
  assertStringIncludes(handler.__handlerCode, 'context.getElementById');
});

Deno.test('parseMelkerFile parses onInput handler', () => {
  const content = `
    <input
      id="textInput"
      placeholder="Type..."
      onInput="
        const value = event.value;
        console.log(value);
      "
    />
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'input');
  assertExists(result.element.props.onInput);
  const handler = result.element.props.onInput;
  assertEquals(handler.__isStringHandler, true);
  assertStringIncludes(handler.__handlerCode, 'event.value');
});

Deno.test('parseMelkerFile parses onKeyPress handler', () => {
  const content = `
    <input
      id="keyInput"
      onKeyPress="
        if (event.key === 'Enter') {
          context.submit();
        }
      "
    />
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'input');
  assertExists(result.element.props.onKeyPress);
  const handler = result.element.props.onKeyPress;
  assertEquals(handler.__isStringHandler, true);
  assertStringIncludes(handler.__handlerCode, "event.key === 'Enter'");
});

// ============================================
// Color and style parsing
// ============================================

Deno.test('parseMelkerFile parses color styles', () => {
  const content = `
    <text style="color: red; background-color: blue;">
      Colored text
    </text>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.props.style.color, 'red');
  assertEquals(result.element.props.style.backgroundColor, 'blue');
});

Deno.test('parseMelkerFile parses hex color styles', () => {
  const content = `
    <text style="color: #00d9ff; background-color: #ff0000;">
      Hex colored
    </text>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.props.style.color, '#00d9ff');
  assertEquals(result.element.props.style.backgroundColor, '#ff0000');
});

// ============================================
// Error handling
// ============================================

Deno.test('parseMelkerFile throws on empty content', () => {
  assertThrows(
    () => parseMelkerFile(''),
    Error,
    'Empty melker file'
  );
});

Deno.test('parseMelkerFile throws on whitespace only', () => {
  assertThrows(
    () => parseMelkerFile('   \n\t  '),
    Error,
    'Empty melker file'
  );
});

Deno.test('parseMelkerFile throws on melker wrapper with no UI element', () => {
  const content = `
    <melker>
      <script type="typescript">
        const x = 1;
      </script>
    </melker>
  `;

  assertThrows(
    () => parseMelkerFile(content),
    Error,
    'No UI element found'
  );
});

// ============================================
// Special components
// ============================================

Deno.test('parseMelkerFile parses dialog element', () => {
  const content = `
    <dialog id="myDialog" title="Confirm" open="true" modal="true">
      <text>Are you sure?</text>
      <button title="OK" />
    </dialog>
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'dialog');
  assertEquals(result.element.props.id, 'myDialog');
  assertEquals(result.element.props.title, 'Confirm');
  assertEquals(result.element.children!.length, 2);
});

Deno.test('parseMelkerFile parses file-browser element', () => {
  const content = `
    <file-browser id="browser" path="/home" style="width: 40; height: 20;" />
  `;

  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'file-browser');
  assertEquals(result.element.props.id, 'browser');
  assertEquals(result.element.props.path, '/home');
});

// ============================================
// Integration with existing example files
// ============================================

Deno.test('parseMelkerFile parses hello.melker style', async () => {
  const content = await Deno.readTextFile('examples/melker/hello.melker');
  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'container');
  assertEquals(result.scripts.length, 0);
  // Should have children (text elements and button)
  assertEquals(result.element.children!.length > 0, true);
});

Deno.test('parseMelkerFile parses counter.melker with inline handlers', async () => {
  const content = await Deno.readTextFile('examples/melker/counter.melker');
  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'container');
  // counter.melker only has inline onClick handlers, no script tag
  assertEquals(result.scripts.length, 0);
});

Deno.test('parseMelkerFile parses script-demo.melker with scripts', async () => {
  const content = await Deno.readTextFile('examples/melker/script-demo.melker');
  const result = parseMelkerFile(content);

  assertEquals(result.element.type, 'container');
  assertEquals(result.scripts.length, 1);
  assertEquals(result.scripts[0].type, 'typescript');
  assertStringIncludes(result.scripts[0].content, 'formatMessage');
  assertStringIncludes(result.scripts[0].content, 'getCurrentTime');
  assertStringIncludes(result.scripts[0].content, 'validateName');
});
