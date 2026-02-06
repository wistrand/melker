// Melker Server UI JavaScript

let ws = null;
let currentBuffer = null;
let documentTree = null;
let selectedElement = null;
let focusedElement = null;
let connectionRetryCount = 0;
let maxRetries = 10;
let eventInjectionEnabled = false;
let collapsedNodes = new Set(); // Track collapsed nodes by ID
let logEntries = []; // Store log entries
const maxLogEntries = 500; // Maximum log entries to keep
const logLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
let pendingBufferRequest = false; // Prevent duplicate buffer requests

// WebSocket connection management
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const wsUrl = `${protocol}//${window.location.host}/?token=${token}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connectionRetryCount = 0;
    updateConnectionStatus(true);

    // Subscribe to render notifications (push-based updates, no polling needed)
    subscribe(['render-notifications', 'engine-state', 'terminal-resize', 'log-stream']);

    // Get initial data only once
    refreshView();
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleMessage(message);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  };

  ws.onclose = () => {
    updateConnectionStatus(false);
    stopAutoRefresh();

    // Retry connection with exponential backoff
    if (connectionRetryCount < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, connectionRetryCount), 10000);
      connectionRetryCount++;
      setTimeout(connect, delay);
    } else {
      console.error('Max connection retries reached');
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateConnectionStatus(false);
  };
}

function handleMessage(message) {
  switch (message.type) {
    case 'buffer-snapshot':
      pendingBufferRequest = false;
      if (message.data) {
        currentBuffer = message.data;
        renderTerminalView();
      }
      break;
    case 'buffer-snapshot-rle':
      pendingBufferRequest = false;
      if (message.data) {
        currentBuffer = decodeRLESnapshot(message.data);
        renderTerminalView();
      }
      break;
    case 'buffer-delta':
      pendingBufferRequest = false;
      if (message.data && currentBuffer) {
        applyBufferDelta(message.data);
        renderTerminalView();
      }
      break;
    case 'document-tree':
      documentTree = message.data;
      renderDocumentTree();
      break;
    case 'engine-state':
      if (message.data) {
        if (message.data.focusedElement) {
          focusedElement = message.data.focusedElement;
          highlightFocusedElement();
        }
        updateState(message.data);
      }
      break;
    case 'render-notifications-update':
      // Request buffer only if not already pending (prevents duplicate requests)
      if (!pendingBufferRequest) {
        pendingBufferRequest = true;
        send({ type: 'get-buffer' });
      }
      // Refresh element bounds if an element is selected (bounds may have changed)
      if (selectedElement) {
        send({ type: 'get-element-bounds', data: { elementId: selectedElement } });
      }
      break;
    case 'terminal-resize-update':
      // Refresh the view when terminal is resized
      send({ type: 'get-buffer' });
      send({ type: 'get-document-tree' });
      break;
    case 'log-stream-update':
      // Log entry received from server
      if (message.data) {
        addLogEntry(message.data);
      }
      break;
    case 'welcome':
      eventInjectionEnabled = message.data?.capabilities?.eventInjection || false;
      // Update input status indicator
      const inputStatus = document.getElementById('inputStatus');
      if (inputStatus) {
        if (eventInjectionEnabled) {
          inputStatus.textContent = 'Input: Enabled';
          inputStatus.className = 'input-status enabled';
        } else {
          inputStatus.textContent = 'Input: Disabled';
          inputStatus.className = 'input-status disabled';
        }
      }
      break;
    case 'response':
      // Handle specific response types based on data content
      if (message.data && message.data.elementId !== undefined && message.data.hasOwnProperty('bounds')) {
        // Element bounds response
        handleElementBoundsResponse(message.data);
      } else if (message.data && message.data.hasOwnProperty('element') && message.data.hasOwnProperty('x') && message.data.hasOwnProperty('y')) {
        // Element at coordinates response (mouse tracking)
        handleElementAtResponse(message.data);
      }
      break;
    case 'error':
      console.error('Server error:', message.data);
      break;
    default:
      break;
  }
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  } else {
    return false;
  }
}

function subscribe(types) {
  if (send({ type: 'subscribe', data: { subscriptions: types } })) {
    // Subscribed to update types
  }
}

function refreshView() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    pendingBufferRequest = true;
    send({ type: 'get-buffer' });
    send({ type: 'get-document-tree' });
    send({ type: 'get-engine-state' });
    return true;
  }
  return false;
}

// No-op: using push-based updates via subscriptions
function stopAutoRefresh() {}

function applyBufferDelta(delta) {
  // Apply compact delta: { styles: [...], rows: { y: [[x, char, styleIdx], ...] } }
  if (!delta.styles || !delta.rows || !currentBuffer) return;

  const styles = delta.styles;
  for (const [rowStr, cells] of Object.entries(delta.rows)) {
    const y = parseInt(rowStr, 10);
    if (y >= currentBuffer.height) continue;

    for (const cell of cells) {
      const [x, char, styleIdx] = cell;
      if (x >= currentBuffer.width) continue;

      const style = styles[styleIdx] || {};
      currentBuffer.content[y][x] = char;
      currentBuffer.styles[y][x] = {
        fg: style.f,
        bg: style.b,
        bold: style.o,
        dim: style.d,
        italic: style.i,
        underline: style.u,
        strikethrough: style.s,
        inverse: style.v
      };
    }
  }
}

function decodeRLESnapshot(rleData) {
  // Decode RLE-compressed buffer snapshot
  // Server format: { width, height, styles: [...], rows: { "y": [[startX, runLength, char, styleIndex], ...] } }
  const { width, height, styles, rows } = rleData;

  // Initialize arrays
  const content = [];
  const styleData = [];

  for (let y = 0; y < height; y++) {
    // Pre-fill row with spaces
    const rowContent = new Array(width).fill(' ');
    const rowStyles = new Array(width).fill({});
    const rleRow = rows[y] || [];

    for (const run of rleRow) {
      // Server format: [startX, runLength, char, styleIndex]
      const [startX, runLength, char, styleIdx] = run;
      const style = styles[styleIdx] || {};

      for (let i = 0; i < runLength && startX + i < width; i++) {
        rowContent[startX + i] = char;
        rowStyles[startX + i] = {
          fg: style.f,
          bg: style.b,
          bold: style.o,
          dim: style.d,
          italic: style.i,
          underline: style.u,
          strikethrough: style.s,
          inverse: style.v
        };
      }
    }

    content.push(rowContent);
    styleData.push(rowStyles);
  }

  return { width, height, content, styles: styleData };
}

function updateConnectionStatus(connected) {
  const indicator = document.getElementById('statusIndicator');
  const text = document.getElementById('statusText');
  if (indicator && text) {
    indicator.classList.toggle('connected', connected);
    text.textContent = connected ? 'Connected' : 'Disconnected';
  }
  updateConnectionState(connected);
}

function renderTerminalView() {
  const container = document.getElementById('terminalContent');
  if (!container || !currentBuffer) return;

  // Invalidate cached character dimensions (will be re-measured on next highlight)
  measuredCharWidth = null;
  measuredLineHeight = null;

  const { width, height, content, styles } = currentBuffer;
  let html = '';

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const char = content[y][x] || ' ';
      const style = styles[y][x] || {};

      let cssStyle = '';
      if (style.fg) cssStyle += `color: ${style.fg}; `;
      if (style.bg) cssStyle += `background-color: ${style.bg}; `;
      if (style.bold) cssStyle += 'font-weight: bold; ';
      if (style.dim) cssStyle += 'opacity: 0.5; ';
      if (style.italic) cssStyle += 'font-style: italic; ';
      if (style.underline) cssStyle += 'text-decoration: underline; ';
      if (style.strikethrough) cssStyle += 'text-decoration: line-through; ';
      if (style.inverse) cssStyle += 'filter: invert(1); ';

      const escapedChar = char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : char;
      html += `<span class="terminal-char" style="${cssStyle}" data-x="${x}" data-y="${y}">${escapedChar}</span>`;
    }
    html += '\n';
  }

  container.innerHTML = html;
}

// Mouse tracking state
let mouseTrackingEnabled = false;
let lastTrackedElement = null;
let currentElementBounds = null;
let mouseTrackThrottleTimer = null;
const MOUSE_TRACK_THROTTLE_MS = 50; // Throttle to ~20 requests/second max

function toggleMouseTracking() {
  const checkbox = document.getElementById('trackMouseToggle');
  const statusSpan = document.getElementById('trackingStatus');
  mouseTrackingEnabled = checkbox?.checked || false;

  if (statusSpan) {
    statusSpan.style.display = mouseTrackingEnabled ? 'inline-block' : 'none';
  }

  // Show/hide hovered section
  const hoveredSection = document.getElementById('hoveredSection');
  if (hoveredSection) {
    hoveredSection.style.display = mouseTrackingEnabled ? 'block' : 'none';
  }

  if (!mouseTrackingEnabled) {
    hideHighlight();
    lastTrackedElement = null;
  }
}

function handleTerminalMouseMove(event) {
  // Always update coordinates display
  updateMouseCoords(event);

  // Only track element if enabled
  if (!mouseTrackingEnabled) return;

  // Throttle server requests
  if (mouseTrackThrottleTimer) return;

  mouseTrackThrottleTimer = setTimeout(() => {
    mouseTrackThrottleTimer = null;
  }, MOUSE_TRACK_THROTTLE_MS);

  const { x, y } = getClickCoords(event);

  // Request element at coordinates from server
  send({
    type: 'get-element-at',
    data: { x, y }
  });
}

function handleTerminalMouseLeave() {
  if (mouseTrackingEnabled) {
    hideHighlight();
    lastTrackedElement = null;
    const hoveredInfo = document.getElementById('hoveredInfo');
    if (hoveredInfo) {
      hoveredInfo.textContent = '-';
    }
  }
}

function handleElementAtResponse(data) {
  const { element, x, y } = data;

  // Check if this is a response to a shift-click inspect request
  const isInspectRequest = pendingInspectCoords &&
    pendingInspectCoords.x === x &&
    pendingInspectCoords.y === y;

  if (isInspectRequest) {
    pendingInspectCoords = null;
    if (element && element.id) {
      // Switch to Elements tab and reveal the element
      switchTab('elements');
      revealElementInTree(element.id);
      selectElement(element.id);
      // Show highlight
      if (element.bounds) {
        showHighlight(element.bounds, element);
      }
    }
    return;
  }

  if (!element) {
    hideHighlight();
    lastTrackedElement = null;
    const hoveredInfo = document.getElementById('hoveredInfo');
    if (hoveredInfo) {
      hoveredInfo.textContent = '-';
    }
    return;
  }

  // Update hovered info in Elements panel
  const hoveredInfo = document.getElementById('hoveredInfo');
  if (hoveredInfo) {
    const idStr = element.id ? `#${element.id}` : '';
    hoveredInfo.innerHTML = `<span style="color:#569cd6">${element.type}</span>${idStr}`;
  }

  // Show highlight and tooltip if bounds are provided
  if (element.bounds) {
    showHighlight(element.bounds, element);
  }

  lastTrackedElement = element;
}

