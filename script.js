const sharedHeader = document.querySelector('.topbar');
if (sharedHeader) {
  sharedHeader.innerHTML = `
    <button class="menu-toggle" id="menuToggle" type="button" aria-label="Toggle navigation menu" aria-expanded="false">☰</button>
    <a class="brand" href="index.html" aria-label="Bloxio home"><img class="brand-logo" src="assets/bloxio-logo.jpg" alt="Bloxio" width="140" height="52"></a>
    <nav class="main-nav" id="mainNav" aria-label="Main navigation">
      <a class="nav-link" href="index.html">Home</a>
      <a class="nav-link" href="games.html">Games</a>
      <a class="nav-link" href="create.html">Create</a>
      <a class="nav-link" href="community.html">Community</a>
      <a class="nav-link" href="friends.html">Friends</a>
      <a class="nav-link" href="inventory.html">Inventory</a>
    </nav>
    <div class="top-actions">
      <label class="search-box"><svg class="search-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 4.2 4.2"></path></svg><input id="gameSearch" type="search" placeholder="Search games..." aria-label="Search games"><kbd>/</kbd></label>
      <button class="icon-button" id="notifButton" type="button" aria-label="Notifications">🔔<span class="notification-dot" aria-hidden="true"></span></button>
      <details class="account-menu">
        <summary class="avatar" aria-label="Open account menu"><span class="avatar-label">👨🏻‍🚀</span></summary>
        <div class="account-dropdown" aria-label="Account menu">
          <p class="account-identity" id="accountIdentity" hidden></p>
          <a href="profile.html">My Profile</a>
          <a href="store.html#coins">Wallet &amp; Transactions</a>
          <a href="settings.html">Account Settings</a>
          <button type="button" id="signOutButton">Sign Out</button>
        </div>
      </details>
    </div>`;
}

const notifButton = document.getElementById('notifButton');
notifButton?.addEventListener('click', () => showToast('You are all caught up. No new notifications.'));

const searchInput = document.getElementById('gameSearch');
const searchBox = document.querySelector('.search-box');
const gameGrid = document.getElementById('gameGrid');
const gameCards = [...document.querySelectorAll('.game-card')];
const emptyState = document.getElementById('emptyState');
const toast = document.getElementById('toast');
const menuToggle = document.getElementById('menuToggle');
const mainNav = document.getElementById('mainNav');
const headerAvatar = document.querySelector('.avatar');
const viewAll = document.getElementById('viewAll');
const accountIdentity = document.getElementById('accountIdentity');
const signOutButton = document.getElementById('signOutButton');
let toastTimer;

if (headerAvatar) {
  const avatarLabel = headerAvatar.querySelector('.avatar-label');
  if (avatarLabel) avatarLabel.textContent = localStorage.getItem('vexora-avatar') || '👨🏻‍🚀';
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

if (accountIdentity && signOutButton) {
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(async response => {
      if (!response.ok) throw new Error('Unable to load your account details.');
      const result = await response.json();
      // Sign-in is not required, so a signed-out visitor simply stays put.
      if (!result.authenticated) return;
      accountIdentity.textContent = `${result.user.username} · ${result.user.email}`;
      accountIdentity.hidden = false;
    })
    .catch(error => {
      console.error('Unable to load the signed-in Bloxio account.', error);
      showToast('Unable to load your account details. Please refresh the page.');
    });

  signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: '{}'
      });
      if (!response.ok) throw new Error('Sign out failed. Please try again.');
      window.location.assign('/auth.html');
    } catch (error) {
      console.error('Unable to sign out of the Bloxio account.', error);
      showToast(error.message || 'Unable to sign out. Please try again.');
      signOutButton.disabled = false;
    }
  });
}

function setActiveNav() {
  const currentFile = window.location.pathname.split('/').pop().toLowerCase() || 'index.html';
  const mainPage = currentFile === 'game.html' ? 'games.html' : currentFile;
  document.querySelectorAll('.nav-link').forEach(link => {
    const linkFile = link.getAttribute('href')?.split('/').pop() || '';
    const active = linkFile === mainPage;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.addEventListener('hashchange', () => {
    const targetId = window.location.hash.slice(1);
    const targetTab = [...document.querySelectorAll('[data-community-tab]')]
      .find(tab => tab.dataset.communityTab === targetId);
    targetTab?.click();
  });
}

const accountMenu = document.querySelector('.account-menu');
if (accountMenu) {
  accountMenu.addEventListener('toggle', () => {
    accountMenu.querySelector('summary').setAttribute('aria-expanded', String(accountMenu.open));
  });
  document.addEventListener('click', event => {
    if (!accountMenu.contains(event.target)) accountMenu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && accountMenu.open) {
      accountMenu.open = false;
      accountMenu.querySelector('summary').focus();
    }
  });
}

function readFavoriteGames() {
  const storedFavorites = localStorage.getItem('vexora-favorites');
  if (!storedFavorites) return new Set();
  try {
    const favorites = JSON.parse(storedFavorites);
    if (!Array.isArray(favorites) || !favorites.every(game => typeof game === 'string')) {
      throw new TypeError('Saved favorites must be an array of game names.');
    }
    const legacyIds = new Map([
      ['Sky Racing', 'sky-racing'],
      ['Obby Challenge', 'obby-challenge'],
      ['Island Survival', 'island-survival'],
      ['My City Tycoon', 'city-tycoon'],
      ['Mega Parkour', 'mega-parkour']
    ]);
    return new Set(favorites.map(game => legacyIds.get(game) || game));
  } catch (error) {
    console.error('Unable to read saved Bloxio favorites.', error);
    return new Set();
  }
}

const favoriteGames = readFavoriteGames();

function readCommunityArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(value)) throw new TypeError(`Saved community data is invalid: ${key}`);
    return value;
  } catch (error) {
    console.error(`Unable to read local community data (${key}).`, error);
    return [];
  }
}

function saveCommunityArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Unable to save local community data (${key}).`, error);
    showToast('Could not save this change in browser storage.');
    return false;
  }
}

if (searchInput && emptyState && !document.getElementById('categoryFilter')) {
  const filterGames = () => {
    const term = searchInput.value.trim().toLowerCase();
    let visible = 0;
    gameCards.forEach(card => {
      const match = `${card.dataset.name} ${card.dataset.category}`.toLowerCase().includes(term);
      card.hidden = !match;
      if (match) visible++;
    });
    emptyState.hidden = visible > 0;
  };
  searchInput.addEventListener('input', filterGames);
  searchInput.value = new URLSearchParams(window.location.search).get('q') || '';
  filterGames();
}

const gameCatalog = {
  'sky-racing': { name: 'Sky Racing', category: 'Racing', image: 'assets/hero-bg-4.jpg', alt: 'Red sports car on a bright racing track', description: 'Take to the skies in a fast-paced racing world.' },
  'obby-challenge': { name: 'Obby Challenge', category: 'Adventure', image: 'assets/hero-bg-5.jpg', alt: 'Colorful floating obstacle course', description: 'Test your timing across a colorful course of floating platforms.' },
  'island-survival': { name: 'Island Survival', category: 'Survival', image: 'assets/hero-bg-2.jpg', alt: 'Cartoon island camp with a cabin and campfire', description: 'Explore a remote island and discover what it holds.' },
  'city-tycoon': { name: 'My City Tycoon', category: 'Simulator', image: 'assets/hero-bg-3.jpg', alt: 'Bright fantasy city built from colorful blocks', description: 'Imagine and grow a bright city of your own.' },
  'mega-parkour': { name: 'Mega Parkour', category: 'Skill', image: 'assets/mega-parkour.jpg', alt: 'Cartoon character jumping between floating platforms', description: 'Jump between floating platforms in a test of skill.' }
};

const categoryFilter = document.getElementById('categoryFilter');
const gameSort = document.getElementById('gameSort');
if (categoryFilter && gameGrid) {
  const filterCatalog = () => {
    const selectedCategory = categoryFilter.value.toLowerCase();
    const searchTerm = searchInput?.value.trim().toLowerCase() || '';
    let visibleCount = 0;
    gameCards.forEach(card => {
      const matchesCategory = !selectedCategory || card.dataset.category.toLowerCase() === selectedCategory;
      const matchesSearch = `${card.dataset.name} ${card.dataset.category}`.toLowerCase().includes(searchTerm);
      card.hidden = !matchesCategory || !matchesSearch;
      if (!card.hidden) visibleCount++;
    });
    if (emptyState) emptyState.hidden = visibleCount > 0;
  };

  categoryFilter.value = new URLSearchParams(window.location.search).get('category') || '';
  categoryFilter.addEventListener('change', filterCatalog);
  searchInput?.addEventListener('input', filterCatalog);
  gameSort?.addEventListener('change', () => {
    const sorted = [...gameCards].sort((left, right) => {
      const result = left.dataset.name.localeCompare(right.dataset.name);
      return gameSort.value === 'title-desc' ? -result : result;
    });
    sorted.forEach(card => gameGrid.append(card));
  });
  filterCatalog();
}

const gameDetail = document.getElementById('gameDetail');
if (gameDetail) {
  const slug = new URLSearchParams(window.location.search).get('game') || '';
  const game = gameCatalog[slug];
  const missingGame = document.getElementById('gameNotFound');
  if (game) {
    document.title = `${game.name} — Bloxio`;
    document.getElementById('gameBreadcrumb').textContent = game.name;
    document.getElementById('gameDetailTitle').textContent = game.name;
    document.getElementById('gameDetailDescription').textContent = game.description;
    document.getElementById('gameDetailCategory').textContent = game.category;
    document.getElementById('gameDetailCategory').className = `category ${game.category.toLowerCase()}`;
    const image = document.getElementById('gameDetailArt');
    image.src = game.image;
    image.alt = game.alt;
    document.getElementById('launchGame').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('vexora:launch-game', { detail: { gameId: slug } }));
    });
  } else {
    gameDetail.hidden = true;
    missingGame.hidden = false;
  }
}

document.querySelectorAll('[data-community-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetId = tab.dataset.communityTab;
    document.querySelectorAll('[data-community-tab]').forEach(item => {
      const selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('.community-panel').forEach(panel => {
      panel.hidden = panel.id !== targetId;
    });
    if (targetId === 'community-messages') {
      if (window.matchMedia('(max-width: 760px)').matches) {
        document.querySelector('[data-person].selected')?.focus();
      }
    }
    if (window.history.replaceState) {
      window.history.replaceState(null, '', `#${targetId}`);
    } else {
      window.location.hash = targetId;
    }
  });
});

document.querySelectorAll('[data-community-tab]').forEach(tab => {
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-community-tab]')];
    const currentIndex = tabs.indexOf(tab);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex].click();
    tabs[nextIndex].focus();
  });
});

const communityHash = window.location.hash.slice(1);
const isFriendsPage = window.location.pathname.split('/').pop().toLowerCase() === 'friends.html';
const friendTabIds = new Set([
  'community-friends',
  'community-messages',
  'community-requests',
  'community-followers',
  'community-following',
  'community-parties'
]);
if (!isFriendsPage && friendTabIds.has(communityHash)) {
  window.location.replace(`friends.html#${communityHash}`);
}
const defaultCommunityTab = isFriendsPage ? 'community-friends' : 'community-feed';
const communityInitialTab = communityHash && document.getElementById(communityHash)?.classList.contains('community-panel')
  ? communityHash : defaultCommunityTab;
const initialCommunityTab = [...document.querySelectorAll('[data-community-tab]')]
.find(tab => tab.dataset.communityTab === communityInitialTab);
if (initialCommunityTab) {
initialCommunityTab.click();
}

