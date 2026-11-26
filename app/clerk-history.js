const clerkHistoryApi = 'http://127.0.0.1:8002/api/v1';
const clerkHistoryUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
let clerkHistoryLoading;
let disposeClerkHistory;

function clerkHistoryAllowed() {
  return location.protocol === 'http:' && location.port === '8000' &&
    ['127.0.0.1', 'localhost'].includes(location.hostname);
}

function clerkHistoryPage() {
  if (!clerkHistoryAllowed()) return '';
  return `<section id="clerk-history" class="card wide-card">
    <div class="recorder-import">
      <div><h2>Workspace run history</h2><p>Sign in with Clerk to view runs shared with your workspace.</p></div>
      <button type="button" class="blackbtn" data-clerk-sign-in>Sign in with Clerk</button>
      <button type="button" class="whitebtn" data-clerk-sign-out hidden>Sign out</button>
    </div>
    <p role="status" class="recorder-status"></p>
    <div class="clerk-history-list" hidden>
      <label for="clerk-workspace">Workspace</label>
      <select id="clerk-workspace"></select>
      <ul aria-label="Workspace runs"></ul>
      <button type="button" class="whitebtn" data-clerk-load-more hidden>Load more runs</button>
    </div>
    <div id="clerk-history-result" class="recorder-result" hidden></div>
  </section>`;
}

async function clerkHistoryRequest(path, token) {
  const response = await fetch(clerkHistoryApi + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 401 && token) throw new Error('Your session could not access Runspell. Sign in again or ask for workspace access.');
  if (!response.ok) throw new Error('Could not load from the local Runspell API.');
  return response.json();
}

function clerkHistoryScript(url, publishableKey) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.crossOrigin = 'anonymous';
    if (publishableKey) script.dataset.clerkPublishableKey = publishableKey;
    const timeout = setTimeout(fail, 8000);
    function fail() {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('Clerk could not load.'));
    }
    script.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    script.onerror = fail;
    document.head.append(script);
  });
}

