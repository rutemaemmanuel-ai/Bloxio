const tabs = [...document.querySelectorAll('.auth-tab')];
const forms = [...document.querySelectorAll('.auth-form')];
const heading = document.getElementById('authHeading');
const intro = document.getElementById('authIntro');
const status = document.getElementById('authStatus');
const previewLink = document.getElementById('previewLink');

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
    : 'Sign in to continue your Vexora adventure.';
  status.hidden = true;
  previewLink.hidden = true;
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

document.querySelectorAll('.auth-submit').forEach(button => {
  button.addEventListener('click', () => {
    const form = document.getElementById(button.dataset.form);
    const invalidField = [...form.querySelectorAll('input')].find(field => !field.checkValidity());
    if (invalidField) {
      invalidField.reportValidity();
      return;
    }

    status.textContent = 'This is a design preview only. No account was created and your entries were not sent or saved.';
    status.hidden = false;
    previewLink.hidden = false;
    previewLink.focus();
  });
});

document.querySelectorAll('[data-preview-link], #previewLink').forEach(link => {
  link.addEventListener('click', event => {
    try {
      sessionStorage.setItem('vexora-site-preview', 'true');
    } catch (error) {
      event.preventDefault();
      status.textContent = 'Your browser blocked session storage, so the site preview could not be opened. Enable browser storage and try again.';
      status.hidden = false;
      console.error('Unable to open the Vexora preview because session storage is unavailable.', error);
    }
  });
});