document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('[data-open-message]');
  if (!button) return;
  const target = button.dataset.openMessage;
  const friendsWorkspace = document.querySelector('.friends-workspace');
  const chatList = friendsWorkspace?.querySelector('.friends-list[data-friend-list="chats"]');
  if (!target || !friendsWorkspace || !chatList) return;

  document.querySelector('[data-community-tab="community-messages"]')?.click();
  let person = [...chatList.querySelectorAll('.person-row[data-person]')]
    .find(row => row.dataset.person === target);
  if (!person) {
    const friendCard = button.closest('.community-person');
    const avatar = friendCard?.querySelector('.user-dot');
    const colors = ['sky', 'coral', 'violet', 'gold', 'rose', 'lime'];
    const color = colors.find(name => avatar?.classList.contains(name)) || 'sky';
    person = document.createElement('button');
    person.className = 'person-row';
    person.type = 'button';
    person.dataset.person = target;
    person.dataset.presence = 'Presence unavailable';
    person.dataset.avatar = avatar?.textContent?.trim() || target[0].toUpperCase();
    person.dataset.color = color;
    const userDot = document.createElement('span');
    userDot.className = `user-dot ${color}`;
    userDot.textContent = person.dataset.avatar;
    const copy = document.createElement('span');
    copy.className = 'person-copy';
    const name = document.createElement('strong');
    name.textContent = target;
    const preview = document.createElement('small');
    preview.textContent = 'Start a conversation';
    copy.append(name, preview);
    person.append(userDot, copy);
    chatList.append(person);
  }
  person.click();
});

document.querySelectorAll('.favorite').forEach(button => {
  const gameName = button.closest('.game-card')?.dataset.name;
  const gameId = button.closest('.game-card')?.dataset.gameId;
  if (gameName && gameId && favoriteGames.has(gameId)) {
    button.classList.add('saved');
    button.textContent = '♥';
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', `Remove ${gameName} from favorites`);
  }

  button.addEventListener('click', () => {
    const gameName = button.closest('.game-card')?.dataset.name || 'game';
    const gameId = button.closest('.game-card')?.dataset.gameId;
    if (!gameId) {
      console.error(`Missing catalog identifier for favorite: ${gameName}`);
      return;
    }
    button.classList.toggle('saved');
    const isSaved = button.classList.contains('saved');
    if (isSaved) favoriteGames.add(gameId);
    else favoriteGames.delete(gameId);
    localStorage.setItem('vexora-favorites', JSON.stringify([...favoriteGames]));
    button.textContent = isSaved ? '♥' : '♡';
    button.setAttribute('aria-pressed', String(isSaved));
    button.setAttribute('aria-label', `${isSaved ? 'Remove' : 'Add'} ${gameName} ${isSaved ? 'from' : 'to'} favorites`);
    window.dispatchEvent(new CustomEvent('vexora:favorites-changed'));
    showToast(isSaved ? 'Added to your favorites!' : 'Removed from your favorites.');
  });
});

let followingNames = [];
const followingStorage = localStorage.getItem('vexora-following');
if (followingStorage !== null) {
  try {
    followingNames = JSON.parse(followingStorage);
    if (!Array.isArray(followingNames) || !followingNames.every(name => typeof name === 'string')) {
      throw new TypeError('Saved following list is invalid.');
    }
  } catch (error) {
    console.error('Unable to read saved following list.', error);
    followingNames = [];
  }
} else {
  followingNames = [...document.querySelectorAll('.community-list .friend-row .follow-button.following')]
    .map(button => button.closest('.friend-row').querySelector('.friend-meta strong').textContent);
}
document.querySelectorAll('#community-followers .friend-row .follow-button, #community-following .friend-row .follow-button').forEach(button => {
  const name = button.closest('.friend-row')?.querySelector('.friend-meta strong')?.textContent;
  if (!name) return;
  const isFollowing = followingNames.includes(name);
  button.classList.toggle('following', isFollowing);
  button.textContent = isFollowing ? 'Following' : 'Follow';
});

document.querySelectorAll('.follow-button').forEach(button => {
  button.addEventListener('click', () => {
    if (button.hasAttribute('data-request') || button.closest('.friends-workspace')) return;
    const isFollowing = button.classList.toggle('following');
    const label = button.closest('.friend-row')?.querySelector('.friend-meta strong')?.textContent;
    const person = label || 'player';
    button.textContent = isFollowing ? 'Following' : 'Follow';
    if (label) {
      followingNames = isFollowing
        ? [...new Set([...followingNames, label])]
        : followingNames.filter(name => name !== label);
      localStorage.setItem('vexora-following', JSON.stringify(followingNames));
      document.querySelectorAll('#community-followers .friend-row .follow-button, #community-following .friend-row .follow-button').forEach(item => {
        const itemName = item.closest('.friend-row')?.querySelector('.friend-meta strong')?.textContent;
        if (itemName !== label) return;
        item.classList.toggle('following', isFollowing);
        item.textContent = isFollowing ? 'Following' : 'Follow';
      });
    }
    showToast(`${isFollowing ? 'Following' : 'Unfollowed'} ${person} in this demo.`);
  });
});

document.querySelectorAll('.message-row').forEach(button => {
  button.addEventListener('click', () => {
    showToast(`Opening messages from ${button.dataset.user}.`);
  });
});

document.querySelectorAll('[data-request]').forEach(button => {
  if (button.closest('.friends-workspace')) return;
  button.addEventListener('click', () => {
    const request = button.closest('.friend-row');
    const action = button.dataset.request;
    const user = request.querySelector('.friend-meta strong').textContent;
    if (request.closest('#community-requests')) {
      const dismissed = readCommunityArray('vexora-community-dismissed-requests').filter(name => typeof name === 'string');
      if (!dismissed.includes(user)) dismissed.push(user);
      saveCommunityArray('vexora-community-dismissed-requests', dismissed);
      if (action === 'accept') {
        const accepted = readCommunityArray('vexora-community-accepted-players')
          .filter(player => player && typeof player.name === 'string' && typeof player.avatar === 'string' && typeof player.color === 'string');
        if (!accepted.some(player => player.name === user)) {
          const player = { name: user, avatar: user[0], color: user === 'KaiBuilds' ? 'gold' : 'rose' };
          accepted.push(player);
          if (saveCommunityArray('vexora-community-accepted-players', accepted)) {
            window.dispatchEvent(new CustomEvent('vexora:friend-accepted', { detail: player }));
          }
        }
      }
    }
    request.remove();
    const requestHeading = [...document.querySelectorAll('.friends-layout .panel-header h2')].find(heading => heading.textContent === 'Friend requests');
    const pending = requestHeading?.nextElementSibling;
    const remaining = document.querySelectorAll('[data-request="accept"]').length;
    if (pending) pending.textContent = `${remaining} pending`;
    showToast(`${user} request ${action === 'accept' ? 'accepted' : 'declined'} in this demo.`);
  });
});

