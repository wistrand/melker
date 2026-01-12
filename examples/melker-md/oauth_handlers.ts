// Declare $melker for external module (injected at runtime)
declare const $melker: any;

const oauth = $melker.oauth;

// UI update helpers
function updateUI(loggedIn: boolean) {
  const mdEl = $melker.getElementById('token-info');
  if (mdEl) mdEl.setValue(oauth.getTokensMarkdown());

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
  if (el) el.setValue(msg);
  if (errEl) errEl.setValue('');
  $melker.render();
}

function showError(msg: string) {
  const el = $melker.getElementById('status');
  const errEl = $melker.getElementById('error');
  if (el) el.setValue('Error');
  if (errEl) errEl.setValue(msg);
  $melker.render();
}

// Callbacks referenced by <oauth> element
// All callbacks receive unified OAuthEvent: { type: 'oauth', action: string, error?: Error }
interface OAuthEvent {
  type: 'oauth';
  action: 'login' | 'logout' | 'fail';
  error?: Error;
}

export function onLoginCallback(_event: OAuthEvent) {
  showStatus('Logged in');
  updateUI(true);
}

export function onLogoutCallback(_event: OAuthEvent) {
  showStatus('Logged out');
  updateUI(false);
}

export function onFailCallback(event: OAuthEvent) {
  showError(event.error?.message || 'Unknown error');
  updateUI(false);
}

// Button handlers
export async function onLogin() {
  showStatus('Opening browser...');
  try {
    await oauth.login();
  } catch (err) {
    // Error already handled via onFail callback, but catch to prevent unhandled rejection
  }
}

export async function onRefresh() {
  showStatus('Refreshing token...');
  try {
    await oauth.refresh();
  } catch (err) {
    // Error already handled via onFail callback
  }
}

export async function onLogout() {
  try {
    await oauth.logoutSession();
  } catch (err) {
    // Error already handled via onFail callback
  }
}

export function exit() {
}
