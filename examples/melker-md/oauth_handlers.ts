const oauth = $melker.oauth;

// UI update helpers
function updateUI(loggedIn: boolean) {
  const mdEl = $melker.getElementById('token-info');
  if (mdEl) mdEl.props.text = oauth.getTokensMarkdown();

  const get = (id: string) => $melker.getElementById(id);
  const loginBtn = get('btn-login');
  if (loginBtn) {
    loginBtn.props.disabled = loggedIn;
    get('btn-refresh').props.disabled = !oauth.hasRefreshToken();
    get('btn-logout').props.disabled = !loggedIn;
  }
  $melker.render();
}

function showStatus(msg: string) {
  const el = $melker.getElementById('status');
  const errEl = $melker.getElementById('error');
  if (el) el.props.text = msg;
  if (errEl) errEl.props.text = '';
  $melker.render();
}

function showError(msg: string) {
  const el = $melker.getElementById('status');
  const errEl = $melker.getElementById('error');
  if (el) el.props.text = 'Error';
  if (errEl) errEl.props.text = msg;
  $melker.render();
}

// Callbacks referenced by <oauth> element
function onLoginCallback() {
  showStatus('Logged in');
  updateUI(true);
}

function onLogoutCallback() {
  showStatus('Logged out');
  updateUI(false);
}

function onFailCallback(error: Error) {
  showError(error.message);
  updateUI(false);
}

// Button handlers
async function onLogin() {
  showStatus('Opening browser...');
  try {
    await oauth.login();
  } catch (err) {
    // Error already handled via onFail callback, but catch to prevent unhandled rejection
  }
}

async function onRefresh() {
  showStatus('Refreshing token...');
  try {
    await oauth.refresh();
  } catch (err) {
    // Error already handled via onFail callback
  }
}

async function onLogout() {
  try {
    await oauth.logoutSession();
  } catch (err) {
    // Error already handled via onFail callback
  }
}

function exit() {

}

exports = { exit, onLogin, onRefresh, onLogout, onLoginCallback, onLogoutCallback, onFailCallback };
