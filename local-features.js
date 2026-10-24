(() => {
  const catalog = {
    'sky-racing': { name: 'Sky Racing', category: 'Racing', image: 'assets/sky-racing.jpg', alt: 'Red sports car on a bright racing track' },
    'obby-challenge': { name: 'Obby Challenge', category: 'Adventure', image: 'assets/obby-challenge.jpg', alt: 'Colorful floating obstacle course' },
    'island-survival': { name: 'Island Survival', category: 'Survival', image: 'assets/island-survival.jpg', alt: 'Cartoon island camp with a cabin and campfire' },
    'city-tycoon': { name: 'My City Tycoon', category: 'Simulator', image: 'assets/city-tycoon.jpg', alt: 'Bright fantasy city built from colorful blocks' },
    'mega-parkour': { name: 'Mega Parkour', category: 'Skill', image: 'assets/mega-parkour.jpg', alt: 'Cartoon character jumping between floating platforms' }
  };
  const storage = {
    read(key, fallback, validate) {
      const value = localStorage.getItem(key);
      if (value === null) return fallback;
      try {
        const parsed = JSON.parse(value);
        if (!validate(parsed)) throw new TypeError(`Invalid saved data for ${key}.`);
        return parsed;
      } catch (error) {
        console.error(`Unable to read local Bloxio data (${key}).`, error);
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.error(`Unable to save local Bloxio data (${key}).`, error);
        window.dispatchEvent(new CustomEvent('bloxio:local-save-error', { detail: { key } }));
        return false;
      }
    }
  };
  const isStringArray = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  const validHistory = value => Array.isArray(value) && value.every(item =>
    item && typeof item.id === 'string' && catalog[item.id] && Number.isFinite(item.playedAt));
  const validPlayers = value => Array.isArray(value) && value.every(player =>
    player && typeof player.name === 'string' && typeof player.avatar === 'string' && typeof player.color === 'string');
  let history = storage.read('bloxio-play-history', [], validHistory).slice(0, 12);
  let favorites = storage.read('bloxio-favorites', [], isStringArray);

  function makeGameCard(id) {
    const game = catalog[id];
    if (!game) return null;
    const card = document.createElement('article');
    card.className = 'game-card';
    card.dataset.name = game.name;
    card.dataset.category = game.category;
    card.dataset.gameId = id;

    const artworkLink = document.createElement('a');
    artworkLink.className = 'game-play';
    artworkLink.href = `game.html?game=${encodeURIComponent(id)}`;
    artworkLink.setAttribute('aria-label', `Play ${game.name}`);
    const image = document.createElement('img');
    image.src = game.image;
    image.alt = game.alt;
    image.loading = 'lazy';
    const overlay = document.createElement('span');
    overlay.className = 'play-overlay';
    overlay.textContent = 'Play now';
    artworkLink.append(image, overlay);

    const info = document.createElement('div');
    info.className = 'game-info';
    const title = document.createElement('h3');
    title.textContent = game.name;
    const meta = document.createElement('div');
    meta.className = 'game-meta';
    const category = document.createElement('span');
    category.className = `category ${game.category.toLowerCase()}`;
    category.textContent = game.category;
    meta.append(category);
    const detailLink = document.createElement('a');
    detailLink.className = 'game-details-link';
    detailLink.href = `game.html?game=${encodeURIComponent(id)}`;
    detailLink.textContent = 'Game details →';
    info.append(title, meta, detailLink);
    card.append(artworkLink, info);
    return card;
  }

  function renderHistory() {
    const recentGrid = document.getElementById('recentlyPlayedGrid');
    const recentEmpty = document.getElementById('recentlyPlayedEmpty');
    if (recentGrid) {
      recentGrid.replaceChildren(...history.slice(0, 5).map(item => makeGameCard(item.id)).filter(Boolean));
      recentGrid.hidden = history.length === 0;
      if (recentEmpty) recentEmpty.hidden = history.length !== 0;
    }
    const profileHistory = document.getElementById('profilePlayHistory');
    const profileEmpty = document.getElementById('profilePlayHistoryEmpty');
    if (profileHistory) {
      profileHistory.replaceChildren(...history.slice(0, 8).map(item => {
        const entry = document.createElement('article');
        entry.className = 'profile-history-row';
        const game = catalog[item.id];
        const image = document.createElement('img');
        image.src = game.image;
        image.alt = game.alt;
        image.loading = 'lazy';
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = game.name;
        const date = document.createElement('small');
        date.textContent = `Played ${new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(item.playedAt)}`;
        copy.append(title, date);
        const link = document.createElement('a');
        link.className = 'secondary-button small';
        link.href = `game.html?game=${encodeURIComponent(item.id)}`;
        link.textContent = 'Play again';
        entry.append(image, copy, link);
        return entry;
      }));
      if (profileEmpty) profileEmpty.hidden = history.length > 0;
    }
    renderRecommendations();
  }

  function renderRecommendations() {
    const recommendationHost = document.getElementById('recommendedGames');
    if (!recommendationHost) return;
    const categoryCounts = new Map();
    history.forEach(item => {
      const category = catalog[item.id]?.category;
      if (category) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    });
    const playedIds = new Set(history.map(item => item.id));
    const ranked = Object.entries(catalog).map(([id, game]) => ({
      id,
      score: (favorites.includes(id) ? 5 : 0) + (categoryCounts.get(game.category) || 0) * 2 - (playedIds.has(id) ? 1 : 0)
    })).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const picks = ranked.filter(item => !playedIds.has(item.id)).slice(0, 2);
    const finalPicks = picks.length ? picks : ranked.slice(0, 2);
    recommendationHost.replaceChildren(...finalPicks.map(item => {
      const link = document.createElement('a');
      link.className = 'recommended-game-link';
      link.href = `game.html?game=${encodeURIComponent(item.id)}`;
      link.textContent = catalog[item.id].name;
      return link;
    }));
  }

  window.addEventListener('bloxio:launch-game', event => {
    const id = event.detail?.gameId;
    if (!catalog[id]) return;
    history = [{ id, playedAt: Date.now() }, ...history.filter(item => item.id !== id)].slice(0, 12);
    if (storage.write('bloxio-play-history', history)) renderHistory();
  });
  window.addEventListener('bloxio:game-finished', event => {
    const id = event.detail?.gameId;
    if (!catalog[id]) return;
    const record = history.find(item => item.id === id);
    if (record) {
      record.score = event.detail.score;
      record.playedAt = Date.now();
      storage.write('bloxio-play-history', history);
      renderHistory();
    }
  });
  window.addEventListener('bloxio:favorites-changed', () => {
    favorites = storage.read('bloxio-favorites', [], isStringArray);
    renderRecommendations();
  });
  window.addEventListener('bloxio:local-save-error', event => {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = 'Could not save on this device. Check available browser storage.';
      toast.classList.add('show');
      window.setTimeout(() => toast.classList.remove('show'), 3200);
    }
  });
  renderHistory();

  const playersGrid = document.querySelector('.community-people-grid');
  if (playersGrid) {
    const search = document.getElementById('communityPlayerSearch');
    const dismissed = storage.read('bloxio-community-dismissed-requests', [], isStringArray);
    let accepted = storage.read('bloxio-community-accepted-players', [], validPlayers);

    dismissed.forEach(name => {
      document.querySelectorAll('#community-requests .friend-row').forEach(row => {
        if (row.querySelector('.friend-meta strong')?.textContent === name) row.remove();
      });
    });
    function renderAcceptedPlayer(player) {
      if (playersGrid.querySelector(`[data-local-player="${CSS.escape(player.name)}"]`)) return;
      const card = document.createElement('article');
      card.className = 'panel community-person';
      card.dataset.localPlayer = player.name;
      const avatar = document.createElement('span');
      avatar.className = `user-dot ${player.color}`;
      avatar.textContent = player.avatar;
      const identity = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = player.name;
      const presence = document.createElement('p');
      presence.textContent = 'Added to your local friends';
      identity.append(name, presence);
      const actions = document.createElement('div');
      actions.className = 'community-person-actions';
      const profile = document.createElement('a');
      profile.className = 'secondary-button small';
      profile.href = `profile.html?user=${encodeURIComponent(player.name)}`;
      profile.textContent = 'View profile';
      const message = document.createElement('button');
      message.className = 'primary-button small';
      message.type = 'button';
      message.dataset.openMessage = player.name;
      message.textContent = 'Message';
      const remove = document.createElement('button');
      remove.className = 'secondary-button small';
      remove.type = 'button';
      remove.textContent = 'Remove friend';
      remove.addEventListener('click', () => {
        accepted.splice(accepted.findIndex(item => item.name === player.name), 1);
        if (storage.write('bloxio-community-accepted-players', accepted)) {
          card.remove();
          search?.dispatchEvent(new Event('input'));
        }
      });
      actions.append(profile, message, remove);
      card.append(avatar, identity, actions);
      playersGrid.append(card);
    }
    accepted.forEach(renderAcceptedPlayer);
    window.addEventListener('bloxio:friend-accepted', event => {
      const player = event.detail;
      if (!validPlayers([player])) return;
      accepted = [...accepted.filter(item => item.name !== player.name), player];
      renderAcceptedPlayer(player);
      search?.dispatchEvent(new Event('input'));
    });
    search?.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase();
      playersGrid.querySelectorAll('.community-person').forEach(card => {
        card.hidden = !card.textContent.toLowerCase().includes(term);
      });
    });
  }

  const partyForm = document.getElementById('localPartyForm');
  if (partyForm) {
    const partyList = document.getElementById('localPartyList');
    const empty = document.getElementById('localPartyEmpty');
    const activitySelect = document.getElementById('partyActivity');
    const playersSelect = document.getElementById('partyPlayers');
    let parties = storage.read('bloxio-local-parties', [], value => Array.isArray(value) && value.every(party =>
      party && typeof party.id === 'string' && typeof party.activity === 'string' && isStringArray(party.players)));

    function renderParties() {
      partyList.replaceChildren(...parties.map(party => {
        const card = document.createElement('article');
        card.className = 'panel local-party-card';
        const title = document.createElement('h3');
        title.textContent = `${party.activity} party`;
        const invitees = document.createElement('p');
        invitees.textContent = party.players.length ? `Invite preview: ${party.players.join(', ')}` : 'No sample players selected.';
        const note = document.createElement('small');
        note.textContent = `Created ${new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(party.createdAt)}`;
        const remove = document.createElement('button');
        remove.className = 'secondary-button small';
        remove.type = 'button';
        remove.textContent = 'Remove preview';
        remove.addEventListener('click', () => {
          parties = parties.filter(item => item.id !== party.id);
          if (storage.write('bloxio-local-parties', parties)) renderParties();
        });
        card.append(title, invitees, note, remove);
        return card;
      }));
      empty.hidden = parties.length > 0;
    }

    partyForm.addEventListener('submit', event => {
      event.preventDefault();
      const players = [...playersSelect.selectedOptions].map(option => option.value);
      const activity = activitySelect?.value || 'Casual hangout';
      parties = [{ id: `${Date.now()}`, activity, players, createdAt: Date.now() }, ...parties].slice(0, 10);
      if (storage.write('bloxio-local-parties', parties)) {
        renderParties();
        showToast('Local hangout preview created. No invitations were sent.');
      }
    });
    renderParties();
  }

  const feedForm = document.getElementById('localFeedForm');
  if (feedForm) {
    const feed = document.querySelector('#community-feed .community-feed');
    let posts = storage.read('bloxio-local-feed', [], value => Array.isArray(value) && value.every(post =>
      post && typeof post.id === 'string' && typeof post.text === 'string' && Number.isFinite(post.likes) && typeof post.liked === 'boolean'));

    function renderPosts() {
      feed.querySelectorAll('[data-local-feed-post]').forEach(post => post.remove());
      posts.forEach(post => {
        const card = document.createElement('article');
        card.className = 'panel news-item local-feed-post';
        card.dataset.localFeedPost = post.id;
        const label = document.createElement('span');
        label.className = 'news-tag';
        label.textContent = 'Your local post';
        const body = document.createElement('p');
        body.textContent = post.text;
        const like = document.createElement('button');
        like.className = `secondary-button small local-feed-like${post.liked ? ' active' : ''}`;
        like.type = 'button';
        like.textContent = `${post.liked ? 'Liked' : 'Like'} · ${post.likes}`;
        like.addEventListener('click', () => {
          post.liked = !post.liked;
          post.likes = Math.max(0, post.likes + (post.liked ? 1 : -1));
          if (storage.write('bloxio-local-feed', posts)) renderPosts();
        });
        const remove = document.createElement('button');
        remove.className = 'secondary-button small';
        remove.type = 'button';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => {
          posts = posts.filter(item => item.id !== post.id);
          if (storage.write('bloxio-local-feed', posts)) renderPosts();
        });
        card.append(label, body, like, remove);
        feed.prepend(card);
      });
    }

    feedForm.addEventListener('submit', event => {
      event.preventDefault();
      const input = document.getElementById('localFeedText');
      const text = input.value.trim();
      if (!text) return;
      posts = [{ id: `${Date.now()}`, text, likes: 0, liked: false }, ...posts].slice(0, 20);
      if (storage.write('bloxio-local-feed', posts)) {
        input.value = '';
        renderPosts();
        showToast('Update saved to your local community feed.');
      }
    });
    renderPosts();
  }

  // -------------------------------------------------------------
  // Creator dashboard: the games saved by Bloxio Studio
  // -------------------------------------------------------------
  const studioProjectList = document.getElementById('studioProjects');
  if (studioProjectList) {
    const emptyState = document.getElementById('studioProjectsEmpty');
    const STUDIO_PROJECTS_KEY = 'bloxio-studio-projects-v1';
    const validProjects = value => Array.isArray(value) && value.every(project =>
      project && typeof project.id === 'string' && typeof project.name === 'string' && Array.isArray(project.scene));
    let projects = storage.read(STUDIO_PROJECTS_KEY, [], validProjects);

    function formatSavedAt(updatedAt) {
      if (!Number.isFinite(updatedAt)) return 'Saved on this device';
      return `Edited ${new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(updatedAt)}`;
    }

    function renderProjects() {
      studioProjectList.replaceChildren();
      projects.forEach(project => {
        const row = document.createElement('article');
        row.className = 'studio-project-row';

        const details = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = project.name;
        const meta = document.createElement('small');
        const objects = project.scene.length;
        meta.textContent = `${objects} object${objects === 1 ? '' : 's'} · ${formatSavedAt(project.updatedAt)}`;
        details.append(title, meta);

        const actions = document.createElement('div');
        actions.className = 'studio-project-actions';

        const open = document.createElement('a');
        open.className = 'primary-button small';
        open.href = `studio.html?project=${encodeURIComponent(project.id)}`;
        open.textContent = 'Open in Studio';

        const remove = document.createElement('button');
        remove.className = 'secondary-button small';
        remove.type = 'button';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => {
          projects = projects.filter(item => item.id !== project.id);
          if (storage.write(STUDIO_PROJECTS_KEY, projects)) {
            renderProjects();
            showToast(`Deleted "${project.name}" from this browser.`);
          }
        });

        actions.append(open, remove);
        row.append(details, actions);
        studioProjectList.append(row);
      });
      emptyState.hidden = projects.length > 0;
    }

    renderProjects();
  }
})();
