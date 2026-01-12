// Tests for component modules

import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  ContainerElement,
  InputElement,
  TextElement,
  ButtonElement,
  RadioElement,
  CheckboxElement,
  DialogElement,
  ContainerProps,
  InputProps,
  TextProps,
  ButtonProps,
  RadioProps,
  CheckboxProps,
  DialogProps,
} from '../src/components/mod.ts';

Deno.test('Element classes exist and can be instantiated', () => {
  const containerEl = new ContainerElement();
  const textInputEl = new InputElement();
  const textEl = new TextElement({ text: 'Test' });
  const buttonEl = new ButtonElement({ label: 'Test Button' });
  const radioEl = new RadioElement({ title: 'Test Radio', value: 'test' });
  const checkboxEl = new CheckboxElement({ title: 'Test Checkbox' });
  const dialogEl = new DialogElement();

  assertExists(containerEl);
  assertExists(textInputEl);
  assertExists(textEl);
  assertExists(buttonEl);
  assertExists(radioEl);
  assertExists(checkboxEl);
  assertExists(dialogEl);
});

Deno.test('Element classes have static validate methods', () => {
  assertExists(ContainerElement.validate);
  assertExists(InputElement.validate);
  assertExists(TextElement.validate);
  assertExists(ButtonElement.validate);
  assertExists(RadioElement.validate);
  assertExists(CheckboxElement.validate);
  assertExists(DialogElement.validate);
});

Deno.test('Container element creates valid elements', () => {
  const element = new ContainerElement({ width: 300, height: 200 });

  assertEquals(element.type, 'container');
  assertEquals(element.props.width, 300);
  assertEquals(element.props.height, 200);
  // Style defaults are provided by static getDefaultStyle(), not props.style
  const defaultStyle = ContainerElement.getDefaultStyle();
  assertEquals(defaultStyle.display, 'flex');
  assertEquals(defaultStyle.overflow, 'visible');
});

Deno.test('Container element validates props correctly', () => {
  assertEquals(ContainerElement.validate({ width: 100 }), true);
  assertEquals(ContainerElement.validate({ width: 'auto' }), true);
  assertEquals(ContainerElement.validate({ width: 'fill' }), true);

  assertEquals(ContainerElement.validate({ width: 'invalid' as any }), false);
});

Deno.test('Input element creates valid elements', () => {
  const element = new InputElement({ placeholder: 'Enter text', maxLength: 50 });

  assertEquals(element.type, 'input');
  assertEquals(element.props.placeholder, 'Enter text');
  assertEquals(element.props.maxLength, 50);
  assertEquals(element.props.value, ''); // Default prop
  assertEquals(element.props.readOnly, false); // Default prop
});

Deno.test('Input element validates props correctly', () => {
  assertEquals(InputElement.validate({ value: 'test' }), true);
  assertEquals(InputElement.validate({ maxLength: 100 }), true);
  assertEquals(InputElement.validate({ placeholder: 'hint' }), true);

  assertEquals(InputElement.validate({ value: 123 as any }), false);
  assertEquals(InputElement.validate({ maxLength: -1 }), false);
  assertEquals(InputElement.validate({ placeholder: 123 as any }), false);
});

Deno.test('TextOutput element creates valid elements', () => {
  const element = new TextElement({ text: 'Hello World', style: { textWrap: 'wrap' } });

  assertEquals(element.type, 'text');
  assertEquals(element.props.text, 'Hello World');
  assertEquals(element.props.style?.textWrap, 'wrap');
  assertEquals(element.props.disabled, false); // Default prop
});

Deno.test('TextOutput element validates props correctly', () => {
  assertEquals(TextElement.validate({ text: 'valid text' }), true);
  assertEquals(TextElement.validate({ text: 'test', style: { textWrap: 'wrap' } }), true);
  assertEquals(TextElement.validate({ text: 'test', style: { textWrap: 'nowrap' } }), true);

  assertEquals(TextElement.validate({ text: 123 as any }), false);
  assertEquals(TextElement.validate({ text: 'test', style: { textWrap: 'invalid' as any } }), false);
});

