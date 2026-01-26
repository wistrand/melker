# Form Elements Demo

A simple demo showcasing buttons, inputs, radio buttons, and checkboxes.

```melker-block
+--root Form Demo------------------------------------+
| : c 1 f                                            |
| +--"User Registration"---------------------------+ |
| +--form------------------------------------------+ |
| | : c 1                                          | |
| | +--"Name:"-----------------------------------+ | |
| | +--{name-input}------------------------------+ | |
| | +--"Email:"----------------------------------+ | |
| | +--{email-input}-----------------------------+ | |
| | +--"Subscription:"---------------------------+ | |
| | +--<radio(subscription)> Free Plan-----------+ | |
| | +--<radio(subscription)> Pro Plan------------+ | |
| | +--<radio(subscription)> Enterprise----------+ | |
| | +--"Options:"--------------------------------+ | |
| | +--<checkbox> Receive newsletter-------------+ | |
| | +--<checkbox> Enable two-factor auth---------+ | |
| +------------------------------------------------+ |
| +--buttons---------------------------------------+ |
| | : r 1                                          | |
| | +--[Submit]--+ +--[Clear]--+ +--[Cancel]--+    | |
| +------------------------------------------------+ |
+----------------------------------------------------+
```

```typescript
// @melker handler #submit.onClick
const name = $melker.getElementById('name-input')?.getValue() ?? '';
const email = $melker.getElementById('email-input')?.getValue() ?? '';
if (!name || !email) {
  alert('Please fill in all fields');
  return;
}
alert('Submitted: ' + name + ' (' + email + ')');
```

```typescript
// @melker handler #clear.onClick
$melker.getElementById('name-input')?.setValue('');
$melker.getElementById('email-input')?.setValue('');
alert('Form cleared');
```

```typescript
// @melker handler #cancel.onClick
$melker.exit();
```
