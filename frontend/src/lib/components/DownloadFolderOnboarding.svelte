<script lang="ts">
  import { onMount } from "svelte";
  import {
    chooseLibraryFolder,
    getLibraryFolderStatus,
    librarySupportsDisk,
    requestLibraryFolderPermission,
    type LibraryFolderStatus,
  } from "$lib/stores/download.svelte";
  import { setPreferences } from "$lib/stores/preferences";
  import { FolderOpen, HardDrive, X } from "lucide-svelte";

  const SEEN_KEY = "rokuyomu_download_folder_onboarding_seen";
  let visible = $state(false);
  let supported = $state(false);
  let busy = $state(false);
  let message = $state("");
  let folderStatus = $state<LibraryFolderStatus>("unlinked");

  onMount(() => {
    supported = librarySupportsDisk();
    void loadOnboarding();
  });

  async function loadOnboarding() {
    folderStatus = await getLibraryFolderStatus();
    visible =
      localStorage.getItem(SEEN_KEY) !== "1" && folderStatus !== "connected";
  }

  function dismiss() {
    localStorage.setItem(SEEN_KEY, "1");
    visible = false;
  }

  async function connectFolder() {
    busy = true;
    message = "";
    try {
      const connected =
        folderStatus === "permission-needed"
          ? await requestLibraryFolderPermission()
          : await chooseLibraryFolder();
      if (connected) {
        setPreferences({ autoDownloadOnRead: true });
        dismiss();
        return;
      }
      folderStatus = await getLibraryFolderStatus();
      message =
        folderStatus === "permission-needed"
          ? "Folder permission was not granted. You can try again or keep reading offline in the app."
          : "Folder not connected. You can try again or keep reading offline in the app.";
    } finally {
      busy = false;
    }
  }
</script>

{#if visible}
  <aside
    class="mx-auto my-3 flex w-[calc(100%-2rem)] max-w-3xl items-start gap-3 rounded-xl border border-violet-300/60 bg-violet-50 p-3 text-violet-950 shadow-sm dark:border-violet-700/50 dark:bg-violet-950/60 dark:text-violet-100"
    aria-label="Offline download information"
  >
    <HardDrive
      class="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300"
    />
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold">Read chapters offline</p>
      <p
        class="mt-1 text-xs leading-relaxed text-violet-800 dark:text-violet-200"
      >
        Connect a device folder to automatically save chapters you open to disk
        as well as keeping them available offline in this app.
      </p>
      {#if folderStatus === "permission-needed"}
        <p class="mt-2 text-xs text-violet-800 dark:text-violet-200">
          Your folder is linked, but the browser needs permission again.
        </p>
      {/if}
      {#if !supported}
        <p class="mt-2 text-xs text-violet-800 dark:text-violet-200">
          This browser does not support folder access. Chapters can still be
          saved for offline reading in the app.
        </p>
      {/if}
      {#if message}
        <p
          class="mt-2 text-xs text-amber-700 dark:text-amber-300"
          role="status"
        >
          {message}
        </p>
      {/if}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        {#if supported}
          <button
            type="button"
            onclick={connectFolder}
            disabled={busy}
            class="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <FolderOpen class="h-3.5 w-3.5" />
            {busy
              ? "Connecting…"
              : folderStatus === "permission-needed"
                ? "Grant access"
                : "Choose folder"}
          </button>
        {/if}
        <button
          type="button"
          onclick={dismiss}
          class="rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-100 dark:hover:bg-violet-900"
        >
          {supported ? "Keep in app" : "Got it"}
        </button>
        {#if supported}
          <button
            type="button"
            onclick={dismiss}
            class="rounded-lg px-2 py-1.5 text-xs text-violet-700 hover:underline dark:text-violet-300"
          >
            Later
          </button>
        {/if}
      </div>
    </div>
    <button
      type="button"
      onclick={dismiss}
      class="rounded-md p-1 text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900"
      aria-label="Dismiss offline download information"
    >
      <X class="h-4 w-4" />
    </button>
  </aside>
{/if}
