(() => {
  const SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gsMVtiDUhfZVw1oCYp1RlA_pwWMErw7";
  const PHOTO_BUCKET = "study-photos";
  const PASSCODE_KEY = "mishnah-yomis-passcode-v1";

  if (!window.MISHNAH_YOMIS_DATA) {
    return;
  }

  const client = window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

  const DATA = window.MISHNAH_YOMIS_DATA;
  const syncPanel = document.querySelector(".sync-panel");
  const syncCopy = document.querySelector(".sync-copy");
  const authForm = document.querySelector("#authForm");
  const authInput = document.querySelector("#authEmail");
  const authButton = document.querySelector("#authButton");
  const signOutButton = document.querySelector("#signOutButton");
  const toolbar = document.querySelector(".toolbar");
  const titleBlock = document.querySelector(".topbar > div:first-child");
  const appTitle = document.querySelector("#app-title");
  const appShell = document.querySelector(".app-shell");

  let passcode = localStorage.getItem(PASSCODE_KEY) || "";
  let unlocked = Boolean(passcode);
  let cloudReady = false;
  let applyingCloud = false;
  let previousCompleted = snapshotCompleted();
  let selectedCalendarItemId = null;

  if (toolbar) {
    toolbar.remove();
  }

  if (typeof visibleItems === "function") {
    visibleItems = function visibleDueItems(collections) {
      return collections.due;
    };
  }

  if (authInput) {
    authInput.id = "passcodeInput";
    authInput.type = "password";
    authInput.autocomplete = "current-password";
    authInput.placeholder = "Passcode";
    authInput.value = "";
  }

  if (authButton) {
    authButton.textContent = "Unlock";
  }

  if (signOutButton) {
    signOutButton.textContent = "Lock";
  }

  if (titleBlock && appTitle && signOutButton && !titleBlock.querySelector(".title-row")) {
    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    appTitle.replaceWith(titleRow);
    titleRow.append(appTitle, signOutButton);
  }

  const topStatus = document.createElement("div");
  topStatus.className = "sync-copy top-sync-copy";
  topStatus.innerHTML = `
    <span id="topSyncStatus">Locked</span>
    <strong id="topSyncUser">Private tracker</strong>
  `;
  if (titleBlock) {
    titleBlock.append(topStatus);
  }

  const authScreen = document.createElement("section");
  authScreen.className = "auth-screen passcode-screen";
  authScreen.id = "authScreen";
  authScreen.setAttribute("aria-labelledby", "authTitle");

  const authCard = document.createElement("div");
  authCard.className = "auth-card";
  authCard.innerHTML = `
    <p class="eyebrow">Mishnah Yomis</p>
    <h1 id="authTitle">Private tracker</h1>
    <p class="auth-note">Enter your passcode to update progress and save study photos.</p>
  `;

  if (syncCopy) {
    authCard.append(syncCopy);
  }
  if (authForm) {
    authForm.hidden = false;
    authForm.style.display = "";
    authCard.append(authForm);
  }
  authScreen.append(authCard);
  document.body.insertBefore(authScreen, appShell);

  if (syncPanel) {
    syncPanel.remove();
  }

  function setStatus(message) {
    const status = document.querySelector("#syncStatus");
    if (status) {
      status.textContent = message;
    }
    const top = document.querySelector("#topSyncStatus");
    if (top) {
      top.textContent = message;
    }
  }

  function setUserText(message) {
    const syncUser = document.querySelector("#syncUser");
    if (syncUser) {
      syncUser.textContent = message;
    }
    const topUser = document.querySelector("#topSyncUser");
    if (topUser) {
      topUser.textContent = message;
    }
  }

  function snapshotCompleted() {
    return { ...state.completed };
  }

  function changedCompleted() {
    const changes = [];
    for (const item of DATA.items) {
      const before = Boolean(previousCompleted[item.id]);
      const after = Boolean(state.completed[item.id]);
      if (before !== after) {
        changes.push({ item, completed: after });
      }
    }
    return changes;
  }

  const originalSaveState = saveState;
  saveState = function saveStateWithCloud() {
    originalSaveState();
    const changes = changedCompleted();
    previousCompleted = snapshotCompleted();
    if (applyingCloud || !unlocked || !changes.length) {
      return;
    }
    for (const change of changes) {
      syncProgressChange(change.item, change.completed).catch((error) => {
        setStatus(`Progress cloud save failed: ${error.message || error}`);
      });
    }
  };

  function normalizePhoto(record) {
    return {
      rowId: record.id,
      studyDayId: record.study_day_id,
      filePath: record.file_path,
      fileName: record.file_name,
      takenAt: record.taken_at,
      englishDate: record.english_date,
      hebrewDate: record.hebrew_date,
      tractate: record.tractate,
      assignment: record.assignment,
      cloud: true,
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
        "x-tracker-passcode": passcode,
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "The private tracker could not connect.");
    }
    return data;
  }

  function progressPayload(item, completed) {
    return {
      studyDayId: item.id,
      completed: Boolean(completed),
    };
  }

  async function syncProgressChange(item, completed) {
    setStatus("Saving progress...");
    await api("/api/progress", {
      method: "POST",
      body: progressPayload(item, completed),
    });
    setStatus("Cloud sync is on");
  }

  async function loadCloudProgress() {
    const result = await api("/api/progress");
    const rows = result.progress || [];

    if (!rows.length) {
      const localChanges = DATA.items
        .filter((item) => Boolean(state.completed[item.id]) !== Boolean(item.sourceCompleted))
        .map((item) => progressPayload(item, state.completed[item.id]));
      if (localChanges.length) {
        await api("/api/progress", {
          method: "POST",
          body: { changes: localChanges },
        });
      }
      return;
    }

    applyingCloud = true;
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(state.completed, row.study_day_id)) {
        state.completed[row.study_day_id] = Boolean(row.completed);
      }
    }
    originalSaveState();
    previousCompleted = snapshotCompleted();
    applyingCloud = false;
  }

  async function loadCloudPhotos() {
    const result = await api("/api/photos");
    photoIndex = new Map();
    for (const record of (result.photos || []).map(normalizePhoto)) {
      if (!photoIndex.has(record.studyDayId)) {
        photoIndex.set(record.studyDayId, record);
      }
    }
  }

  async function signedPhotoUrl(filePath) {
    const result = await api("/api/photo-url", {
      method: "POST",
      body: { filePath },
    });
    return result.signedUrl;
  }

  function loadCloudPhotoImage(image, photo) {
    if (!photo?.filePath) {
      image.remove();
      return;
    }
    signedPhotoUrl(photo.filePath)
      .then((url) => {
        if (image.isConnected) {
          image.src = url;
        }
      })
      .catch(() => image.remove());
  }

  function withTimeout(promise, message, timeoutMs = 25000) {
    let timerId;
    const timeout = new Promise((_, reject) => {
      timerId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timerId));
  }

  function photoFileName(item, takenAt) {
    const time = takenAt.slice(11, 19).replace(/:/g, "-");
    const study = `${item.tractate}_${item.assignment}`
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "_");
    return `${item.isoDate}_${study}_${time}.jpg`;
  }

  async function uploadPhoto(item, file) {
    if (!file) {
      return;
    }
    if (!unlocked) {
      window.alert("Enter the private passcode first.");
      showLocked();
      return;
    }
    if (!client) {
      window.alert("The photo uploader did not load. Refresh the page and try again.");
      return;
    }
    if (photoIndex.has(item.id)) {
      window.alert("This day already has a photo. Delete the existing photo first if you want to upload a different one.");
      return;
    }

    try {
      setStatus(`Photo selected: ${(file.size / 1024 / 1024).toFixed(1)} MB`);
      setStatus("Stamping photo...");
      const { blob, takenAt } = await withTimeout(
        createStampedPhoto(file, item),
        "The phone gave the app a photo, but the browser could not prepare it. Try Upload Photo from the photo library, or choose a smaller photo.",
      );

      const fileName = photoFileName(item, takenAt);
      setStatus("Getting private upload link...");
      const uploadInfo = await api("/api/photo-upload-url", {
        method: "POST",
        body: {
          studyDayId: item.id,
          isoDate: item.isoDate,
          fileName,
        },
      });

      setStatus("Uploading photo to Supabase...");
      const uploaded = await withTimeout(
        client.storage
          .from(PHOTO_BUCKET)
          .uploadToSignedUrl(uploadInfo.path, uploadInfo.token, blob, {
            contentType: "image/jpeg",
          }),
        "Supabase Storage did not respond. Please try again.",
        30000,
      );
      if (uploaded.error) {
        throw uploaded.error;
      }

      setStatus("Saving photo details...");
      const saved = await api("/api/photos", {
        method: "POST",
        body: {
          studyDayId: item.id,
          filePath: uploadInfo.path,
          fileName,
          takenAt,
          englishDate: item.englishDate,
          hebrewDate: item.hebrewDate,
          tractate: item.tractate,
          assignment: item.assignment,
        },
      });

      photoIndex.set(item.id, normalizePhoto(saved.photo));
      setStatus("Photo saved to Supabase");
      render();
    } catch (error) {
      const message = error.message || String(error);
      setStatus(`Photo upload failed: ${message}`);
      window.alert(`The photo did not upload to Supabase.\n\n${message}`);
    }
  }

  async function deletePhoto(photo) {
    if (!unlocked || !photo?.rowId) {
      return;
    }
    setStatus("Deleting photo...");
    await api("/api/photos", {
      method: "DELETE",
      body: { rowId: photo.rowId },
    });
    photoIndex.delete(photo.studyDayId);
    setStatus("Photo deleted");
    render();
  }

  function cameraIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l1.5-2h3L15 5h3a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3z"></path><circle cx="12" cy="12.5" r="3.5"></circle></svg>';
  }

  function uploadIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M5 20h14"></path></svg>';
  }

  function trashIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg>';
  }

  function photoPicker(label, icon, item, capture) {
    const control = document.createElement("label");
    control.className = "photo-button photo-icon-button photo-picker-control";
    control.title = label;
    control.setAttribute("aria-label", label);
    control.innerHTML = icon;

    const input = document.createElement("input");
    input.className = "photo-file-input";
    input.type = "file";
    input.accept = "image/*";
    if (capture) {
      input.capture = "environment";
    }
    input.addEventListener("change", async () => {
      const file = input.files?.[0] || null;
      input.value = "";
      await uploadPhoto(item, file);
    });

    control.append(input);
    return control;
  }

  function plainIconButton(label, icon, extraClass = "") {
    const button = document.createElement("button");
    button.className = `photo-button photo-icon-button ${extraClass}`.trim();
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon;
    return button;
  }

  renderPhotoControls = function renderCloudPhotoControls(container, item, variant = "list") {
    const meta = photoIndex.get(item.id);
    const wrap = document.createElement("div");
    wrap.className = `photo-controls ${variant}`;

    if (!meta) {
      if (variant !== "calendar-selected") {
        wrap.append(photoPicker("Take photo", cameraIcon(), item, true));
      }
      wrap.append(photoPicker("Upload photo", uploadIcon(), item, false));
      container.append(wrap);
      return;
    }

    const status = document.createElement("span");
    status.className = "photo-status";
    status.textContent = `Photo saved ${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(meta.takenAt))}`;
    wrap.append(status);

    if (variant === "list") {
      const image = document.createElement("img");
      image.className = "photo-thumb";
      image.alt = `Stamped photo for ${shortDate(item)}`;
      loadCloudPhotoImage(image, meta);
      wrap.append(image);
    }

    const deleteButton = plainIconButton("Delete photo", trashIcon(), "danger");
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm("Delete this photo from Supabase?")) {
        return;
      }
      try {
        await deletePhoto(meta);
      } catch (error) {
        window.alert(error.message || "The photo could not be deleted.");
      }
    });
    wrap.append(deleteButton);
    container.append(wrap);
  };

  const originalRenderCalendarDay = renderCalendarDay;
  renderCalendarDay = function renderSelectableCalendarDay(options) {
    const cell = originalRenderCalendarDay(options);
    const { item } = options;
    if (!item) {
      return cell;
    }

    cell.classList.toggle("calendar-selected", selectedCalendarItemId === item.id);
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `Open ${shortDate(item)} photo controls`);
    cell.addEventListener("click", (event) => {
      if (event.target.closest("input, button, a, label")) {
        return;
      }
      selectedCalendarItemId = selectedCalendarItemId === item.id ? null : item.id;
      render();
    });

    if (selectedCalendarItemId === item.id) {
      const panel = document.createElement("div");
      panel.className = "calendar-selected-panel";
      renderPhotoControls(panel, item, "calendar-selected");
      cell.append(panel);
    }
    return cell;
  };

  function showLocked() {
    unlocked = false;
    cloudReady = false;
    document.body.classList.add("auth-signed-out");
    document.body.classList.remove("auth-signed-in", "auth-checking");
    authScreen.hidden = false;
    if (appShell) {
      appShell.hidden = true;
    }
    if (authButton) {
      authButton.disabled = false;
      authButton.textContent = "Unlock";
    }
    if (authInput) {
      authInput.disabled = false;
    }
    if (signOutButton) {
      signOutButton.hidden = true;
      signOutButton.disabled = false;
    }
    setStatus("Locked");
    setUserText("Private tracker");
  }

  function showUnlocked() {
    unlocked = true;
    document.body.classList.add("auth-signed-in");
    document.body.classList.remove("auth-signed-out", "auth-checking");
    authScreen.hidden = true;
    if (appShell) {
      appShell.hidden = false;
    }
    if (signOutButton) {
      signOutButton.hidden = false;
      signOutButton.disabled = false;
    }
    setUserText("Passcode unlocked");
    setStatus(cloudReady ? "Cloud sync is on" : "Loading cloud data...");
  }

  if (authForm) {
    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const entered = authInput?.value.trim();
      if (!entered) {
        return;
      }
      passcode = entered;
      if (authButton) {
        authButton.disabled = true;
      }
      setStatus("Checking passcode...");
      try {
        await loadCloudData();
        localStorage.setItem(PASSCODE_KEY, passcode);
        if (authInput) {
          authInput.value = "";
        }
      } catch (error) {
        passcode = "";
        localStorage.removeItem(PASSCODE_KEY);
        showLocked();
        window.alert(error.message || "The passcode did not work.");
      } finally {
        if (authButton) {
          authButton.disabled = false;
        }
      }
    });
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      passcode = "";
      localStorage.removeItem(PASSCODE_KEY);
      photoIndex = new Map();
      showLocked();
      render();
    });
  }

  async function loadCloudData() {
    setStatus("Loading cloud progress...");
    await loadCloudProgress();
    setStatus("Loading cloud photos...");
    await loadCloudPhotos();
    cloudReady = true;
    showUnlocked();
    render();
  }

  if (passcode) {
    document.body.classList.add("auth-checking");
    setStatus("Checking saved passcode...");
    loadCloudData().catch((error) => {
      passcode = "";
      localStorage.removeItem(PASSCODE_KEY);
      showLocked();
      setStatus(error.message || "Passcode needed");
    });
  } else {
    showLocked();
  }
})();
