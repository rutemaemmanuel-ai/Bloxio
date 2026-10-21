const tabs = [...document.querySelectorAll('.auth-tab')];
const forms = [...document.querySelectorAll('.auth-form')];
const heading = document.getElementById('authHeading');
const intro = document.getElementById('authIntro');
const status = document.getElementById('authStatus');

function selectAuthTab(selectedTab) {
  tabs.forEach(tab => {
    const selected = tab === selectedTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });

  forms.forEach(form => {
    form.hidden = form.id !== selectedTab.getAttribute('aria-controls');
  });

  const isSignup = selectedTab.id === 'signupTab';
  heading.textContent = isSignup ? 'Create your account' : 'Welcome back';
  intro.textContent = isSignup
    ? 'Join the community and make something unforgettable.'
    : 'Sign in to continue your Bloxio adventure.';
  status.hidden = true;
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectAuthTab(tab));
  tab.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextTab = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    selectAuthTab(nextTab);
    nextTab.focus();
  });
});

function showStatus(message) {
  status.textContent = message;
  status.hidden = false;
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Unable to complete your request. Please try again.');
  }
  return body;
}

forms.forEach(form => {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = form.querySelector('.auth-submit');
    const originalLabel = button.firstChild.textContent;
    button.disabled = true;
    button.firstChild.textContent = form.id === 'signupForm' ? 'Creating account… ' : 'Signing in… ';
    status.hidden = true;

    try {
      const body = Object.fromEntries(new FormData(form).entries());
      const endpoint = form.id === 'signupForm' ? '/api/auth/signup' : '/api/auth/login';
      await readResponse(await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      }));
      window.location.assign('/');
    } catch (error) {
      showStatus(error.message || 'Unable to reach the account service. Please try again.');
    } finally {
      button.disabled = false;
      button.firstChild.textContent = originalLabel;
    }
  });
});

fetch('/api/auth/me', { credentials: 'same-origin' })
  .then(readResponse)
  .then(result => {
    if (result.authenticated) window.location.replace('/');
  })
  .catch(error => {
    if (error.message === 'Account service is not configured. Set DATABASE_URL and restart the server.') {
      showStatus(error.message);
    } else if (error instanceof TypeError) {
      showStatus('Unable to reach the account service. Please try again.');
    } else {
      console.error('Unable to check the Bloxio sign-in session.', error);
      showStatus('Unable to check your sign-in session. Please refresh the page.');
    }
  });