document.querySelectorAll('[data-message-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    const selected = tab.dataset.messageTab;
    document.querySelectorAll('[data-message-tab]').forEach(item => {
      const isSelected = item === tab;
      item.classList.toggle('active', isSelected);
      item.setAttribute('aria-selected', String(isSelected));
    });
    document.querySelectorAll('[data-message-list]').forEach(list => {
      list.hidden = list.dataset.messageList !== selected;
    });
  });
});

const friendsWorkspace = document.querySelector('.friends-workspace');
if (friendsWorkspace) {
  const friendTabs = [...friendsWorkspace.querySelectorAll('[data-friend-tab]')];
  const friendLists = [...friendsWorkspace.querySelectorAll('[data-friend-list]')];
  const peopleSearch = document.getElementById('peopleSearch');
  const peopleEmpty = document.getElementById('peopleEmpty');
  const chatName = document.getElementById('chatName');
  const chatPresence = document.getElementById('chatPresence');
  const chatAvatar = document.getElementById('chatAvatar');
  const chatHistory = document.getElementById('chatHistory');
  const chatInput = document.getElementById('chatInput');
  const chatForm = document.getElementById('chatForm');
  const chatBack = document.getElementById('chatBack');
  let activeChat = 'LunaRay';
  const canReceiveLocalMessages = localStorage.getItem('vexora-setting-directMessages') !== 'false';
  if (chatInput && chatForm) {
    chatInput.disabled = !canReceiveLocalMessages;
    chatForm.querySelector('button[type="submit"]').disabled = !canReceiveLocalMessages;
    if (!canReceiveLocalMessages) chatInput.placeholder = 'Direct messages are disabled in Account Settings';
  }

  const conversations = {
    LunaRay: [
      ['received', 'LunaRay · 10:42 AM', 'Hey! Want to join my party?'],
      ['sent', 'You · 10:44 AM', 'Sure, which game are you playing?'],
      ['received', 'LunaRay · 10:45 AM', 'Sky Racing! I sent you an invite.']
    ],
    PixelFox: [
      ['received', 'PixelFox · 10:28 AM', 'Hey, want to play Sky Racing?']
    ],
    NovaSpawn: [
      ['received', 'NovaSpawn · 9:16 AM', 'Shared a cool build with you.']
    ]
  };
  const savedConversations = localStorage.getItem('vexora-demo-conversations');
  if (savedConversations) {
    try {
      const parsedConversations = JSON.parse(savedConversations);
      Object.entries(parsedConversations).forEach(([person, messages]) => {
        if (!Array.isArray(messages) || !messages.every(message =>
          Array.isArray(message) && message.length === 3 &&
          ['received', 'sent'].includes(message[0]) &&
          message.every(part => typeof part === 'string'))) return;
        conversations[person] = messages;
      });
    } catch (error) {
      console.error('Unable to read saved Bloxio demo conversations.', error);
    }
  }

  function renderConversation(person, presence, avatar, color) {
    activeChat = person;
    chatName.textContent = person;
    chatPresence.textContent = presence;
    chatAvatar.textContent = avatar;
    chatAvatar.className = `user-dot ${color}`;
    chatHistory.replaceChildren();
    const date = document.createElement('p');
    date.className = 'chat-date';
    date.textContent = 'Today';
    chatHistory.append(date);
    (conversations[person] || []).forEach(([direction, label, text]) => {
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${direction}`;
      const meta = document.createElement('small');
      meta.textContent = label;
      bubble.append(meta, document.createTextNode(text));
      chatHistory.append(bubble);
    });
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  friendTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      friendTabs.forEach(item => {
        const selected = item === tab;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-current', selected ? 'page' : 'false');
      });
      friendLists.forEach(list => {
        list.hidden = list.dataset.friendList !== tab.dataset.friendTab;
      });
      if (peopleSearch) peopleSearch.value = '';
      if (peopleEmpty) peopleEmpty.hidden = true;
    });
  });

  friendsWorkspace.querySelector('.friends-list[data-friend-list="chats"]')?.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const person = event.target.closest('.person-row[data-person]');
    if (!person) return;
    friendsWorkspace.querySelectorAll('.person-row[data-person]').forEach(item => item.classList.remove('selected'));
    person.classList.add('selected');
    renderConversation(person.dataset.person, person.dataset.presence, person.dataset.avatar, person.dataset.color);
    if (window.matchMedia('(max-width: 760px)').matches) {
      friendsWorkspace.classList.add('conversation-open');
    }
  });

  if (peopleSearch) {
    peopleSearch.addEventListener('input', () => {
      const activeList = friendLists.find(list => !list.hidden);
      if (!activeList) return;
      const term = peopleSearch.value.trim().toLowerCase();
      const rows = [...activeList.querySelectorAll('.person-row')];
      let visibleCount = 0;
      rows.forEach(row => {
        const matches = row.textContent.toLowerCase().includes(term);
        row.hidden = !matches;
        if (matches) visibleCount++;
      });
      if (peopleEmpty) peopleEmpty.hidden = visibleCount !== 0;
    });
  }

  friendsWorkspace.querySelectorAll('[data-request]').forEach(button => {
    button.addEventListener('click', () => {
      const row = button.closest('.person-row');
      const user = row.querySelector('.person-copy strong').textContent;
      const action = button.dataset.request;
      row.remove();
      const remaining = friendsWorkspace.querySelectorAll('[data-request="accept"]').length;
      const count = document.getElementById('requestCount');
      if (count) count.textContent = String(remaining);
      showToast(action === 'accept' ? `${user} added to your friends.` : `Request from ${user} declined.`);
    });
  });

  friendsWorkspace.querySelectorAll('.follow-person .follow-button').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const wasFollowing = button.classList.contains('following');
      button.classList.toggle('following', !wasFollowing);
      button.textContent = wasFollowing ? 'Follow' : 'Following';
      showToast(wasFollowing ? 'Follow removed.' : 'You are now following this player.');
    });
  });

  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', event => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      const timestamp = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date());
      const message = ['sent', `You · ${timestamp}`, text];
      conversations[activeChat] = [...(conversations[activeChat] || []), message];
      localStorage.setItem('vexora-demo-conversations', JSON.stringify(conversations));
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble sent';
      const meta = document.createElement('small');
      meta.textContent = message[1];
      bubble.append(meta, document.createTextNode(text));
      chatHistory.append(bubble);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      chatInput.value = '';
      const activePerson = friendsWorkspace.querySelector('.person-row.selected .person-copy small');
      if (activePerson) activePerson.textContent = text;
    });
  }

  if (chatBack) {
    chatBack.addEventListener('click', () => friendsWorkspace.classList.remove('conversation-open'));
  }
}

document.querySelectorAll('.social-action').forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.action || 'Action';
    showToast(`${action} isn't connected in this local demo.`);
  });
});

