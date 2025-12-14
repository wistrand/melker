# Nested Tabs Demo

Demonstrates nested tab containers using melker-block format.

```melker-block
+--root Nested Tabs Demo-----------------------------+
| : c f                                              |
| +--outer-tabs------------------------------------+ |
| | │ Settings* │ Content │ Help │                 | |
| | +--settings-panel----------------------------+ | |
| | +--content-panel-----------------------------+ | |
| | +--help-panel--------------------------------+ | |
| +------------------------------------------------+ |
+----------------------------------------------------+
```

## Settings Panel (with nested tabs)

```melker-block
+--settings-panel------------------------------------+
| : c f                                              |
| +--"Application Settings"------------------------+ |
| +--settings-tabs---------------------------------+ |
| | │ General* │ Appearance │ Advanced │           | |
| | +--general-settings--------------------------+ | |
| | +--appearance-settings-----------------------+ | |
| | +--advanced-settings-------------------------+ | |
| +------------------------------------------------+ |
+----------------------------------------------------+
```

```melker-block
+--general-settings----------------------------------+
| : c 1                                              |
| +--"Username:"-----------------------------------+ |
| +--{settings-username}---------------------------+ |
| +--<checkbox> Enable notifications---------------+ |
| +--<checkbox> Auto-save--------------------------+ |
+----------------------------------------------------+
```

```melker-block
+--appearance-settings-------------------------------+
| : c 1                                              |
| +--"Theme:"--------------------------------------+ |
| +--<radio> Light---------------------------------+ |
| +--<radio> Dark----------------------------------+ |
| +--<radio> System--------------------------------+ |
| +--<checkbox> Use compact mode-------------------+ |
+----------------------------------------------------+
```

```melker-block
+--advanced-settings---------------------------------+
| : c 1                                              |
| +--"Debug Level:"--------------------------------+ |
| +--{debug-input}---------------------------------+ |
| +--<checkbox> Enable logging---------------------+ |
| +--<checkbox> Verbose output---------------------+ |
| +--[Reset to Defaults]---------------------------+ |
+----------------------------------------------------+
```

## Content Panel

```melker-block
+--content-panel-------------------------------------+
| : c 1 f                                            |
| +--"Main Content Area"---------------------------+ |
| +--"Select a tab above to view settings."--------+ |
+----------------------------------------------------+
```

## Help Panel (with nested tabs)

```melker-block
+--help-panel----------------------------------------+
| : c f                                              |
| +--help-tabs-------------------------------------+ |
| | │ FAQ* │ About │                               | |
| | +--faq-content-------------------------------+ | |
| | +--about-content-----------------------------+ | |
| +------------------------------------------------+ |
+----------------------------------------------------+
```

```melker-block
+--faq-content---------------------------------------+
| : c 1                                              |
| +--"Frequently Asked Questions"------------------+ |
| +--"Q: How do I change settings?"----------------+ |
| +--"A: Use the Settings tab above."-------------+ |
| +--"Q: Where are logs stored?"-------------------+ |
| +--"A: Check Advanced > Enable logging."---------+ |
+----------------------------------------------------+
```

```melker-block
+--about-content-------------------------------------+
| : c 1                                              |
| +--"Nested Tabs Demo"----------------------------+ |
| +--"Version: 1.0.0"------------------------------+ |
| +--"A demonstration of nested tab containers."---+ |
+----------------------------------------------------+
```

```typescript
// @melker handler #reset-to-defaults.onClick
const username = context.getElementById('settings-username');
const debugInput = context.getElementById('debug-input');
if (username) username.setValue('');
if (debugInput) debugInput.setValue('');
context.render();
```
