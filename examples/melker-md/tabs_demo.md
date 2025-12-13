# Tabs Demo

A demonstration of the tabs component in melker-block markdown format.

## Main Layout

```melker-block
+--App Tabs Demo----------------------------------+
| : c f                                           |
| +--title-------------------------------------+  |
| | type: text                                 |  |
| | text: Tabs Component Demo                  |  |
| | style: font-weight: bold; margin-bottom: 1 |  |
| +--------------------------------------------+  |
|                                                 |
| +--settings-tabs-----------------------------+  |
| | │ General* │ Advanced │ About │            |  |
| | +--general-content-----------------------+ |  |
| | +--advanced-content----------------------+ |  |
| | +--about-content-------------------------+ |  |
| +--------------------------------------------+  |
|                                                 |
| +--footer------------------------------------+  |
| | type: text                                 |  |
| | text: Use Tab to navigate, Enter to select |  |
| | style: margin-top: 1; color: gray          |  |
| +--------------------------------------------+  |
+-------------------------------------------------+
```

## Tab Content Components

### General Tab

```melker-block
+--general-content----------------------------------+
| +--general-title-------------------------------+  |
| | type: text                                   |  |
| | text: General Settings                       |  |
| +----------------------------------------------+  |
| +--general-desc--------------------------------+  |
| | type: text                                   |  |
| | text: Configure basic options here.          |  |
| +----------------------------------------------+  |
+---------------------------------------------------+
```

### Advanced Tab

```melker-block
+--advanced-content---------------------------------+
| +--advanced-title------------------------------+  |
| | type: text                                   |  |
| | text: Advanced Settings                      |  |
| +----------------------------------------------+  |
| +--advanced-desc-------------------------------+  |
| | type: text                                   |  |
| | text: Expert configuration options.          |  |
| +----------------------------------------------+  |
+---------------------------------------------------+
```

### About Tab

```melker-block
+--about-content------------------------------------+
| +--about-title---------------------------------+  |
| | type: text                                   |  |
| | text: About This App                         |  |
| +----------------------------------------------+  |
| +--about-desc----------------------------------+  |
| | type: text                                   |  |
| | text: Tabs Demo v1.0                         |  |
| +----------------------------------------------+  |
+---------------------------------------------------+
```