if (viewAll) {
  viewAll.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    gameCards.forEach(card => card.hidden = false);
    if (emptyState) emptyState.hidden = true;
  });
}

if (menuToggle && mainNav) {
  menuToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    if (link.closest('.nav-menu')) return;
    document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('active'));
    link.classList.add('active');
    if (mainNav) mainNav.classList.remove('open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  });
});

const avatarPreview = document.getElementById('avatarPreview');
if (avatarPreview) {
  const displayName = document.getElementById('profileDisplayName');
  const username = document.getElementById('profileUsername');
  const bio = document.getElementById('profileBio');
  const mode = document.getElementById('profileMode');
  const editButton = document.getElementById('editProfileButton');
  const editForm = document.getElementById('profileEditForm');
  const nameInput = document.getElementById('profileNameInput');
  const bioInput = document.getElementById('profileBioInput');
  const savedName = localStorage.getItem('vexora-profile-name');
  const savedBio = localStorage.getItem('vexora-profile-bio');
  const savedAvatar = localStorage.getItem('vexora-avatar') || '👨🏻‍🚀';
  avatarPreview.textContent = savedAvatar;
  if (savedName && displayName) displayName.textContent = savedName;
  if (savedBio && bio) bio.textContent = savedBio;
  if (nameInput) nameInput.value = displayName?.textContent || '';
  if (bioInput) bioInput.value = bio?.textContent || '';

  const publicUser = new URLSearchParams(window.location.search).get('user');
  if (publicUser) {
    const publicProfiles = new Set(['LunaRay', 'PixelFox', 'NovaSpawn', 'KaiBuilds', 'JadeRunner']);
    const isKnownProfile = publicProfiles.has(publicUser);
    const publicAvatars = { LunaRay: 'L', PixelFox: 'P', NovaSpawn: 'N', KaiBuilds: 'K', JadeRunner: 'J' };
    avatarPreview.textContent = isKnownProfile ? publicAvatars[publicUser] : '?';
    if (displayName) displayName.textContent = isKnownProfile ? publicUser : 'Profile unavailable';
    if (username) username.textContent = isKnownProfile ? `@${publicUser.toLowerCase()}` : '';
    if (bio) bio.textContent = isKnownProfile ? 'Public profile information is not available in this demo.' : 'This player is not in the local sample list.';
    if (mode) mode.textContent = 'Public demo profile';
    if (editButton) editButton.hidden = true;
    if (editForm) editForm.hidden = true;
    document.querySelectorAll('.profile-tab').forEach(tab => {
      if (tab.dataset.profileTab !== 'profile-overview') tab.hidden = true;
    });
    document.querySelectorAll('.profile-section').forEach(section => {
      section.hidden = section.id !== 'profile-overview';
    });
  } else {
    if (editButton && editForm) {
      editButton.addEventListener('click', () => {
        editForm.hidden = !editForm.hidden;
        if (!editForm.hidden) nameInput.focus();
      });
    }
    document.getElementById('cancelProfileEdit')?.addEventListener('click', () => {
      editForm.hidden = true;
      nameInput.value = displayName.textContent;
      bioInput.value = bio.textContent;
    });
    editForm?.addEventListener('submit', event => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      localStorage.setItem('vexora-profile-name', name);
      localStorage.setItem('vexora-profile-bio', bioInput.value.trim());
      displayName.textContent = name;
      bio.textContent = bioInput.value.trim() || 'Add a short introduction about yourself.';
      editForm.hidden = true;
      showToast('Profile saved on this device.');
    });

    const profileTabs = [...document.querySelectorAll('[data-profile-tab]')];
    const selectProfileTab = (tab, updateHash = true) => {
      profileTabs.forEach(item => {
        const selected = item === tab;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      document.querySelectorAll('.profile-section').forEach(section => {
        section.hidden = section.id !== tab.dataset.profileTab;
      });
      if (updateHash) window.location.hash = tab.dataset.profileTab.slice('profile-'.length);
    };
    profileTabs.forEach(tab => {
      tab.addEventListener('click', () => selectProfileTab(tab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...document.querySelectorAll('[data-profile-tab]:not([hidden])')];
        const current = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].click();
        tabs[next].focus();
      });
    });
    const requestedProfileTab = `profile-${window.location.hash.slice(1)}`;
    const activateProfileTabFromHash = () => {
      const hash = window.location.hash.slice(1);
      const tab = profileTabs.find(item => item.dataset.profileTab === `profile-${hash}`);
      if (tab) selectProfileTab(tab, false);
      else if (!hash) {
        const overviewTab = profileTabs.find(item => item.dataset.profileTab === 'profile-overview');
        if (overviewTab) selectProfileTab(overviewTab, false);
      }
    };
    profileTabs.forEach(tab => {
      tab.tabIndex = tab.classList.contains('active') ? 0 : -1;
    });
    const initialProfileTab = profileTabs.find(tab => tab.dataset.profileTab === requestedProfileTab);
    if (initialProfileTab) selectProfileTab(initialProfileTab, false);
    window.addEventListener('hashchange', activateProfileTabFromHash);

    const avatarChoices = [...document.querySelectorAll('.avatar-choice')];
    const equippedLabel = document.getElementById('equippedAvatarLabel');
    function setAvatarPreview(avatar) {
      avatarPreview.textContent = avatar;
      avatarChoices.forEach(choice => {
        const selected = choice.dataset.avatar === avatar;
        choice.classList.toggle('selected', selected);
        choice.setAttribute('aria-pressed', String(selected));
      });
      if (equippedLabel) equippedLabel.textContent = `Selected avatar: ${avatar} · save to equip`;
    }
    setAvatarPreview(savedAvatar);
    avatarChoices.forEach(choice => {
      choice.addEventListener('click', () => setAvatarPreview(choice.dataset.avatar));
    });
    document.getElementById('saveAvatar')?.addEventListener('click', () => {
      localStorage.setItem('vexora-avatar', avatarPreview.textContent);
      const avatarLabel = document.querySelector('.account-menu .avatar-label');
      if (avatarLabel) avatarLabel.textContent = avatarPreview.textContent;
      if (equippedLabel) equippedLabel.textContent = `Equipped avatar: ${avatarPreview.textContent}`;
      showToast('Avatar saved on this device.');
    });

    const profileFavorites = document.getElementById('profileFavoriteGames');
    const favoritesEmpty = document.getElementById('profileFavoritesEmpty');
    if (profileFavorites) {
      const savedFavorites = [...favoriteGames].filter(slug => gameCatalog[slug]);
      savedFavorites.forEach(slug => {
        const game = gameCatalog[slug];
        const card = document.createElement('article');
        card.className = 'game-card';
        const image = document.createElement('a');
        image.className = 'game-image game-play';
        image.href = `game.html?game=${encodeURIComponent(slug)}`;
        image.setAttribute('aria-label', `View ${game.name} details`);
        const artwork = document.createElement('img');
        artwork.src = game.image;
        artwork.alt = game.alt;
        const overlay = document.createElement('span');
        overlay.className = 'play-overlay';
        overlay.textContent = 'View game';
        image.append(artwork, overlay);
        const info = document.createElement('div');
        info.className = 'game-info';
        const title = document.createElement('h3');
        title.textContent = game.name;
        const genre = document.createElement('span');
        genre.className = `category ${game.category.toLowerCase()}`;
        genre.textContent = game.category;
        info.append(title, genre);
        card.append(image, info);
        profileFavorites.append(card);
      });
      if (favoritesEmpty) favoritesEmpty.hidden = savedFavorites.length > 0;
    }
  }
}

