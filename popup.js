(function initialisePopup() {
  "use strict";

  let state;
  let activeTab;
  let currentUrl;
  let saveTimer;

  const elements = {
    shell: document.querySelector(".app-shell"),
    globalEnabled: document.querySelector("#global-enabled"),
    globalLabel: document.querySelector("#global-label"),
    currentSite: document.querySelector("#current-site"),
    siteStatus: document.querySelector("#site-status"),
    profileSelect: document.querySelector("#profile-select"),
    profileEnabled: document.querySelector("#profile-enabled"),
    deleteProfile: document.querySelector("#delete-profile"),
    sitePatterns: document.querySelector("#site-patterns"),
    addCurrentSite: document.querySelector("#add-current-site"),
    blurAmount: document.querySelector("#blur-amount"),
    blurOutput: document.querySelector("#blur-output"),
    blurMedia: document.querySelector("#blur-media"),
    rules: document.querySelector("#rules"),
    ruleCount: document.querySelector("#rule-count"),
    clearRules: document.querySelector("#clear-rules"),
    saveStatus: document.querySelector("#save-status"),
    ruleTemplate: document.querySelector("#rule-template")
  };

  start().catch(showError);

  async function start() {
    const [stored, tabs] = await Promise.all([
      chrome.storage.local.get(BlurCore.STORAGE_KEY),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);
    state = BlurCore.normaliseState(stored[BlurCore.STORAGE_KEY]);
    activeTab = tabs[0];
    currentUrl = getWebUrl(activeTab?.url);
    bindEvents();
    render();
  }

  function bindEvents() {
    elements.globalEnabled.addEventListener("change", () => {
      state.enabled = elements.globalEnabled.checked;
      renderStatus();
      queueSave();
    });

    elements.profileSelect.addEventListener("change", () => {
      state.activeProfileId = elements.profileSelect.value;
      render();
      queueSave();
    });

    elements.profileEnabled.addEventListener("change", () => {
      activeProfile().enabled = elements.profileEnabled.checked;
      renderStatus();
      queueSave();
    });

    elements.sitePatterns.addEventListener("input", () => {
      activeProfile().sitePatterns = BlurCore.parsePatterns(elements.sitePatterns.value);
      renderStatus();
      queueSave();
    });

    elements.blurAmount.addEventListener("input", () => {
      activeProfile().blurAmount = Number(elements.blurAmount.value);
      elements.blurOutput.textContent = `${elements.blurAmount.value}%`;
      queueSave();
    });

    elements.blurMedia.addEventListener("change", () => {
      activeProfile().blurMedia = elements.blurMedia.checked;
      queueSave();
    });

    elements.addCurrentSite.addEventListener("click", addCurrentSite);
    document.querySelector("#new-profile").addEventListener("click", addProfile);
    document.querySelector("#rename-profile").addEventListener("click", renameProfile);
    document.querySelector("#delete-profile").addEventListener("click", deleteProfile);
    document.querySelector("#clear-rules").addEventListener("click", clearRules);

    document.querySelectorAll("[data-picker]").forEach((button) => {
      button.addEventListener("click", () => startPicker(button.dataset.picker));
    });
  }

  function render() {
    const profile = activeProfile();
    elements.globalEnabled.checked = state.enabled;
    elements.globalLabel.textContent = state.enabled ? "On" : "Off";
    elements.profileEnabled.checked = profile.enabled;
    elements.deleteProfile.disabled = state.profiles.length === 1;
    elements.profileSelect.replaceChildren(...state.profiles.map((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      option.selected = item.id === state.activeProfileId;
      return option;
    }));
    elements.sitePatterns.value = profile.sitePatterns.join("\n");
    elements.blurAmount.value = String(profile.blurAmount);
    elements.blurOutput.textContent = `${profile.blurAmount}%`;
    elements.blurMedia.checked = profile.blurMedia;
    renderRules();
    renderStatus();
  }

  function renderStatus() {
    const profile = activeProfile();
    const covered = currentUrl && BlurCore.profileMatchesUrl({ ...profile, enabled: true }, currentUrl.href);
    const matchedByAny = currentUrl && BlurCore.matchingProfiles(state, currentUrl.href).length > 0;

    elements.currentSite.textContent = currentUrl?.hostname || "No website open";
    elements.siteStatus.textContent = matchedByAny ? "blur active" : "not covered";
    elements.shell.classList.toggle("is-active", Boolean(matchedByAny));
    elements.shell.classList.toggle("is-paused", !state.enabled);
    elements.addCurrentSite.disabled = !currentUrl || Boolean(covered);
    elements.addCurrentSite.textContent = covered ? "Site covered" : "Use this site";
    document.querySelectorAll("[data-picker]").forEach((button) => {
      button.disabled = !currentUrl || !profile.enabled;
    });
  }

  function renderRules() {
    const rules = activeProfile().rules;
    elements.ruleCount.textContent = String(rules.length);
    elements.clearRules.disabled = rules.length === 0;
    elements.rules.replaceChildren();

    if (!rules.length) {
      const empty = document.createElement("div");
      empty.className = "empty-rules";
      const line = document.createElement("span");
      const copy = document.createElement("p");
      copy.textContent = "Nothing remembered yet";
      line.setAttribute("aria-hidden", "true");
      empty.append(line, copy);
      elements.rules.append(empty);
      return;
    }

    rules.forEach((rule, index) => {
      const row = elements.ruleTemplate.content.firstElementChild.cloneNode(true);
      const enabled = row.querySelector(".rule-enabled");
      enabled.checked = rule.enabled;
      row.classList.toggle("is-disabled", !rule.enabled);
      row.querySelector(".rule-kind").textContent = rule.kind === "section" ? "Section" : "Element";
      row.querySelector(".rule-label").textContent = rule.label;
      row.querySelector(".rule-selector").textContent = rule.selector;

      enabled.addEventListener("change", () => {
        rule.enabled = enabled.checked;
        row.classList.toggle("is-disabled", !enabled.checked);
        queueSave();
      });
      row.querySelector(".rule-delete").addEventListener("click", () => {
        activeProfile().rules.splice(index, 1);
        renderRules();
        queueSave();
      });
      elements.rules.append(row);
    });
  }

  function activeProfile() {
    return state.profiles.find((profile) => profile.id === state.activeProfileId) ?? state.profiles[0];
  }

  function addCurrentSite() {
    if (!currentUrl) return;
    const profile = activeProfile();
    const hostname = currentUrl.hostname.toLowerCase();
    if (!profile.sitePatterns.includes(hostname)) profile.sitePatterns.push(hostname);
    render();
    queueSave();
  }

  function addProfile() {
    const suggestedName = currentUrl ? currentUrl.hostname.replace(/^www\./, "") : "New profile";
    const name = prompt("Profile name", suggestedName)?.trim();
    if (!name) return;

    const profile = BlurCore.createProfile(name, currentUrl?.hostname || "");
    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    render();
    queueSave();
  }

  function renameProfile() {
    const profile = activeProfile();
    const name = prompt("Profile name", profile.name)?.trim().slice(0, 48);
    if (!name) return;
    profile.name = name;
    render();
    queueSave();
  }

  function deleteProfile() {
    if (state.profiles.length === 1) return;
    const profile = activeProfile();
    if (!confirm(`Delete “${profile.name}” and its remembered selections?`)) return;
    state.profiles = state.profiles.filter((item) => item.id !== profile.id);
    state.activeProfileId = state.profiles[0].id;
    render();
    queueSave();
  }

  function clearRules() {
    const profile = activeProfile();
    if (!profile.rules.length || !confirm(`Clear all selections from “${profile.name}”?`)) return;
    profile.rules = [];
    renderRules();
    queueSave();
  }

  async function startPicker(kind) {
    if (!activeTab?.id || !currentUrl) return;
    clearTimeout(saveTimer);
    await save();

    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: "START_PICKER",
        profileId: activeProfile().id,
        kind
      });
      if (!response?.ok) throw new Error("The page did not accept selection mode");
      window.close();
    } catch {
      showError(new Error("Reload this page once, then try selecting again"));
    }
  }

  function queueSave() {
    clearTimeout(saveTimer);
    showStatus("Saving…");
    saveTimer = setTimeout(() => save().catch(showError), 180);
  }

  async function save() {
    await chrome.storage.local.set({ [BlurCore.STORAGE_KEY]: BlurCore.normaliseState(state) });
    showStatus("Saved");
  }

  function showStatus(message) {
    elements.saveStatus.textContent = message;
    setTimeout(() => {
      if (elements.saveStatus.textContent === message) elements.saveStatus.textContent = "";
    }, 1500);
  }

  function showError(error) {
    console.error(error);
    showStatus(error.message);
  }

  function getWebUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }
})();
