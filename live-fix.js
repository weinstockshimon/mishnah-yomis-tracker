(() => {
  const SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gsMVtiDUhfZVw1oCYp1RlA_pwWMErw7";
  const PHOTO_BUCKET = "study-photos";

  if (!window.supabase?.createClient || !window.MISHNAH_YOMIS_DATA) {
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });

  function setStatus(message) {
    const status = document.querySelector("#syncStatus");
    if (status) {
      status.textContent = message;
    }
  }

  function clearSupabaseStorage() {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sb-")) {
        window.localStorage.removeItem(key);
      }
    }
  }

  function cleanUrl() {
    return window.location.origin + window.location.pathname + window.location.search;
  }

  function installSignOutFix() {
    const button = document.querySelector("#signOutButton");
    if (!button) {
      return;
    }

    button.disabled = false;
    button.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        button.disabled = true;
        setStatus("Signing out...");
        await client.auth.signOut({ scope: "global" }).catch(() => {});
        clearSupabaseStorage();
        window.location.replace(cleanUrl());
      },
      true,
    );
  }

  async function getSignedInUser() {
    const { data, error } = await client.auth.getSession();
    if (error) {
      throw error;
    }
    return data.session?.user || null;
  }

  function withTimeout(promise, message, timeoutMs = 25000) {
    let timerId;
    const timeout = new Promise((_, reject) => {
      timerId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
      window.clearTimeout(timerId);
    });
  }

  function photoFileName(item, takenAt) {
    const time = takenAt.slice(11, 19).replace(/:/g, "-");
    return `${item.isoDate}_${item.id}_${time}.jpg`;
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
      cloud: true,
    };
  }

  async function uploadPhoto(item, file) {
    if (!file) {
      return;
    }

    const user = await getSignedInUser();
    if (!user) {
      window.alert("Please sign in first so the photo can save to Supabase.");
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
        "The photo was selected, but this phone browser could not prepare it. Try Upload Photo from your photo library, or choose a smaller photo.",
      );

      setStatus("Uploading photo to Supabase...");
      const fileName = photoFileName(item, takenAt);
      const filePath = `${user.id}/${item.isoDate}/${fileName}`;
      const uploaded = await client.storage
        .from(PHOTO_BUCKET)
        .upload(filePath, blob, { contentType: "image/jpeg", upsert: true });

      if (uploaded.error) {
        throw uploaded.error;
      }

      setStatus("Saving photo details...");
      const saved = await client
        .from("photos")
        .insert({
          user_id: user.id,
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

      if (saved.error) {
        throw saved.error;
      }

      photoIndex.set(item.id, normalizePhoto(saved.data));
      setStatus("Photo saved to Supabase");
      render();
    } catch (error) {
      const message = error.message || String(error);
      setStatus(`Photo upload failed: ${message}`);
      window.alert(`The photo did not upload to Supabase.\n\n${message}`);
    }
  }

  function iconButton(label, iconSvg, item, capture) {
    const labelEl = document.createElement("label");
    labelEl.className = "photo-button photo-icon-button photo-picker-control";
    labelEl.title = label;
    labelEl.setAttribute("aria-label", label);
    labelEl.innerHTML = iconSvg;

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

    labelEl.append(input);
    return labelEl;
  }

  function plainIconButton(label, iconSvg, extraClass = "") {
    const button = document.createElement("button");
    button.className = `photo-button photo-icon-button ${extraClass}`.trim();
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = iconSvg;
    return button;
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

  renderPhotoControls = function renderLiveFixedPhotoControls(container, item, variant = "list") {
    const meta = photoIndex.get(item.id);
    const wrap = document.createElement("div");
    wrap.className = `photo-controls ${variant}`;

    if (!meta) {
      if (variant !== "calendar-selected") {
        wrap.append(iconButton("Take photo", cameraIcon(), item, true));
      }
      wrap.append(iconButton("Upload photo", uploadIcon(), item, false));
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
      if (typeof loadPhotoImage === "function") {
        loadPhotoImage(image, meta);
      }
      wrap.append(image);
    }

    const deleteButton = plainIconButton("Delete photo", trashIcon(), "danger");
    deleteButton.addEventListener("click", async () => {
      window.alert("For now, delete photos from Supabase Storage. I will wire this delete button next.");
    });
    wrap.append(deleteButton);
    container.append(wrap);
  };

  installSignOutFix();
  if (typeof render === "function") {
    render();
  }
})();