async function loadClerkHistory() {
  const config = await clerkHistoryRequest('/auth/config');
  const encoded = /^pk_test_([A-Za-z0-9+/_-]+={0,2})$/.exec(config.publishableKey);
  if (config.provider !== 'clerk' || !encoded) throw new Error('Configure a Clerk development instance in the local API.');
  const host = atob(encoded[1].replaceAll('-', '+').replaceAll('_', '/'));
  if (!/^[a-z0-9-]+\.clerk\.accounts\.dev\$$/i.test(host) || config.frontendApi !== `https://${host.slice(0, -1)}`) {
    throw new Error('The Clerk development instance configuration is invalid.');
  }
  await clerkHistoryScript(`${config.frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await clerkHistoryScript(`${config.frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, config.publishableKey);
  await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  return window.Clerk;
}

function mountClerkHistory() {
  disposeClerkHistory?.();
  const root = document.querySelector('#clerk-history');
  if (!root) return;
  const signIn = root.querySelector('[data-clerk-sign-in]');
  const signOut = root.querySelector('[data-clerk-sign-out]');
  const feedback = root.querySelector('[role=status]');
  const browse = root.querySelector('.clerk-history-list');
  const workspace = root.querySelector('select');
  const list = root.querySelector('ul');
  const more = root.querySelector('[data-clerk-load-more]');
  const receipt = root.querySelector('#clerk-history-result');
  let clerk, session, unsubscribe, nextCursor;
  let context = 0;
  let receiptRequest = 0;
  let disposed = false;
  const mounted = () => !disposed && root.isConnected;
  const current = (revision) => revision === context && mounted();

  function clearReceipt() {
    receiptRequest++;
    receipt.hidden = true;
    receipt.replaceChildren();
  }

  async function authenticated(path) {
    const active = session;
    const token = await active?.getToken();
    if (!token || !mounted() || active !== session) throw new Error('Sign in with Clerk to view runs.');
    return clerkHistoryRequest(path, token);
  }

  async function openRun(id) {
    clearReceipt();
    const selected = receiptRequest;
    const revision = context;
    feedback.textContent = 'Loading run evidence…';
    try {
      const evidence = await authenticated(`/workspaces/${workspace.value}/runs/${id}/evidence`);
      if (!current(revision) || selected !== receiptRequest) return;
      if (!isFlightReceipt(evidence) || evidence.runId !== id) throw new Error('The run receipt could not be read.');
      showFlightReceipt(receipt, evidence);
      feedback.textContent = 'Run receipt opened.';
    } catch (error) {
      if (current(revision) && selected === receiptRequest) feedback.textContent = error.message;
    }
  }

  async function loadRuns(append = false) {
    const revision = ++context;
    more.hidden = true;
    if (!append) {
      nextCursor = null;
      list.replaceChildren();
      clearReceipt();
    }
    feedback.textContent = 'Loading workspace runs…';
    try {
      const query = nextCursor ? `?after=${nextCursor}` : '';
      const page = await authenticated(`/workspaces/${workspace.value}/runs${query}`);
      if (!current(revision)) return;
      for (const run of page.runs) {
        if (!clerkHistoryUuid.test(run.id) || !Object.hasOwn(receiptStatuses, run.status)) continue;
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'whitebtn';
        button.textContent = `View run ${run.id}`;
        button.addEventListener('click', () => { void openRun(run.id); });
        const summary = document.createElement('span');
        summary.textContent = `${receiptStatuses[run.status]} · ${new Date(run.createdAt).toLocaleString()}`;
        item.append(button, summary);
        list.append(item);
      }
      nextCursor = clerkHistoryUuid.test(page.nextCursor) ? page.nextCursor : null;
      more.hidden = !nextCursor;
      feedback.textContent = list.childElementCount ? 'Workspace runs loaded.' : 'This workspace has no runs.';
    } catch (error) {
      if (current(revision)) {
        more.hidden = !nextCursor;
        feedback.textContent = error.message;
      }
    }
  }

  async function useSession(next) {
    if (next?.id === session?.id && session !== undefined) return;
    const revision = ++context;
    session = next ?? null;
    signIn.hidden = !!session;
    signOut.hidden = !session;
    browse.hidden = true;
    workspace.replaceChildren();
    list.replaceChildren();
    clearReceipt();
    feedback.textContent = '';
    if (!session) return;
    feedback.textContent = 'Loading workspace access…';
    try {
      const account = await authenticated('/me');
      if (!current(revision)) return;
      for (const membership of account.workspaces) {
        if (!clerkHistoryUuid.test(membership.id)) continue;
        workspace.append(new Option(`${membership.name} (${membership.role})`, membership.id));
      }
      if (!workspace.options.length) {
        feedback.textContent = 'No Runspell workspace membership yet.';
        return;
      }
      browse.hidden = false;
      await loadRuns();
    } catch (error) {
      if (current(revision)) feedback.textContent = error.message;
    }
  }

  signIn.addEventListener('click', async () => {
    signIn.disabled = true;
    feedback.textContent = 'Opening Clerk…';
    try {
      clerkHistoryLoading ??= loadClerkHistory().catch((error) => {
        clerkHistoryLoading = undefined;
        throw error;
      });
      clerk = await clerkHistoryLoading;
      if (!mounted()) return;
      unsubscribe ??= clerk.addListener(({ session: active }) => {
        if (mounted() && active !== undefined) void useSession(active);
      }, { skipInitialEmit: true });
      if (clerk.session) await useSession(clerk.session);
      else {
        feedback.textContent = '';
        clerk.openSignIn({ forceRedirectUrl: `${location.origin}${location.pathname}#/runs/recorder` });
      }
    } catch {
      if (mounted()) feedback.textContent = 'Unable to start Clerk. Check the local API and Clerk development configuration.';
    } finally {
      signIn.disabled = false;
    }
  });
  signOut.addEventListener('click', async () => {
    try {
      await clerk.signOut();
      if (mounted()) await useSession(null);
    } catch {
      if (mounted()) feedback.textContent = 'Clerk sign-out failed. Try again.';
    }
  });
  workspace.addEventListener('change', () => { void loadRuns(); });
  more.addEventListener('click', () => { void loadRuns(true); });

  disposeClerkHistory = () => { disposed = true; unsubscribe?.(); };
}

window.addEventListener('hashchange', () => { disposeClerkHistory?.(); });