// Reveal an element in the tree by expanding all ancestors
function revealElementInTree(elementId) {
  if (!documentTree || !documentTree.tree) return;

  // Find the path to the element
  const path = findPathToElement(documentTree.tree, elementId, []);
  if (!path) return;

  // Expand all ancestors (except the element itself)
  for (let i = 0; i < path.length - 1; i++) {
    const ancestorId = path[i];
    collapsedNodes.delete(ancestorId);
  }

  // Re-render the tree
  renderDocumentTree();

  // Scroll the element into view
  setTimeout(() => {
    const nodeEl = document.querySelector(`[data-element-id="${elementId}"]`);
    if (nodeEl) {
      nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 50);
}

// Find the path from root to a specific element
function findPathToElement(node, targetId, currentPath) {
  if (!node) return null;

  const newPath = [...currentPath, node.id];

  if (node.id === targetId) {
    return newPath;
  }

  if (node.children) {
    for (const child of node.children) {
      const result = findPathToElement(child, targetId, newPath);
      if (result) return result;
    }
  }

  return null;
}

function handleElementBoundsResponse(data) {
  const { elementId, bounds } = data;

  // Handle hover highlight from tree
  if (elementId === pendingTreeHoverElement && bounds) {
    showHighlight(bounds);
    return;
  }

  // Handle selected element bounds
  if (elementId === selectedElement && bounds) {
    currentElementBounds = bounds;
    showHighlight(bounds);
  }
}

// Cache measured character dimensions
let measuredCharWidth = null;
let measuredLineHeight = null;

function measureCharDimensions() {
  // Try to measure from an actual terminal character
  const charEl = document.querySelector('.terminal-char');
  if (charEl) {
    const rect = charEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      measuredCharWidth = rect.width;
      measuredLineHeight = rect.height;
      return;
    }
  }

  // Fallback: create a measurement element
  const container = document.getElementById('terminalView');
  if (!container) return;

  const measureEl = document.createElement('span');
  measureEl.className = 'terminal-char';
  measureEl.style.visibility = 'hidden';
  measureEl.style.position = 'absolute';
  measureEl.textContent = 'X';
  container.appendChild(measureEl);

  const rect = measureEl.getBoundingClientRect();
  measuredCharWidth = rect.width || 8.4;
  measuredLineHeight = rect.height || 16.8;

  container.removeChild(measureEl);
}

function showHighlight(bounds, elementInfo = null) {
  const highlight = document.getElementById('highlight');
  const tooltip = document.getElementById('elementTooltip');
  const container = document.getElementById('terminalView');

  if (!highlight || !container) return;

  // Measure character dimensions if not cached
  if (!measuredCharWidth || !measuredLineHeight) {
    measureCharDimensions();
  }

  const charWidth = measuredCharWidth || 8.4;
  const lineHeight = measuredLineHeight || 16.8;
  const padding = 8; // Container padding from CSS

  const left = bounds.x * charWidth + padding;
  const top = bounds.y * lineHeight + padding;
  const width = bounds.width * charWidth;
  const height = bounds.height * lineHeight;

  highlight.style.display = 'block';
  highlight.style.left = `${left}px`;
  highlight.style.top = `${top}px`;
  highlight.style.width = `${width}px`;
  highlight.style.height = `${height}px`;

  // Show tooltip if element info is provided (mouse tracking)
  if (tooltip && elementInfo) {
    const idStr = elementInfo.id ? `<span class="tooltip-id">#${elementInfo.id}</span>` : '';
    const boundsStr = `<div class="tooltip-bounds">${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}</div>`;
    tooltip.innerHTML = `<span class="tooltip-type">${elementInfo.type}</span>${idStr}${boundsStr}`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top + height + 4}px`;
  }
}

function hideHighlight() {
  const highlight = document.getElementById('highlight');
  const tooltip = document.getElementById('elementTooltip');

  if (highlight) {
    highlight.style.display = 'none';
  }
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}

function renderDocumentTree() {
  const container = document.getElementById('documentTree');
  if (!container || !documentTree || !documentTree.tree) {
    if (container) container.innerHTML = 'No document loaded';
    return;
  }

  const html = renderNode(documentTree.tree, 0);
  container.innerHTML = html;
}

function renderNode(node, depth) {
  if (!node) return '';

  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapsedNodes.has(node.id);
  const isSelected = selectedElement === node.id;
  const isFocused = focusedElement === node.id;

  // Build props display
  let propsStr = '';
  if (node.id) propsStr += ` id="${node.id}"`;
  if (node.props) {
    const relevantProps = ['label', 'text', 'value', 'placeholder', 'title'];
    for (const prop of relevantProps) {
      if (node.props[prop]) {
        const val = String(node.props[prop]).substring(0, 20);
        propsStr += ` ${prop}="${val}"`;
      }
    }
  }

  let nodeClass = 'tree-node';
  if (isSelected) nodeClass += ' selected';
  if (isFocused) nodeClass += ' focused';

  // Use padding-left for indentation (12px per depth level)
  const indentPx = depth * 12;
  let html = `<div class="${nodeClass}" data-element-id="${node.id || ''}" onclick="selectElement('${node.id || ''}', event)" onmouseenter="highlightTreeElement('${node.id || ''}')" onmouseleave="unhighlightTreeElement()" style="padding-left: ${indentPx}px;">`;

  if (hasChildren) {
    const icon = isCollapsed ? '▶' : '▼';
    html += `<span class="tree-icon" onclick="toggleNode('${node.id}')">${icon}</span>`;
  } else {
    html += `<span class="tree-icon">○</span>`;
  }

  html += `<span class="tree-label">${node.type}</span>`;
  if (propsStr) {
    html += `<span class="tree-props">${escapeHtml(propsStr)}</span>`;
  }
  html += '</div>';

  if (hasChildren) {
    const childrenClass = isCollapsed ? 'tree-children collapsed' : 'tree-children';
    html += `<div class="${childrenClass}" id="children-${node.id}">`;
    for (const child of node.children) {
      html += renderNode(child, depth + 1);
    }
    html += '</div>';
  }

  return html;
}

function selectElement(elementId, event) {
  if (event) event.stopPropagation();
  if (!elementId) return;

  selectedElement = elementId;

  // Update tree selection visual
  document.querySelectorAll('.tree-node').forEach(node => {
    node.classList.toggle('selected', node.dataset.elementId === elementId);
  });

  // Show element details
  showElementDetails(elementId);

  // Request element bounds for highlighting
  send({ type: 'get-element-bounds', data: { elementId } });
}

// Track pending tree hover highlight request
let pendingTreeHoverElement = null;

function highlightTreeElement(elementId) {
  if (!elementId) return;

  // Don't highlight if this element is already selected (it's already highlighted)
  if (elementId === selectedElement) return;

  pendingTreeHoverElement = elementId;
  send({ type: 'get-element-bounds', data: { elementId, isHover: true } });
}

function unhighlightTreeElement() {
  pendingTreeHoverElement = null;

  // If there's a selected element, restore its highlight
  if (selectedElement && currentElementBounds) {
    showHighlight(currentElementBounds);
  } else {
    hideHighlight();
  }
}

function showElementDetails(elementId) {
  // Show element details in the details panel
  const detailsPanel = document.getElementById('elementDetails');
  const selectedInfo = document.getElementById('selectedInfo');

  if (!detailsPanel || !selectedInfo) return;

  // Find the element in the document tree
  let elementInfo = findElementInTree(documentTree?.tree, elementId);

  if (elementInfo) {
    let html = `<strong>ID:</strong> ${elementId}<br>`;
    html += `<strong>Type:</strong> ${elementInfo.type}<br>`;

    if (elementInfo.props && Object.keys(elementInfo.props).length > 0) {
      html += '<strong>Props:</strong><br>';
      for (const [key, value] of Object.entries(elementInfo.props)) {
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        html += `  <span style="color:#9cdcfe">${key}</span>: <span style="color:#ce9178">${escapeHtml(displayValue)}</span><br>`;
      }
    }

    if (elementInfo.children && elementInfo.children.length > 0) {
      html += `<strong>Children:</strong> ${elementInfo.children.length}`;
    }

    selectedInfo.innerHTML = html;
  } else {
    selectedInfo.textContent = `Element: ${elementId}`;
  }

  // Request full element details from server
  send({ type: 'get-element', data: { elementId } });
}

function findElementInTree(node, targetId) {
  if (!node) return null;
  if (node.id === targetId) return node;

  if (node.children) {
    for (const child of node.children) {
      const found = findElementInTree(child, targetId);
      if (found) return found;
    }
  }
  return null;
}

function refreshDocumentTree() {
  send({ type: 'get-document-tree' });
}

function expandAllNodes() {
  collapsedNodes.clear();
  renderDocumentTree();
}

function collapseAllNodes() {
  // Collapse all nodes that have children
  collapseAllNodesRecursive(documentTree?.tree);
  renderDocumentTree();
}

function collapseAllNodesRecursive(node) {
  if (!node) return;
  if (node.children && node.children.length > 0) {
    collapsedNodes.add(node.id);
    node.children.forEach(child => collapseAllNodesRecursive(child));
  }
}

function clearElementSelection() {
  selectedElement = null;
  currentElementBounds = null;

  // Remove selection highlight from tree
  document.querySelectorAll('.tree-node').forEach(node => {
    node.classList.remove('selected');
  });

  // Hide element highlight overlay
  hideHighlight();

  // Reset details panel
  const selectedInfo = document.getElementById('selectedInfo');
  if (selectedInfo) {
    selectedInfo.textContent = 'Click an element to inspect';
  }
}

function toggleNode(nodeId) {
  // Toggle collapsed state
  if (collapsedNodes.has(nodeId)) {
    collapsedNodes.delete(nodeId);
  } else {
    collapsedNodes.add(nodeId);
  }

  // Update the tree display
  const childrenContainer = document.getElementById(`children-${nodeId}`);
  const iconElement = document.querySelector(`[onclick="toggleNode('${nodeId}')"`);

  if (childrenContainer && iconElement) {
    if (collapsedNodes.has(nodeId)) {
      childrenContainer.classList.add('collapsed');
      iconElement.textContent = '▶';
    } else {
      childrenContainer.classList.remove('collapsed');
      iconElement.textContent = '▼';
    }
  }
}

function highlightFocusedElement() {
  // Update focused element in tree
  document.querySelectorAll('.tree-node').forEach(node => {
    node.classList.remove('focused');
  });
  if (focusedElement) {
    document.querySelector(`[data-element-id="${focusedElement}"]`)?.classList.add('focused');
  }
}

function updateMouseCoords(event) {
  // Try to get coordinates from hovered character element
  let target = event.target;
  while (target && !target.dataset?.x && target !== event.currentTarget) {
    target = target.parentElement;
  }

  let x, y;
  if (target?.dataset?.x !== undefined && target?.dataset?.y !== undefined) {
    x = parseInt(target.dataset.x, 10);
    y = parseInt(target.dataset.y, 10);
  } else {
    // Fallback: calculate from pixel position
    const rect = event.currentTarget.getBoundingClientRect();
    const charWidth = 8.4;
    const lineHeight = 16.8;
    x = Math.floor((event.clientX - rect.left - 10) / charWidth);
    y = Math.floor((event.clientY - rect.top - 10) / lineHeight);
  }

  document.getElementById('mouseCoords').textContent = `x: ${x}, y: ${y}`;
}

function getClickCoords(event) {
  // Try to get coordinates from clicked character element
  let target = event.target;
  while (target && !target.dataset?.x && target !== event.currentTarget) {
    target = target.parentElement;
  }

  if (target?.dataset?.x !== undefined && target?.dataset?.y !== undefined) {
    return {
      x: parseInt(target.dataset.x, 10),
      y: parseInt(target.dataset.y, 10)
    };
  }

  // Fallback: calculate from pixel position
  const rect = event.currentTarget.getBoundingClientRect();
  const charWidth = 8.4;
  const lineHeight = 16.8;
  return {
    x: Math.floor((event.clientX - rect.left - 10) / charWidth),
    y: Math.floor((event.clientY - rect.top - 10) / lineHeight)
  };
}

function handleTerminalClick(event) {
  const { x, y } = getClickCoords(event);

  // Focus the terminal for keyboard input
  event.currentTarget.focus();

  // Shift-click: inspect element at coordinates
  if (event.shiftKey) {
    event.preventDefault();
    inspectElementAtCoords(x, y);
    return;
  }

  // Inject click event only if event injection is enabled
  if (eventInjectionEnabled) {
    send({
      type: 'inject-click',
      data: { x, y, button: 'left' }
    });
    logEvent('click', 'left', `(${x}, ${y})`);
  }
}

// Inspect element at coordinates - used by shift-click
let pendingInspectCoords = null;

function inspectElementAtCoords(x, y) {
  // Store coords so we can handle the response
  pendingInspectCoords = { x, y };
  send({
    type: 'get-element-at',
    data: { x, y }
  });
}

function handleTerminalRightClick(event) {
  event.preventDefault();
  const { x, y } = getClickCoords(event);

  // Focus the terminal for keyboard input
  event.currentTarget.focus();

  // Inject right click event only if event injection is enabled
  if (eventInjectionEnabled) {
    send({
      type: 'inject-click',
      data: { x, y, button: 'right' }
    });
    logEvent('click', 'right', `(${x}, ${y})`);
  }
}

function handleKeyDown(event) {
  // Focus indicator
  terminalFocused();

  // Prevent default browser shortcuts for most keys
  if (!event.ctrlKey || ['c', 'v', 'x', 'a', 'z', 'y'].includes(event.key.toLowerCase())) {
    // Allow common editing shortcuts for the terminal
    // Everything else should be forwarded to terminal
    if (event.ctrlKey && ['c', 'v', 'x', 'a', 'z', 'y'].includes(event.key.toLowerCase())) {
      // Allow browser shortcuts for copy, paste, etc.
      return;
    }
    event.preventDefault();
  }

  // Build key event data
  const keyData = {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    keyCode: event.keyCode,
    which: event.which,
    type: 'keydown',
    timestamp: Date.now()
  };

  // Forward keyboard event to server only if event injection is enabled
  if (eventInjectionEnabled) {
    send({
      type: 'inject-key',
      data: keyData
    });
    logEvent('keydown', event.key, buildKeyDesc(event));
  }
}

function buildKeyDesc(event) {
  return buildModString({
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey
  });
}

function handleKeyUp(event) {
  // Build key event data for keyup
  const keyData = {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    keyCode: event.keyCode,
    which: event.which,
    type: 'keyup',
    timestamp: Date.now()
  };

  // Forward keyboard event to server only if event injection is enabled
  if (eventInjectionEnabled) {
    send({
      type: 'inject-key',
      data: keyData
    });
  }
}

function terminalFocused() {
  const terminal = document.getElementById('terminalView');
  if (terminal) {
    terminal.classList.add('interactive');
  }
}

function terminalBlurred() {
  const terminal = document.getElementById('terminalView');
  if (terminal) {
    terminal.classList.remove('interactive');
  }
}

function searchElements(query) {
  // TODO: Implement element search functionality
}

// Tab switching with localStorage persistence
function switchTab(tabName) {
  // Update tab bar
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });

  // Save to localStorage
  try {
    localStorage.setItem('melker-debug-tab', tabName);
  } catch (e) {}
}

// Restore last active tab from localStorage
(function restoreActiveTab() {
  try {
    const savedTab = localStorage.getItem('melker-debug-tab');
    if (savedTab && ['elements', 'events', 'logs', 'state'].includes(savedTab)) {
      switchTab(savedTab);
    }
  } catch (e) {}
})();

// Keyboard shortcuts for tab switching (Ctrl+1/2/3/4)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
    const tabMap = { '1': 'elements', '2': 'events', '3': 'logs', '4': 'state' };
    if (tabMap[e.key]) {
      e.preventDefault();
      switchTab(tabMap[e.key]);
    }
  }
});

// Panel collapse/expand
let panelCollapsed = false;
let panelHeight = 250; // Default panel height

function togglePanel() {
  const panel = document.getElementById('debugPanel');
  const btn = document.getElementById('collapseBtn');
  panelCollapsed = !panelCollapsed;

  if (panelCollapsed) {
    panel.classList.add('collapsed');
    btn.textContent = '▲';
    btn.title = 'Expand panel';
  } else {
    panel.classList.remove('collapsed');
    btn.textContent = '▼';
    btn.title = 'Collapse panel';
  }
}

// Resize handle for debug panel
(function initResizeHandle() {
  const handle = document.getElementById('resizeHandle');
  const panel = document.getElementById('debugPanel');
  if (!handle || !panel) return;

  let startY, startHeight;

  handle.addEventListener('mousedown', (e) => {
    startY = e.clientY;
    startHeight = panel.offsetHeight;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });

  function onMouseMove(e) {
    const delta = startY - e.clientY;
    const newHeight = Math.min(Math.max(startHeight + delta, 100), window.innerHeight * 0.6);
    panel.style.height = newHeight + 'px';
    panelHeight = newHeight;
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
})();

// Get current modifier key states from checkboxes
function getModifiers() {
  return {
    ctrlKey: document.getElementById('modCtrl')?.checked || false,
    altKey: document.getElementById('modAlt')?.checked || false,
    shiftKey: document.getElementById('modShift')?.checked || false,
    metaKey: false
  };
}

// Quick key injection with optional force-shift (for Shift+Tab button)
function injectQuickKey(key, forceShift = false) {
  if (!eventInjectionEnabled) {
    logEvent('key', key, 'blocked - input disabled');
    return;
  }

  const mods = getModifiers();
  if (forceShift) mods.shiftKey = true;

  send({
    type: 'inject-key',
    data: { key, type: 'keydown', ...mods }
  });

  const modStr = buildModString(mods);
  logEvent('key', modStr ? `${modStr}+${key}` : key, 'injected');
}

// Inject function key from dropdown
function injectFKey() {
  const select = document.getElementById('fkeySelect');
  const key = select?.value;
  if (!key) return;

  injectQuickKey(key);

  // Reset dropdown to placeholder
  select.value = '';
}

// Build modifier string for display
function buildModString(mods) {
  const parts = [];
  if (mods.ctrlKey) parts.push('Ctrl');
  if (mods.altKey) parts.push('Alt');
  if (mods.shiftKey) parts.push('Shift');
  if (mods.metaKey) parts.push('Meta');
  return parts.join('+');
}

// Trigger named event - actually dispatch to server
function triggerNamedEvent() {
  const nameInput = document.getElementById('eventName');
  const payloadInput = document.getElementById('eventPayload');
  const name = nameInput?.value?.trim();
  const payloadStr = payloadInput?.value?.trim();

  if (!name) {
    logEvent('error', 'Event name required', '');
    return;
  }

  if (!eventInjectionEnabled) {
    logEvent('custom', name, 'blocked - input disabled');
    return;
  }

  let detail = undefined;
  if (payloadStr) {
    try {
      detail = JSON.parse(payloadStr);
    } catch (e) {
      logEvent('error', 'Invalid JSON payload', payloadStr);
      return;
    }
  }

  // Dispatch named event to server
  send({
    type: 'dispatch-named-event',
    data: { name, detail }
  });

  logEvent('custom', name, detail ? JSON.stringify(detail) : '');
}

// Clear event history
function clearEventHistory() {
  eventHistory.length = 0;
  renderEventHistory();
}

// Event history tracking
const eventHistory = [];
const maxEventHistory = 100;

function logEvent(type, key, detail) {
  const time = new Date().toLocaleTimeString();
  eventHistory.push({ time, type, key, detail });
  while (eventHistory.length > maxEventHistory) {
    eventHistory.shift();
  }
  renderEventHistory();
}

function renderEventHistory() {
  const container = document.getElementById('eventHistory');
  if (!container) return;

  if (eventHistory.length === 0) {
    container.innerHTML = '<div style="color: #808080; padding: 8px;">Event history will appear here...</div>';
    return;
  }

  let html = '';
  eventHistory.slice().reverse().forEach(event => {
    const typeClass = event.type === 'custom' || event.type === 'error' ? ` ${event.type}` : '';
    html += `<div class="event-entry">
      <span class="event-time">${event.time}</span>
      <span class="event-type${typeClass}">${event.type}</span>
      <span>${escapeHtml(event.key)}</span>
      ${event.detail ? `<span style="color: #808080; margin-left: 8px;">${escapeHtml(event.detail)}</span>` : ''}
    </div>`;
  });
  container.innerHTML = html;
}

// State tab updates
let engineState = null;

function updateState(state) {
  if (!state) return;
  engineState = state;

  // Engine card
  const running = document.getElementById('stateRunning');
  const elements = document.getElementById('stateElements');
  const focused = document.getElementById('stateFocused');
  if (running) running.textContent = state.isRunning ? 'Yes' : 'No';
  if (elements) elements.textContent = state.elementCount || '0';
  if (focused) focused.textContent = state.focusedElement || 'None';

  // Terminal card
  const termSize = document.getElementById('stateTermSize');
  const headless = document.getElementById('stateHeadless');
  const input = document.getElementById('stateInput');
  if (termSize && state.terminalSize) {
    termSize.textContent = `${state.terminalSize.width}x${state.terminalSize.height}`;
  }
  if (headless) headless.textContent = state.isHeadless ? 'Yes' : 'No';
  if (input) input.textContent = eventInjectionEnabled ? 'Enabled' : 'Disabled';

  // Input status indicator in header
  const inputStatus = document.getElementById('inputStatus');
  if (inputStatus) {
    if (eventInjectionEnabled) {
      inputStatus.textContent = 'Input: Enabled';
      inputStatus.className = 'input-status enabled';
    } else {
      inputStatus.textContent = 'Input: Disabled';
      inputStatus.className = 'input-status disabled';
    }
  }
}

function updateConnectionState(connected) {
  const status = document.getElementById('stateConnStatus');
  const retries = document.getElementById('stateRetries');
  if (status) status.textContent = connected ? 'Connected' : 'Disconnected';
  if (retries) retries.textContent = connectionRetryCount.toString();
}

// Log panel functions
function addLogEntry(entry) {
  logEntries.push(entry);
  // Trim old entries if we exceed max
  while (logEntries.length > maxLogEntries) {
    logEntries.shift();
  }
  renderLogs();
}

function renderLogs() {
  const container = document.getElementById('logContent');
  if (!container) return;

  const filterLevel = document.getElementById('logLevelFilter')?.value || 'INFO';
  const minLevel = logLevels[filterLevel] || 0;

  const filteredEntries = logEntries.filter(entry => {
    const entryLevel = logLevels[entry.level] || 0;
    return entryLevel >= minLevel;
  });

  // Update log count
  const logCount = document.getElementById('logCount');
  if (logCount) {
    logCount.textContent = `${filteredEntries.length} of ${logEntries.length} entries`;
  }

  if (filteredEntries.length === 0) {
    container.innerHTML = '<div style="color: #808080; padding: 8px;">No log entries matching filter...</div>';
    return;
  }

  let html = '';
  filteredEntries.forEach(entry => {
    const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
    const source = entry.source ? `<span class="log-source">[${entry.source}]</span>` : '';
    const context = entry.context && Object.keys(entry.context).length > 0
      ? `<span class="log-context">${JSON.stringify(entry.context)}</span>`
      : '';

    html += `<div class="log-entry">
      <span class="log-timestamp">${timestamp}</span>
      <span class="log-level ${entry.level}">${entry.level}</span>
      ${source}
      <span class="log-message">${escapeHtml(entry.message)}</span>
      ${context}
    </div>`;
  });

  container.innerHTML = html;
  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function filterLogs() {
  renderLogs();
}

function clearLogs() {
  logEntries = [];
  renderLogs();
}

// Auto-connect on load
connect();