document.querySelectorAll('[data-setting]').forEach(setting => {
  const key = `vexora-setting-${setting.dataset.setting}`;
  const savedValue = localStorage.getItem(key);
  if (savedValue !== null) setting.checked = savedValue === 'true';
  if (setting.dataset.setting === 'reducedMotion' && setting.checked) {
    document.documentElement.classList.add('reduced-motion');
  }
  setting.addEventListener('change', () => {
    localStorage.setItem(key, String(setting.checked));
    if (setting.dataset.setting === 'reducedMotion') {
      document.documentElement.classList.toggle('reduced-motion', setting.checked);
    }
    if (setting.dataset.setting === 'friendActivity') {
      const state = document.getElementById('friendActivityState');
      if (state) state.textContent = setting.checked ? 'Activity sharing is enabled locally.' : 'Activity sharing is disabled locally.';
      const communityState = document.getElementById('communityFriendStatus');
      if (communityState) communityState.textContent = setting.checked
        ? 'Your activity sharing preference is on. Live presence is not connected.'
        : 'Your activity sharing preference is off. Live presence is not connected.';
    }
    if (setting.dataset.setting === 'directMessages') {
      const state = document.getElementById('directMessagesState');
      if (state) state.textContent = setting.checked ? 'Local demo messages are allowed.' : 'Local demo message sending is disabled.';
    }
    showToast('Preference saved on this device.');
  });
  if (setting.dataset.setting === 'friendActivity') {
    const state = document.getElementById('friendActivityState');
    if (state) state.textContent = setting.checked ? 'Activity sharing is enabled locally.' : 'Activity sharing is disabled locally.';
    const communityState = document.getElementById('communityFriendStatus');
    if (communityState) communityState.textContent = setting.checked
      ? 'Your activity sharing preference is on. Live presence is not connected.'
      : 'Your activity sharing preference is off. Live presence is not connected.';
  }
  if (setting.dataset.setting === 'directMessages') {
    const state = document.getElementById('directMessagesState');
    if (state) state.textContent = setting.checked ? 'Local demo messages are allowed.' : 'Local demo message sending is disabled.';
  }
});

const inventoryGrid = document.getElementById('inventoryGrid');
if (inventoryGrid) {
  const inventoryItems = [...inventoryGrid.querySelectorAll('.inventory-item')];
  let equippedItems = [];
  try {
    equippedItems = JSON.parse(localStorage.getItem('vexora-equipped-items') || '[]');
    if (!Array.isArray(equippedItems) || !equippedItems.every(item => typeof item === 'string')) throw new TypeError('Equipped item data is invalid.');
  } catch (error) {
    console.error('Unable to read equipped inventory items.', error);
    equippedItems = [];
  }
  const filterItems = selected => {
    let visible = 0;
    inventoryItems.forEach(item => {
      item.hidden = selected !== 'all' && item.dataset.itemCategory !== selected;
      if (!item.hidden) visible++;
    });
    document.getElementById('inventoryEmpty').hidden = visible > 0;
  };
  document.querySelectorAll('[data-inventory-filter]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-inventory-filter]').forEach(item => {
        const selected = item === tab;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      filterItems(tab.dataset.inventoryFilter);
    });
  });
  inventoryItems.forEach(item => {
    const itemName = item.querySelector('strong').textContent;
    const equipButton = item.querySelector('.item-equip');
    if (equipButton) {
      const renderEquipState = () => {
        const equipped = equippedItems.includes(item.dataset.itemId);
        equipButton.textContent = equipped ? 'Unequip' : 'Equip';
        equipButton.setAttribute('aria-pressed', String(equipped));
        item.classList.toggle('is-equipped', equipped);
      };
      renderEquipState();
      equipButton.addEventListener('click', () => {
        equippedItems = equippedItems.includes(item.dataset.itemId)
          ? equippedItems.filter(id => id !== item.dataset.itemId)
          : [...equippedItems, item.dataset.itemId];
        localStorage.setItem('vexora-equipped-items', JSON.stringify(equippedItems));
        renderEquipState();
        showToast(`${itemName} ${equippedItems.includes(item.dataset.itemId) ? 'equipped' : 'unequipped'} on this device.`);
      });
    }
    item.querySelector('.item-view')?.addEventListener('click', () => {
      showToast(`${itemName} — ${item.querySelector('.item-rarity').textContent} sample item.`);
    });
  });
}

