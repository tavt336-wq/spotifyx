(async function localFolderPlaylist() {
  while (!Spicetify?.Player || !document.body) {
    await new Promise((r) => setTimeout(r, 200));
  }

  const AUDIO_EXT = [".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".webm"];
  const STORAGE_KEY = "lfp_playlists_v5";
  const DB_NAME = "SpicetifyLocalFolderDB";
  const STORE_NAME = "dirHandles";

  let playlists = [];
  let activePlaylistId = null;
  let playingState = { playlistId: null, trackIndex: -1, shuffle: false };
  let modalOpenForId = null;

  const audio = new Audio();
  audio.addEventListener("ended", () => playNext());

  function openDB() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE_NAME)) {
            req.result.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function saveHandle(id, handle) {
    if (!handle) return;
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, id);
    } catch (_) {}
  }

  async function getHandle(id) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      return await new Promise((res) => {
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function deleteHandle(id) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
    } catch (_) {}
  }

  async function ensurePermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") return false;
    try {
      const q = await handle.queryPermission({ mode: "read" });
      if (q === "granted") return true;
      const r = await handle.requestPermission({ mode: "read" });
      return r === "granted";
    } catch (_) {
      return false;
    }
  }

  async function collectAudioFromDirHandle(dirHandle) {
    const found = [];
    async function walk(currentDir) {
      for await (const [, entry] of currentDir.entries()) {
        if (entry.kind === "file") {
          const lower = entry.name.toLowerCase();
          if (AUDIO_EXT.some((ext) => lower.endsWith(ext))) {
            const file = await entry.getFile();
            found.push({
              title: file.name.replace(/\.[^/.]+$/, ""),
              url: URL.createObjectURL(file)
            });
          }
        } else if (entry.kind === "directory") {
          await walk(entry);
        }
      }
    }
    await walk(dirHandle);
    found.sort((a, b) => a.title.localeCompare(b.title));
    return found;
  }

  function persistMetadata() {
    try {
      const clean = playlists.map((p) => ({
        id: p.id,
        name: p.name,
        trackNames: p.trackNames || p.tracks.map((t) => t.title)
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch (_) {}
  }

  async function loadSavedPlaylists() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      for (const item of parsed) {
        const handle = await getHandle(item.id);
        let tracks = [];
        if (handle && (await ensurePermission(handle))) {
          tracks = await collectAudioFromDirHandle(handle);
        }
        playlists.push({
          id: item.id,
          name: item.name,
          trackNames: item.trackNames || tracks.map((t) => t.title),
          tracks,
          dirHandle: handle
        });
      }
      if (playlists[0]) activePlaylistId = playlists[0].id;
    } catch (_) {}
  }

  const folderInput = document.createElement("input");
  folderInput.type = "file";
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.setAttribute("directory", "");
  folderInput.multiple = true;
  folderInput.style.display = "none";
  document.body.appendChild(folderInput);

  const styleEl = document.createElement("style");
  styleEl.id = "lfp-styles";
  styleEl.textContent = `
    #lfp-inline-wrap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 8px;
      max-width: 420px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    #lfp-inline-wrap::-webkit-scrollbar { display: none; }
    .lfp-btn-add {
      background: #1db954;
      color: #000;
      border: none;
      border-radius: 999px;
      padding: 5px 11px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .lfp-btn-add:hover { background: #1ed760; }
    .lfp-chip {
      background: #282828;
      color: #fff;
      border: 1px solid #404040;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .lfp-chip:hover { background: #333; }
    .lfp-chip.active {
      background: #1db954;
      color: #000;
      border-color: #1db954;
      font-weight: 700;
    }
    #lfp-modal-backdrop, #lfp-prompt-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      font-family: var(--font-family, system-ui, sans-serif);
    }
    #lfp-modal-backdrop.open, #lfp-prompt-backdrop.open { display: flex; }
    #lfp-modal {
      width: 540px;
      max-width: 90vw;
      max-height: 76vh;
      background: #1e1e1e;
      color: #fff;
      border: 1px solid #383838;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #lfp-modal-header {
      padding: 14px 18px;
      background: #262626;
      border-bottom: 1px solid #363636;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    #lfp-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 18px;
      border-bottom: 1px solid #2e2e2e;
      background: #181818;
    }
    .lfp-ctrl-btn {
      background: #2b2b2b;
      color: #fff;
      border: 1px solid #444;
      border-radius: 999px;
      padding: 5px 11px;
      font-size: 12px;
      cursor: pointer;
    }
    .lfp-ctrl-btn:hover { background: #383838; }
    .lfp-ctrl-btn.on {
      background: rgba(29, 185, 84, 0.18);
      border-color: #1db954;
      color: #1db954;
      font-weight: 700;
    }
    .lfp-ctrl-btn.danger {
      border-color: #b83b3b;
      color: #ff7b7b;
      margin-left: auto;
    }
    #lfp-tracks { flex: 1; overflow-y: auto; padding: 10px 14px; }
    .lfp-track {
      padding: 8px 12px;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      font-size: 13px;
    }
    .lfp-track:hover { background: #2a2a2a; }
    .lfp-track.playing {
      color: #1db954;
      background: rgba(29, 185, 84, 0.12);
      font-weight: 700;
    }
    #lfp-prompt {
      width: 340px;
      max-width: 90vw;
      background: #282828;
      color: #fff;
      padding: 18px;
      border-radius: 10px;
      border: 1px solid #444;
    }
    #lfp-prompt input {
      width: 100%;
      padding: 8px 10px;
      margin: 10px 0 14px 0;
      border-radius: 6px;
      border: 1px solid #555;
      background: #121212;
      color: #fff;
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(styleEl);

  const promptBackdrop = document.createElement("div");
  promptBackdrop.id = "lfp-prompt-backdrop";
  promptBackdrop.innerHTML = `
    <div id="lfp-prompt">
      <h3 style="margin:0; font-size:16px;">Name your playlist</h3>
      <p id="lfp-prompt-info" style="margin:6px 0 0 0; font-size:12px; color:#b3b3b3;"></p>
      <input id="lfp-prompt-input" type="text" placeholder="Playlist name..." />
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button id="lfp-prompt-cancel" class="lfp-ctrl-btn">Cancel</button>
        <button id="lfp-prompt-ok" class="lfp-btn-add">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(promptBackdrop);

  const modalBackdrop = document.createElement("div");
  modalBackdrop.id = "lfp-modal-backdrop";
  modalBackdrop.innerHTML = `
    <div id="lfp-modal">
      <div id="lfp-modal-header">
        <div>
          <h2 id="lfp-modal-title" style="margin:0; font-size:17px;">Playlist</h2>
          <p id="lfp-modal-sub" style="margin:2px 0 0 0; font-size:12px; color:#b3b3b3;">0 tracks</p>
        </div>
        <button id="lfp-modal-close" class="lfp-ctrl-btn">✕ Close</button>
      </div>
      <div id="lfp-controls">
        <button id="lfp-prev-btn" class="lfp-ctrl-btn">⏮ Prev</button>
        <button id="lfp-next-btn" class="lfp-ctrl-btn">Next ⏭</button>
        <button id="lfp-shuffle-btn" class="lfp-ctrl-btn">🔀 Shuffle: OFF</button>
        <button id="lfp-refresh-btn" class="lfp-ctrl-btn">🔄 Refresh Folder</button>
        <button id="lfp-delete-btn" class="lfp-ctrl-btn danger">🗑 Delete Playlist</button>
      </div>
      <div id="lfp-tracks"></div>
    </div>
  `;
  document.body.appendChild(modalBackdrop);

  function askPlaylistName(count, suggested) {
    return new Promise((resolve) => {
      const info = promptBackdrop.querySelector("#lfp-prompt-info");
      const input = promptBackdrop.querySelector("#lfp-prompt-input");
      const okBtn = promptBackdrop.querySelector("#lfp-prompt-ok");
      const cancelBtn = promptBackdrop.querySelector("#lfp-prompt-cancel");

      info.textContent = `Found ${count} audio tracks in this folder.`;
      input.value = suggested;
      promptBackdrop.classList.add("open");
      input.focus();
      input.select();

      const finish = (val) => {
        promptBackdrop.classList.remove("open");
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        input.onkeydown = null;
        resolve(val);
      };

      okBtn.onclick = () => finish(input.value.trim() || "Local Playlist");
      cancelBtn.onclick = () => finish(null);
      input.onkeydown = (e) => {
        if (e.key === "Enter") finish(input.value.trim() || "Local Playlist");
        if (e.key === "Escape") finish(null);
      };
    });
  }

  function getPlaylist(id) {
    return playlists.find((p) => p.id === id) || null;
  }

  async function ensureTracksLoaded(pl) {
    if (pl.tracks && pl.tracks.length > 0) return true;
    if (pl.dirHandle && (await ensurePermission(pl.dirHandle))) {
      pl.tracks = await collectAudioFromDirHandle(pl.dirHandle);
      pl.trackNames = pl.tracks.map((t) => t.title);
      persistMetadata();
      return pl.tracks.length > 0;
    }
    return false;
  }

  async function refreshSinglePlaylistFolder(playlistId) {
    const pl = getPlaylist(playlistId);
    if (!pl) return;

    let targetHandle = pl.dirHandle || (await getHandle(playlistId));
    if (targetHandle) {
      pl.dirHandle = targetHandle;
      if (!(await ensurePermission(targetHandle))) {
        Spicetify.showNotification(`Folder permission denied for "${pl.name}".`, true);
        return;
      }
    } else if (typeof window.showDirectoryPicker === "function") {
      try {
        targetHandle = await window.showDirectoryPicker({ mode: "read" });
        pl.dirHandle = targetHandle;
        await saveHandle(playlistId, targetHandle);
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }

    if (!targetHandle) {
      Spicetify.showNotification(`No linked folder for "${pl.name}". Re-import the folder.`, true);
      return;
    }

    const prevCount = pl.tracks.length || pl.trackNames?.length || 0;
    (pl.tracks || []).forEach((t) => {
      try { URL.revokeObjectURL(t.url); } catch (_) {}
    });

    const freshTracks = await collectAudioFromDirHandle(targetHandle);
    pl.tracks = freshTracks;
    pl.trackNames = freshTracks.map((t) => t.title);
    persistMetadata();

    if (playingState.playlistId === playlistId && playingState.trackIndex >= freshTracks.length) {
      playingState.trackIndex = -1;
    }

    const diff = freshTracks.length - prevCount;
    const diffText = diff > 0 ? ` (+${diff} new)` : diff < 0 ? ` (${diff})` : "";

    if (modalOpenForId === playlistId) {
      modalBackdrop.querySelector("#lfp-modal-sub").textContent = `${freshTracks.length} tracks (saved)`;
      renderModalTracks(pl);
    }
    renderChips();
    Spicetify.showNotification(`Refreshed "${pl.name}": ${freshTracks.length} tracks${diffText}`);
  }

  function playTrack(playlistId, index) {
    const pl = getPlaylist(playlistId);
    if (!pl || !pl.tracks.length) return;

    const safeIdx = ((index % pl.tracks.length) + pl.tracks.length) % pl.tracks.length;
    playingState.playlistId = playlistId;
    playingState.trackIndex = safeIdx;

    try { Spicetify.Player.pause(); } catch (_) {}

    const track = pl.tracks[safeIdx];
    audio.src = track.url;
    audio.play();
    Spicetify.showNotification(`[${pl.name}] ${track.title}`);

    if (modalOpenForId === playlistId) renderModalTracks(pl);
  }

  function playNext() {
    const pl = getPlaylist(playingState.playlistId || activePlaylistId);
    if (!pl || !pl.tracks.length) return;
    if (playingState.shuffle) {
      playTrack(pl.id, Math.floor(Math.random() * pl.tracks.length));
    } else {
      playTrack(pl.id, (playingState.trackIndex >= 0 ? playingState.trackIndex : -1) + 1);
    }
  }

  function playPrev() {
    const pl = getPlaylist(playingState.playlistId || activePlaylistId);
    if (!pl || !pl.tracks.length) return;
    playTrack(pl.id, (playingState.trackIndex >= 0 ? playingState.trackIndex : 1) - 1);
  }

  async function deletePlaylist(playlistId) {
    const idx = playlists.findIndex((p) => p.id === playlistId);
    if (idx === -1) return;

    const removed = playlists[idx];
    removed.tracks.forEach((t) => URL.revokeObjectURL(t.url));
    playlists.splice(idx, 1);
    await deleteHandle(playlistId);
    persistMetadata();

    if (playingState.playlistId === playlistId) {
      audio.pause();
      audio.src = "";
      playingState.playlistId = null;
      playingState.trackIndex = -1;
    }
    if (activePlaylistId === playlistId) {
      activePlaylistId = playlists[0]?.id || null;
    }
    if (modalOpenForId === playlistId) closePlaylistModal();

    renderChips();
    Spicetify.showNotification(`Deleted playlist "${removed.name}".`);
  }

  function renderModalTracks(pl) {
    const container = modalBackdrop.querySelector("#lfp-tracks");
    container.innerHTML = "";

    const list = pl.tracks.length ? pl.tracks : (pl.trackNames || []).map((t) => ({ title: t, url: null }));
    if (!list.length) {
      container.innerHTML = `<p style="color:#b3b3b3; font-size:13px;">Grant folder permission or click Refresh Folder to load tracks.</p>`;
      return;
    }

    list.forEach((track, i) => {
      const isCurrent = playingState.playlistId === pl.id && playingState.trackIndex === i;
      const row = document.createElement("div");
      row.className = `lfp-track ${isCurrent ? "playing" : ""}`;
      row.innerHTML = `<span>${i + 1}. ${track.title}</span><span>${isCurrent ? "▶ Playing" : ""}</span>`;
      row.onclick = async () => {
        if (!pl.tracks.length && !(await ensureTracksLoaded(pl))) {
          Spicetify.showNotification("Cannot access tracks. Click Refresh Folder.", true);
          return;
        }
        playTrack(pl.id, i);
      };
      container.appendChild(row);
    });
  }

  async function openPlaylistModal(playlistId) {
    const pl = getPlaylist(playlistId);
    if (!pl) return;

    activePlaylistId = playlistId;
    modalOpenForId = playlistId;
    await ensureTracksLoaded(pl);

    const count = pl.tracks.length || (pl.trackNames || []).length;
    modalBackdrop.querySelector("#lfp-modal-title").textContent = pl.name;
    modalBackdrop.querySelector("#lfp-modal-sub").textContent = `${count} tracks (saved)`;

    const shuffleBtn = modalBackdrop.querySelector("#lfp-shuffle-btn");
    shuffleBtn.textContent = `🔀 Shuffle: ${playingState.shuffle ? "ON" : "OFF"}`;
    shuffleBtn.classList.toggle("on", playingState.shuffle);

    renderModalTracks(pl);
    modalBackdrop.classList.add("open");
    renderChips();
  }

  function closePlaylistModal() {
    modalOpenForId = null;
    modalBackdrop.classList.remove("open");
  }

  async function registerNewPlaylist(name, tracks, dirHandle) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newPlaylist = {
      id,
      name,
      trackNames: tracks.map((t) => t.title),
      tracks,
      dirHandle: dirHandle || null
    };
    playlists.push(newPlaylist);
    activePlaylistId = id;
    if (dirHandle) await saveHandle(id, dirHandle);
    persistMetadata();
    renderChips();
    await openPlaylistModal(id);
    Spicetify.showNotification(`Created playlist "${name}" (${tracks.length} tracks).`);
  }

  async function triggerFolderPick() {
    if (typeof window.showDirectoryPicker === "function") {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: "read" });
        const tracks = await collectAudioFromDirHandle(dirHandle);
        if (!tracks.length) {
          Spicetify.showNotification("No audio files found in the selected folder.", true);
          return;
        }
        const name = await askPlaylistName(tracks.length, dirHandle.name || "Local Music");
        if (!name) {
          tracks.forEach((t) => URL.revokeObjectURL(t.url));
          return;
        }
        await registerNewPlaylist(name, tracks, dirHandle);
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    folderInput.value = "";
    folderInput.click();
  }

  folderInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => {
      const lower = f.name.toLowerCase();
      return f.type.startsWith("audio/") || AUDIO_EXT.some((ext) => lower.endsWith(ext));
    });
    if (!files.length) {
      Spicetify.showNotification("No audio files found in the selected folder.", true);
      return;
    }
    const folderName = (files[0].webkitRelativePath || "").split("/")[0] || "Downloaded Music";
    const name = await askPlaylistName(files.length, folderName);
    if (!name) return;

    const tracks = files.map((file) => ({
      title: file.name.replace(/\.[^/.]+$/, ""),
      url: URL.createObjectURL(file)
    }));
    await registerNewPlaylist(name, tracks, null);
  });

  modalBackdrop.querySelector("#lfp-modal-close").onclick = closePlaylistModal;
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closePlaylistModal();
  });
  modalBackdrop.querySelector("#lfp-prev-btn").onclick = playPrev;
  modalBackdrop.querySelector("#lfp-next-btn").onclick = playNext;
  modalBackdrop.querySelector("#lfp-shuffle-btn").onclick = () => {
    playingState.shuffle = !playingState.shuffle;
    const btn = modalBackdrop.querySelector("#lfp-shuffle-btn");
    btn.textContent = `🔀 Shuffle: ${playingState.shuffle ? "ON" : "OFF"}`;
    btn.classList.toggle("on", playingState.shuffle);
  };
  modalBackdrop.querySelector("#lfp-refresh-btn").onclick = () => {
    if (modalOpenForId) refreshSinglePlaylistFolder(modalOpenForId);
  };
  modalBackdrop.querySelector("#lfp-delete-btn").onclick = () => {
    if (modalOpenForId) deletePlaylist(modalOpenForId);
  };

  function findMarketplaceAnchor() {
    const candidates = Array.from(document.querySelectorAll("a, button"));
    const marketEl = candidates.find((el) => {
      const txt = (el.textContent || el.getAttribute("aria-label") || "").trim().toLowerCase();
      return txt.includes("marketplace");
    });
    if (marketEl && marketEl.parentElement) {
      return { parent: marketEl.parentElement, afterEl: marketEl };
    }

    const topBar =
      document.querySelector(".main-globalNav-navLink")?.parentElement ||
      document.querySelector(".main-topBar-container .main-topBar-topbarContent") ||
      document.querySelector(".main-topBar-header") ||
      document.querySelector("header");
    if (topBar) return { parent: topBar, afterEl: null };

    return { parent: document.body, afterEl: null };
  }

  function ensureInlineButton() {
    if (document.getElementById("lfp-inline-wrap")) return;
    const anchor = findMarketplaceAnchor();
    if (!anchor) return;

    const wrap = document.createElement("div");
    wrap.id = "lfp-inline-wrap";

    const addBtn = document.createElement("button");
    addBtn.className = "lfp-btn-add";
    addBtn.textContent = "+ Music Folder";
    addBtn.onclick = triggerFolderPick;

    const chipsBox = document.createElement("div");
    chipsBox.id = "lfp-inline-chips";
    chipsBox.style.cssText = "display:inline-flex; align-items:center; gap:5px;";

    wrap.appendChild(addBtn);
    wrap.appendChild(chipsBox);

    if (anchor.afterEl && anchor.afterEl.nextSibling) {
      anchor.parent.insertBefore(wrap, anchor.afterEl.nextSibling);
    } else {
      anchor.parent.appendChild(wrap);
    }
    renderChips();
  }

  function renderChips() {
    const chipsBox = document.getElementById("lfp-inline-chips");
    if (!chipsBox) return;
    chipsBox.innerHTML = "";

    playlists.forEach((pl) => {
      const count = pl.tracks.length || (pl.trackNames || []).length;
      const chip = document.createElement("button");
      chip.className = `lfp-chip ${pl.id === activePlaylistId ? "active" : ""}`;
      chip.textContent = `${pl.name} (${count})`;
      chip.onclick = () => openPlaylistModal(pl.id);
      chipsBox.appendChild(chip);
    });
  }

  await loadSavedPlaylists();
  ensureInlineButton();
  setInterval(ensureInlineButton, 1500);
})();