Deno.test('Button element creates valid elements', () => {
  const element = new ButtonElement({ label: 'Click Me', variant: 'primary' });

  assertEquals(element.type, 'button');
  assertEquals(element.props.label, 'Click Me');
  assertEquals(element.props.variant, 'primary');
  assertEquals(element.props.disabled, false); // Default prop
  assertEquals(element.props.tabIndex, 0); // Default prop
});

Deno.test('Button element validates props correctly', () => {
  assertEquals(ButtonElement.validate({ label: 'Valid Button' }), true);
  assertEquals(ButtonElement.validate({ label: 'Test', variant: 'primary' }), true);
  assertEquals(ButtonElement.validate({ label: 'Test', variant: 'secondary' }), true);
  assertEquals(ButtonElement.validate({ label: 'Test', variant: 'default' }), true);

  assertEquals(ButtonElement.validate({ label: '' }), false);
  assertEquals(ButtonElement.validate({ label: 123 as any }), false);
  assertEquals(ButtonElement.validate({ label: 'Test', variant: 'invalid' as any }), false);
});

Deno.test('Dialog element creates valid elements', () => {
  const child = new TextElement({ text: 'Dialog content' });
  const element = new DialogElement({ title: 'Confirmation', modal: true }, [child]);

  assertEquals(element.type, 'dialog');
  assertEquals(element.props.title, 'Confirmation');
  assertEquals(element.props.modal, true);
  assertEquals(element.props.backdrop, true); // Default prop
  assertEquals(element.children?.length || 0, 1);
  assertEquals(element.children?.[0], child);
});

Deno.test('Dialog element validates props correctly', () => {
  assertEquals(DialogElement.validate({ title: 'Valid Title' }), true);
  assertEquals(DialogElement.validate({ modal: true }), true);
  assertEquals(DialogElement.validate({ backdrop: false }), true);
  assertEquals(DialogElement.validate({}), true); // No props is valid

  assertEquals(DialogElement.validate({ title: 123 as any }), false);
  assertEquals(DialogElement.validate({ modal: 'invalid' as any }), false);
  assertEquals(DialogElement.validate({ backdrop: 'invalid' as any }), false);
});

Deno.test('Radio element creates valid elements', () => {
  const element = new RadioElement({ title: 'Test Radio', value: 'option1' });

  assertEquals(element.type, 'radio');
  assertEquals(element.props.title, 'Test Radio');
  assertEquals(element.props.value, 'option1');
  assertEquals(element.props.checked, false); // Default prop
  assertEquals(element.props.disabled, false); // Default prop
  assertEquals(element.props.tabIndex, 0); // Default prop
});

Deno.test('Radio element validates props correctly', () => {
  assertEquals(RadioElement.validate({ title: 'Valid', value: 'test' }), true);
  assertEquals(RadioElement.validate({ title: 'Valid', value: 123 }), true);
  assertEquals(RadioElement.validate({ title: 'Valid', value: 'test', checked: true }), true);
  assertEquals(RadioElement.validate({ title: 'Valid', value: 'test', name: 'group1' }), true);

  assertEquals(RadioElement.validate({ title: '', value: 'test' }), false);
  assertEquals(RadioElement.validate({ title: 123 as any, value: 'test' }), false);
  assertEquals(RadioElement.validate({ title: 'Valid' } as any), false); // Missing value
  assertEquals(RadioElement.validate({ title: 'Valid', value: 'test', checked: 'invalid' as any }), false);
  assertEquals(RadioElement.validate({ title: 'Valid', value: 'test', name: 123 as any }), false);
});

