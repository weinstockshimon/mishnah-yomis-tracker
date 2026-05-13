(() => {
  const SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gsMVtiDUhfZVw1oCYp1RlA_pwWMErw7";
  const PHOTO_BUCKET = "study-photos";

  if (!window.supabase?.createClient || !window.MISHNAH_YOMIS_DATA) {
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  let currentUser = null;
  let photoRecords = [];

  const toolbar = document.querySelector(".toolbar");
  const titleBlock = document.querySelector(".topbar > div:first-child");
  const appTitle = document.querySelector("#app-title");
  const signOutButton = document.querySelector("#signOutButton");
  let selectedCalendarItemId = null;

  if (toolbar) {
    toolbar.remove();
  }

  if (titleBlock && appTitle && signOutButton && !titleBlock.querySelector(".title-row")) {
    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    appTitle.replaceWith(titleRow);
    titleRow.append(appTitle, signOutButton);
  }

  if (signOutButton) {
    signOutButton.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        await client.auth.signOut({ scope: "local" }).catch(() => {});
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sb-")) {
            localStorage.removeItem(key);
          }
        }
        document.body.classList.add("auth-signed-out");
        document.body.classList.remove("auth-signed-in");
        signOutButton.hidden = true;
      },
      true,
    );
  }

  renderPhotoControls = function renderCloudPhotoControls(container, item, variant = "list") {
    const meta = photoIndex.get(item.id);
    const wrap = document.createElement("div");
    wrap.className = `photo-controls ${variant}`;

    if (!meta) {
      if (variant !== "calendar-selected") {
        wrap.append(photoPickerControl("Take photo", cameraIcon(), item, { capture: true }));
      }

      wrap.append(photoPickerControl("Upload photo", uploadIcon(), item, { capture: false }));
      container.append(wrap);
      return;
    }

    if (meta) {
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
        loadPhotoImage(image, meta);
        wrap.append(image);
      }

      const deleteButton = iconButton("Delete photo", trashIcon(), "danger");
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm("Delete this photo from Supabase?")) {
          return;
        }
        await deleteCloudPhoto(meta);
        render();
      });
      wrap.append(deleteButton);
    }

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

    cell.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
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

  client.auth.getSession().then(({ data }) => {
    currentUser = data.session?.user || null;
    if (currentUser) {
      refreshPhotos();
    }
  });

  client.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      refreshPhotos();
    } else {
      photoRecords = [];
      photoIndex = new Map();
    }
  });

  async function ensureCurrentUser() {
    if (currentUser) {
      return currentUser;
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
      throw error;
    }

    currentUser = data.session?.user || null;
    return currentUser;
  }

  function updatePhotoStatus(message) {
    if (typeof setSyncStatus === "function") {
      setSyncStatus(message);
      return;
    }

    const status = document.querySelector("#syncStatus");
    if (status) {
      status.textContent = message;
    }
  }

  function withPhotoTimeout(promise, message, timeoutMs = 20000) {
    let timerId;
    const timeout = new Promise((_, reject) => {
      timerId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
      window.clearTimeout(timerId);
    });
  }

  async function saveSelectedPhotoForItem(item, file) {
    const user = await ensureCurrentUser();
    if (!user) {
      window.alert("Please sign in first so the photo can save to Supabase.");
      return;
    }
    if (photoIndex.has(item.id)) {
      window.alert("This day already has a photo. Delete the existing photo first if you want to upload a different one.");
      return;
    }
    if (!file) {
      return;
    }

    try {
      updatePhotoStatus(`Photo selected: ${(file.size / 1024 / 1024).toFixed(1)} MB`);
      updatePhotoStatus("Stamping photo...");
      const { blob, takenAt } = await withPhotoTimeout(
        createStampedPhoto(file, item),
        "The phone gave the app a photo, but the browser could not prepare it. Try Upload Photo from your photo library instead of Take Photo.",
      );
      const fileName = cloudPhotoFileName(item, takenAt);
      updatePhotoStatus("Uploading photo to Supabase...");
      const photo = await uploadCloudPhoto(item, blob, fileName, takenAt);
      photoRecords = [photo, ...photoRecords.filter((record) => record.filePath !== photo.filePath)];
      setLatestPhotoForDay(photo);
      updatePhotoStatus("Photo saved to Supabase");
      render();
    } catch (error) {
      const message = error.message || String(error);
      updatePhotoStatus(`Photo upload failed: ${message}`);
      window.alert(`The photo did not upload to Supabase.\n\n${message}`);
    }
  }

  async function savePhotoForItem(item, { capture }) {
    const file = await choosePhotoFile({ capture });
    await saveSelectedPhotoForItem(item, file);
  }

  async function uploadCloudPhoto(item, blob, fileName, takenAt) {
    const filePath = `${currentUser.id}/${item.isoDate}/${fileName}`;
    const upload = await client.storage
      .from(PHOTO_BUCKET)
      .upload(filePath, blob, { contentType: "image/jpeg", upsert: true });

    if (upload.error) {
      throw upload.error;
    }

    updatePhotoStatus("Saving photo details...");
    const row = await client
      .from("photos")
      .insert({
        user_id: currentUser.id,
        study_day_id: item.id,
        file_path: filePath,
        file_name: fileName,
        taken_at: takenAt,
        english_date: item.englishDate,
        hebrew_date: item.hebrewDate,
        tractate: item.tractate,
        assignment: item.assignment,
      })
      .select("id, study_day_id, file_path, file_name, taken_at, english_date, hebrew_date, tractate, assignment")
      .single();

    if (row.error) {
      throw row.error;
    }

    return normalizePhoto(row.data);
  }

  async function refreshPhotos() {
    if (!currentUser) {
      return;
    }

    const result = await client
      .from("photos")
      .select("id, study_day_id, file_path, file_name, taken_at, english_date, hebrew_date, tractate, assignment")
      .eq("user_id", currentUser.id)
      .order("taken_at", { ascending: false });

    if (result.error) {
      return;
    }

    photoRecords = result.data.map(normalizePhoto);
    photoIndex = new Map();
    for (const photo of photoRecords) {
      setLatestPhotoForDay(photo);
    }
    render();
  }

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
    };
  }

  function setLatestPhotoForDay(photo) {
    const existing = photoIndex.get(photo.studyDayId);
    if (!existing || new Date(photo.takenAt) > new Date(existing.takenAt)) {
      photoIndex.set(photo.studyDayId, photo);
    }
  }

  async function deleteCloudPhoto(photo) {
    const storage = await client.storage.from(PHOTO_BUCKET).remove([photo.filePath]);
    if (storage.error) {
      throw storage.error;
    }

    const row = await client
      .from("photos")
      .delete()
      .eq("id", photo.rowId)
      .eq("user_id", currentUser.id);

    if (row.error) {
      throw row.error;
    }

    photoRecords = photoRecords.filter((record) => record.rowId !== photo.rowId);
    photoIndex = new Map();
    for (const record of photoRecords) {
      setLatestPhotoForDay(record);
    }
  }

  async function signedPhotoUrl(filePath) {
    const result = await client.storage.from(PHOTO_BUCKET).createSignedUrl(filePath, 600);
    if (result.error) {
      throw result.error;
    }
    return result.data.signedUrl;
  }

  function loadPhotoImage(image, photo) {
    signedPhotoUrl(photo.filePath)
      .then((url) => {
        if (image.isConnected) {
          image.src = url;
        }
      })
      .catch(() => image.remove());
  }

  function choosePhotoFile({ capture }) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      if (capture) {
        input.capture = "environment";
      }
      input.className = "photo-file-input";
      input.addEventListener("change", () => {
        resolve(input.files?.[0] || null);
        input.remove();
      }, {
        once: true,
      });
      document.body.append(input);
      input.click();
    });
  }

  function cloudPhotoFileName(item, takenAt) {
    const time = takenAt.slice(11, 19).replace(/:/g, "-");
    return `${item.isoDate}_${item.id}_${time}.jpg`;
  }

  function iconButton(label, icon, extraClass = "") {
    const button = document.createElement("button");
    button.className = `photo-button photo-icon-button ${extraClass}`.trim();
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon;
    return button;
  }

  function photoPickerControl(label, icon, item, { capture }) {
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
      await saveSelectedPhotoForItem(item, file);
    });
    control.append(input);
    return control;
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
})();