if (searchInput) {
  if (searchBox) {
    searchBox.addEventListener('click', event => {
      if (window.matchMedia('(max-width: 760px)').matches && !searchBox.classList.contains('search-open')) {
        event.preventDefault();
        searchBox.classList.add('search-open');
        searchInput.focus();
      }
    });
    searchInput.addEventListener('blur', () => searchBox.classList.remove('search-open'));
  }

  document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === 'Escape') searchInput.blur();
  });
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const isGamesPage = window.location.pathname.split('/').pop().toLowerCase().startsWith('games');
      const query = searchInput.value.trim();
      if (isGamesPage) {
        event.preventDefault();
        const url = new URL(window.location);
        if (query) url.searchParams.set('q', query);
        else url.searchParams.delete('q');
        window.history.replaceState({}, '', url);
      } else if (query) {
        window.location.href = `games.html?q=${encodeURIComponent(query)}`;
      }
    }
  });
}

const storeGrid = document.getElementById('storeGrid');
if (storeGrid) {
  const storeCards = [...storeGrid.querySelectorAll('[data-store-product]')];
  const storeSearch = document.getElementById('storeSearch');
  const storeCategory = document.getElementById('storeCategory');
  const storeEmpty = document.getElementById('storeEmpty');
  const storeDialog = document.getElementById('storeProductDialog');

  const filterStore = () => {
    const query = storeSearch.value.trim().toLowerCase();
    const category = storeCategory.value;
    let visible = 0;
    storeCards.forEach(card => {
      const matchesCategory = !category || card.dataset.storeCategories.split(' ').includes(category);
      const matchesSearch = card.textContent.toLowerCase().includes(query);
      card.hidden = !matchesCategory || !matchesSearch;
      if (!card.hidden) visible++;
    });
    storeEmpty.hidden = visible > 0;
  };

  storeSearch.addEventListener('input', filterStore);
  storeCategory.addEventListener('change', filterStore);
  storeGrid.addEventListener('click', event => {
    const detailsButton = event.target.closest('[data-store-details]');
    if (!detailsButton) return;
    const card = detailsButton.closest('[data-store-product]');
    storeDialog.querySelector('[data-dialog-name]').textContent = card.dataset.productName;
    storeDialog.querySelector('[data-dialog-price]').textContent = card.dataset.productPrice;
    storeDialog.showModal();
  });
  storeDialog.querySelector('[data-dialog-close]').addEventListener('click', () => storeDialog.close());
  storeDialog.addEventListener('click', event => {
    const rect = storeDialog.getBoundingClientRect();
    const isInDialog = (rect.top <= event.clientY && event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX && event.clientX <= rect.left + rect.width);
    if (!isInDialog) storeDialog.close();
  });
}

