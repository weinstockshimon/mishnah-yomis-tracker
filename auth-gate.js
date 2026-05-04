(() => {
  const SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gsMVtiDUhfZVw1oCYp1RlA_pwWMErw7";

  const appShell = document.querySelector(".app-shell");
  const topbar = document.querySelector(".topbar");
  const todayPill = document.querySelector(".today-pill");
  const syncPanel = document.querySelector(".sync-panel");
  const syncCopy = document.querySelector(".sync-copy");
  const authForm = document.querySelector("#authForm");
  const signOutButton = document.querySelector("#signOutButton");

  if (!appShell || !syncPanel || !authForm || !syncCopy) {
    return;
  }

  const authScreen = document.createElement("section");
  authScreen.className = "auth-screen";
  authScreen.id = "authScreen";
  authScreen.setAttribute("aria-labelledby", "authTitle");

  const authCard = document.createElement("div");
  authCard.className = "auth-card";
  authCard.innerHTML = `
    <p class="eyebrow">Mishnah Yomis</p>
    <h1 id="authTitle">Sign in to your tracker</h1>
    <p class="auth-note">Your checkmarks and study photos will sync across your phone and computer.</p>
  `;

  authCard.append(syncCopy, authForm);
  authScreen.append(authCard);
  document.body.insertBefore(authScreen, appShell);
  syncPanel.classList.add("auth-moved");

  if (topbar && todayPill && signOutButton) {
    let topActions = topbar.querySelector(".top-actions");
    if (!topActions) {
      topActions = document.createElement("div");
      topActions.className = "top-actions";
      todayPill.replaceWith(topActions);
      topActions.append(todayPill);
    }
    topActions.append(signOutButton);
  }

  function showSignedIn() {
    document.body.classList.add("auth-signed-in");
    document.body.classList.remove("auth-signed-out");
    if (signOutButton) signOutButton.hidden = false;
  }

  function showSignedOut() {
    document.body.classList.add("auth-signed-out");
    document.body.classList.remove("auth-signed-in");
    if (signOutButton) signOutButton.hidden = true;
  }

  showSignedOut();

  if (!window.supabase?.createClient) {
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  client.auth.getSession().then(({ data }) => {
    if (data.session?.user) {
      showSignedIn();
      return;
    }
    showSignedOut();
  });

  client.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      showSignedIn();
      return;
    }
    showSignedOut();
  });
})();
