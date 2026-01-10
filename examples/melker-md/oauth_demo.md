# OAuth2 PKCE Login Demo

Config via `json oauth` block - auto-initializes on startup.

Set environment variables before running: `OAUTH_WELLKNOWN`, `OAUTH_CLIENT_ID`, `OAUTH_AUDIENCE`.

```json oauth
{
  "wellknown": "${OAUTH_WELLKNOWN}",
  "clientId": "${OAUTH_CLIENT_ID}",
  "audience": "${OAUTH_AUDIENCE}",
  "autoLogin": true,
  "onLogin": "$app.onLoginCallback()",
  "onLogout": "$app.onLogoutCallback()",
  "onFail": "$app.onFailCallback(error)",
  "debugServer": "${OAUTH_DEBUG_SERVER:-true}"
}
```

## Scripts
- [oauth handlers](./oauth_handlers.ts)

## Main UI

```melker-block
+--app OAuth2 PKCE Login--+
| style: padding: 2;      |
|   height: fill          |
| : c                     |
| +--title--+             |
| +--status--+            |
| +--error--+             |
| +--tokenArea--+         |
| +--buttons--+           |
+-------------------------+
```

```melker-block
+--title------------------+
| type: text              |
| style: bold: true;      |
|   flex: 0 0 auto        |
| text: OAuth2 PKCE Login |
+-------------------------+
```

```melker-block
+--status-----------------+
| type: text              |
| style: flex: 0 0 auto   |
| text: Initializing...   |
+-------------------------+
```

```melker-block
+--error----------------------+
| type: text                  |
| style: color: red;          |
|   flex: 0 0 auto            |
+-----------------------------+
```

Token info display area.

```melker-block
+--tokenArea------------------------------+
| scrollable: true                        |
| style: flex: 1 1 0; overflow: scroll;   |
|   margin-top: 1; margin-bottom: 1;      |
|   border: thin                          |
| +--token-info--+                        |
+-----------------------------------------+
```

```melker-block
+--token-info-----------------------------+
| type: markdown                          |
| text: *No token information available*  |
+-----------------------------------------+
```

Button row.

```melker-block
+--buttons----------------------------+
| style: border: thin; flex: 0 0 auto |
| : r 2                               |
| +--btn-login--+                     |
| +--btn-refresh--+                   |
| +--btn-logout--+                    |
| +--btn-quit--+                      |
+-------------------------------------+
```

```melker-block
+--btn-login------------------------+
| type: button                      |
| title: Login                      |
| onClick: $app.onLogin()|
+-----------------------------------+
```

```melker-block
+--btn-refresh------------------------+
| type: button                        |
| title: Refresh                      |
| onClick: $app.onRefresh()|
| disabled: true                      |
+-------------------------------------+
```

```melker-block
+--btn-logout-------------------------+
| type: button                        |
| title: Logout                       |
| onClick: $app.onLogout() |
| disabled: true                      |
+-------------------------------------+
```

```melker-block
+--btn-quit--------------------------+
| type: button                       |
| title: Quit                        |
| onClick: $melker.exit()            |
+------------------------------------+
```