Deno.test('Radio element state management', () => {
  const element = new RadioElement({ title: 'Test', value: 'test' });

  // Test initial state
  assertEquals(element.isChecked(), false);

  // Test setting checked state
  element.setChecked(true);
  assertEquals(element.isChecked(), true);
  assertEquals(element.props.checked, true);

  // Test toggle
  element.toggle();
  assertEquals(element.isChecked(), false);
});

Deno.test('Checkbox element creates valid elements', () => {
  const element = new CheckboxElement({ title: 'Test Checkbox' });

  assertEquals(element.type, 'checkbox');
  assertEquals(element.props.title, 'Test Checkbox');
  assertEquals(element.props.checked, false); // Default prop
  assertEquals(element.props.indeterminate, false); // Default prop
  assertEquals(element.props.disabled, false); // Default prop
  assertEquals(element.props.tabIndex, 0); // Default prop
});

Deno.test('Checkbox element validates props correctly', () => {
  assertEquals(CheckboxElement.validate({ title: 'Valid' }), true);
  assertEquals(CheckboxElement.validate({ title: 'Valid', checked: true }), true);
  assertEquals(CheckboxElement.validate({ title: 'Valid', indeterminate: true }), true);

  assertEquals(CheckboxElement.validate({ title: '' }), false);
  assertEquals(CheckboxElement.validate({ title: 123 as any }), false);
  assertEquals(CheckboxElement.validate({ title: 'Valid', checked: 'invalid' as any }), false);
  assertEquals(CheckboxElement.validate({ title: 'Valid', indeterminate: 'invalid' as any }), false);
});

Deno.test('Checkbox element state management', () => {
  const element = new CheckboxElement({ title: 'Test' });

  // Test initial state
  assertEquals(element.isChecked(), false);
  assertEquals(element.isIndeterminate(), false);

  // Test setting checked state
  element.setChecked(true);
  assertEquals(element.isChecked(), true);
  assertEquals(element.isIndeterminate(), false);

  // Test setting indeterminate state
  element.setIndeterminate(true);
  assertEquals(element.isIndeterminate(), true);
  assertEquals(element.isChecked(), false);

  // Test toggle from indeterminate
  element.toggle();
  assertEquals(element.isChecked(), true);
  assertEquals(element.isIndeterminate(), false);

  // Test normal toggle
  element.toggle();
  assertEquals(element.isChecked(), false);
});

Deno.test('Element constructors work with children', () => {
  const textEl = new TextElement({ text: 'Test Text' });
  const buttonEl = new ButtonElement({ label: 'Test Button' });
  const containerEl = new ContainerElement({}, [textEl, buttonEl]);

  assertEquals(containerEl.children?.length || 0, 2);
  assertEquals(containerEl.children?.[0], textEl);
  assertEquals(containerEl.children?.[1], buttonEl);
  // Parent references removed
});

Deno.test('Element default props are applied', () => {
  const containerEl = new ContainerElement();
  const textInputEl = new InputElement();
  const textEl = new TextElement({ text: 'Test' });
  const buttonEl = new ButtonElement({ label: 'Test' });
  const dialogEl = new DialogElement();

  // Container style defaults are provided by static getDefaultStyle(), not props.style
  const defaultStyle = ContainerElement.getDefaultStyle();
  assertEquals(defaultStyle.display, 'flex');
  assertEquals(defaultStyle.overflow, 'visible');
  assertEquals(containerEl.props.scrollable, false);

  assertEquals(textInputEl.props.value, '');
  assertEquals(textInputEl.props.readOnly, false);
  assertEquals(textInputEl.props.disabled, false);

  assertEquals(textEl.props.style?.textWrap, undefined); // textWrap defaults to undefined (no wrap)
  assertEquals(textEl.props.disabled, false);

  assertEquals(buttonEl.props.variant, 'default');
  assertEquals(buttonEl.props.disabled, false);
  assertEquals(buttonEl.props.tabIndex, 0);

  assertEquals(dialogEl.props.modal, true);
  assertEquals(dialogEl.props.backdrop, true);
  assertEquals(dialogEl.props.disabled, false);
});