const heroCarousel = document.getElementById('heroCarousel');
if (heroCarousel) {
  const heroSlides = [
    {
      image: 'assets/hero-bg-1.jpg',
      imageAlt: 'A colorful floating island game world',
      eyebrow: 'YOUR NEXT ADVENTURE STARTS HERE',
      titleLine: 'Welcome to',
      titleAccent: 'Bloxio',
      tagline: 'Play. Create. Explore.',
      description: 'Discover amazing games, build your own worlds, and hang out with friends — all in one place.',
      cta: 'Start Playing',
      href: 'games.html',
      icon: '▶'
    },
    {
      image: 'assets/hero-bg-2.jpg',
      imageAlt: 'A cartoon island ready to explore',
      eyebrow: 'ADVENTURE IS CLOSER THAN YOU THINK',
      titleLine: 'Discover',
      titleAccent: 'New Worlds',
      tagline: 'Your next adventure awaits.',
      description: 'Explore colorful islands, uncover hidden places, and find a world that feels like yours.',
      cta: 'Explore Games',
      href: 'games.html',
      icon: '▶'
    },
    {
      image: 'assets/hero-bg-3.jpg',
      imageAlt: 'A bright fantasy city built from colorful blocks',
      eyebrow: 'YOUR IDEAS, YOUR WORLD',
      titleLine: 'Build Your',
      titleAccent: 'Own Game',
      tagline: 'Create something incredible.',
      description: 'Dream up a world of your own and take the first step in the creator studio.',
      cta: 'Start Creating',
      href: 'create.html',
      icon: '✦'
    },
    {
      image: 'assets/hero-bg-4.jpg',
      imageAlt: 'A bright racing world with a red sports car',
      eyebrow: 'PICK UP THE PACE',
      titleLine: 'Race, Jump,',
      titleAccent: 'Survive',
      tagline: 'Find your next challenge.',
      description: 'Take on high-speed races, daring jumps, and adventures that keep you moving.',
      cta: 'Find a Challenge',
      href: 'games.html',
      icon: '▶'
    },
    {
      image: 'assets/hero-bg-5.jpg',
      imageAlt: 'A colorful floating obstacle course',
      eyebrow: 'READY, SET, GO',
      titleLine: 'Take on the',
      titleAccent: 'Obstacle Course',
      tagline: 'One more level. One more win.',
      description: 'Test your timing, leap across floating platforms, and see how far you can go.',
      cta: 'Play Obby Challenge',
      href: 'games.html',
      icon: '▶'
    }
  ];
  const heroArt = heroCarousel.querySelector('.hero-art');
  const heroScenes = [...heroCarousel.querySelectorAll('.hero-scene')];
  const heroContent = heroCarousel.querySelector('.hero-content');
  const heroEyebrow = document.getElementById('heroEyebrow');
  const heroTitle = document.getElementById('heroTitle');
  const heroTitleLine = document.getElementById('heroTitleLine');
  const heroTitleAccent = document.getElementById('heroTitleAccent');
  const heroTagline = document.getElementById('heroTagline');
  const heroDescription = document.getElementById('heroDescription');
  const heroCta = document.getElementById('heroCta');
  const heroCtaLabel = document.getElementById('heroCtaLabel');
  const heroCtaIcon = heroCta.querySelector('span');
  const heroPagination = heroCarousel.querySelector('.hero-pagination');
  const reducedMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const imageLoads = new Map();
  let activeHeroSlide = 0;
  let activeHeroLayer = 0;
  let heroChangeRequest = 0;
  let heroTimer = 0;
  let pointerPausedHero = false;
  let focusPausedHero = false;

  if (localStorage.getItem('vexora-setting-reducedMotion') === 'true') {
    document.documentElement.classList.add('reduced-motion');
  }

  function loadHeroImage(source) {
    if (!imageLoads.has(source)) {
      imageLoads.set(source, new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => {
          console.error(`Unable to load hero image: ${source}`);
          resolve(false);
        };
        image.src = source;
      }));
    }
    return imageLoads.get(source);
  }

  function heroMotionIsReduced() {
    return document.documentElement.classList.contains('reduced-motion');
  }

  function clearHeroTimer() {
    window.clearTimeout(heroTimer);
    heroTimer = 0;
  }

  function scheduleHeroSlide() {
    clearHeroTimer();
    if (pointerPausedHero || focusPausedHero || document.hidden || heroMotionIsReduced()) return;
    heroTimer = window.setTimeout(() => {
      changeHeroSlide((activeHeroSlide + 1) % heroSlides.length);
    }, 4000);
  }

  async function changeHeroSlide(index) {
    clearHeroTimer();
    const request = ++heroChangeRequest;
    if (index === activeHeroSlide) {
      scheduleHeroSlide();
      return;
    }
    const slide = heroSlides[index];
    const imageLoaded = await loadHeroImage(slide.image);
    if (request !== heroChangeRequest) return;

    const layerIndex = 1 - activeHeroLayer;
    const backgroundImage = imageLoaded ? slide.image : heroSlides[0].image;
    heroScenes[layerIndex].style.backgroundImage = `url("${backgroundImage}")`;
    heroScenes[layerIndex].classList.remove('is-active');
    void heroScenes[layerIndex].offsetWidth;
    heroScenes[layerIndex].classList.add('is-active');
    heroScenes[activeHeroLayer].classList.remove('is-active');
    activeHeroLayer = layerIndex;
    activeHeroSlide = index;
    heroArt.setAttribute('aria-label', imageLoaded ? slide.imageAlt : heroSlides[0].imageAlt);

    heroContent.classList.add('is-changing');
    heroEyebrow.textContent = slide.eyebrow;
    heroTitleLine.textContent = slide.titleLine;
    heroTitleAccent.textContent = slide.titleAccent;
    heroTitle.setAttribute('aria-label', `${slide.titleLine} ${slide.titleAccent}`);
    heroTagline.textContent = slide.tagline;
    heroDescription.textContent = slide.description;
    heroCta.href = slide.href;
    heroCtaIcon.textContent = slide.icon;
    heroCtaLabel.textContent = slide.cta;
    window.requestAnimationFrame(() => heroContent.classList.remove('is-changing'));

    heroPagination.querySelectorAll('.hero-dot').forEach((dot, dotIndex) => {
      const isCurrent = dotIndex === index;
      dot.setAttribute('aria-current', String(isCurrent));
      dot.setAttribute('aria-label', `Show ${heroSlides[dotIndex].titleLine} ${heroSlides[dotIndex].titleAccent}`);
    });

    window.setTimeout(() => loadHeroImage(heroSlides[(index + 1) % heroSlides.length].image), 700);
    scheduleHeroSlide();
  }

  heroSlides.forEach((slide, index) => {
    const dot = document.createElement('button');
    dot.className = 'hero-dot';
    dot.type = 'button';
    dot.setAttribute('aria-label', `Show ${slide.titleLine} ${slide.titleAccent}`);
    dot.setAttribute('aria-current', String(index === activeHeroSlide));
    dot.addEventListener('click', () => changeHeroSlide(index));
    heroPagination.append(dot);
  });

  heroCarousel.querySelector('.hero-previous').addEventListener('click', () => {
    changeHeroSlide((activeHeroSlide - 1 + heroSlides.length) % heroSlides.length);
  });
  heroCarousel.querySelector('.hero-next').addEventListener('click', () => {
    changeHeroSlide((activeHeroSlide + 1) % heroSlides.length);
  });
  heroCarousel.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      changeHeroSlide((activeHeroSlide + direction + heroSlides.length) % heroSlides.length);
    }
  });

  heroCarousel.addEventListener('mouseenter', () => {
    pointerPausedHero = true;
    clearHeroTimer();
  });
  heroCarousel.addEventListener('mouseleave', () => {
    pointerPausedHero = false;
    scheduleHeroSlide();
  });
  heroCarousel.addEventListener('focusin', () => {
    focusPausedHero = true;
    clearHeroTimer();
  });
  heroCarousel.addEventListener('focusout', event => {
    if (event.relatedTarget && heroCarousel.contains(event.relatedTarget)) return;
    focusPausedHero = false;
    scheduleHeroSlide();
  });
  heroCarousel.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || heroMotionIsReduced() || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    const bounds = heroCarousel.getBoundingClientRect();
    const offsetX = (event.clientX - bounds.left) / bounds.width - 0.5;
    const offsetY = (event.clientY - bounds.top) / bounds.height - 0.5;
    heroArt.style.setProperty('--hero-shift-x', `${-offsetX * 8}px`);
    heroArt.style.setProperty('--hero-shift-y', `${-offsetY * 6}px`);
  });
  heroCarousel.addEventListener('pointerleave', () => {
    heroArt.style.setProperty('--hero-shift-x', '0px');
    heroArt.style.setProperty('--hero-shift-y', '0px');
  });
  document.addEventListener('visibilitychange', scheduleHeroSlide);
  reducedMotionPreference.addEventListener?.('change', scheduleHeroSlide);
  window.setTimeout(() => loadHeroImage(heroSlides[1].image), 1200);
  scheduleHeroSlide();
}

setActiveNav();
