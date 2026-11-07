<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import {
        subscribeChatMessages,
        sendChatMessage,
        editChatMessage,
        deleteChatMessage,
        type ChatMessage,
        formatForumDate
    } from '$lib/stores/forum';
    import { getUser } from '$lib/stores/auth.svelte';
    import { isAdmin } from '$lib/admin';
    import { MessageCircle, ImagePlus, Pencil, Trash2, Send, X, Reply } from 'lucide-svelte';

    type PendingImage = {
        id: string;
        preview: string;
        dataUrl: string;
    };

    let messages = $state<ChatMessage[]>([]);
    let input = $state('');
    let sending = $state(false);
    let error = $state('');
    let editingId = $state<string | null>(null);
    let editText = $state('');
    let pendingImages = $state<PendingImage[]>([]);
    let fileInput: HTMLInputElement | null = $state(null);
    let listEl: HTMLDivElement | null = $state(null);
    let unsub: (() => void) | undefined;

    let replyingTo = $state<ChatMessage | null>(null);

    const user = $derived(getUser());

    onMount(() => {
        unsub = subscribeChatMessages((list) => {
            messages = list;
            tick().then(scrollToBottom);
        });
    });

    onDestroy(() => {
        unsub?.();
        pendingImages.forEach((p) => URL.revokeObjectURL(p.preview));
    });

    function scrollToBottom() {
        if (listEl) listEl.scrollTop = listEl.scrollHeight;
    }

    function compressImage(file: File, maxW = 800, quality = 0.72): Promise<string> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                let w = img.width;
                let h = img.height;
                if (w > maxW) {
                    h = Math.round((h * maxW) / w);
                    w = maxW;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Canvas not supported'));
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };
            img.src = url;
        });
    }

    async function onFileChange(e: Event) {
        const files = (e.target as HTMLInputElement).files;
        if (!files?.length) return;
        error = '';

        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue;
            if (pendingImages.length >= 4) {
                error = 'Max 4 images per message';
                break;
            }
            try {
                const dataUrl = await compressImage(file);
                if (dataUrl.length > 700_000) {
                    error = 'One image is still too large after compress';
                    continue;
                }
                const preview = URL.createObjectURL(file);
                pendingImages = [...pendingImages, { id: crypto.randomUUID(), preview, dataUrl }];
            } catch (err: any) {
                error = err?.message || 'Failed to process image';
            }
        }
        (e.target as HTMLInputElement).value = '';
    }

    function removePending(id: string) {
        const item = pendingImages.find((p) => p.id === id);
        if (item) URL.revokeObjectURL(item.preview);
        pendingImages = pendingImages.filter((p) => p.id !== id);
    }

    async function handleSend() {
        const text = input.trim();
        if ((!text && pendingImages.length === 0) || sending) return;

        sending = true;
        error = '';
        try {
            let body = text;
            
            if (replyingTo) {
                body = `@${replyingTo.authorName}\n${body}`;
            }

            for (const img of pendingImages) {
                body += `\n![image](${img.dataUrl})`;
            }
            body = body.trim();
            if (!body) return;

            await sendChatMessage(body);

            pendingImages.forEach((p) => URL.revokeObjectURL(p.preview));
            pendingImages = [];
            input = '';
            replyingTo = null;
        } catch (e: any) {
            error = e?.message || 'Failed to send';
        } finally {
            sending = false;
        }
    }

    function startEdit(m: ChatMessage) {
        editingId = m.id;
        
        pendingImages.forEach((p) => URL.revokeObjectURL(p.preview));
        pendingImages = [];

        const imgRegex = /!\[([^\]]*)\]\((data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=\s]+|https?:\/\/[^)\s]+)\)/g;
        let match;
        let cleanText = m.body;

        while ((match = imgRegex.exec(m.body)) !== null) {
            const dataUrl = match[2];
            pendingImages.push({
                id: crypto.randomUUID(),
                preview: dataUrl,
                dataUrl: dataUrl
            });
        }

        editText = cleanText.replace(imgRegex, '').trim();
    }

    async function saveEdit() {
        if (!editingId || (!editText.trim() && pendingImages.length === 0)) return;
        sending = true;
        error = '';
        try {
            let body = editText.trim();
            for (const img of pendingImages) {
                body += `\n![image](${img.dataUrl})`;
            }
            body = body.trim();

            await editChatMessage(editingId, body);
            editingId = null;
            editText = '';
            pendingImages.forEach((p) => URL.revokeObjectURL(p.preview));
            pendingImages = [];
        } catch (e: any) {
            error = e?.message || 'Failed to edit';
        } finally {
            sending = false;
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this message?')) return;
        try {
            await deleteChatMessage(id);
        } catch (e: any) {
            error = e?.message || 'Failed to delete';
        }
    }

    function replyTo(m: ChatMessage) {
        replyingTo = m;
    }

    function cancelReply() {
        replyingTo = null;
    }

    function cancelEdit() {
        editingId = null;
        editText = '';
        pendingImages.forEach((p) => URL.revokeObjectURL(p.preview));
        pendingImages = [];
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    function pickImage() {
        fileInput?.click();
    }

    function renderMarkdown(raw: string): string {
        let s = raw
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        s = s.replace(
            /@([a-zA-Z0-9_.-]+)/g,
            '<span class="chat-mention">@$1</span>'
        );

        s = s.replace(
            /!\[([^\]]*)\]\((data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=\s]+|https?:\/\/[^)\s]+)\)/g,
            (_, alt, src) => {
                const cleanSrc = String(src).replace(/\s/g, '');
                return `<img src="${cleanSrc}" alt="${alt}" class="chat-img" loading="lazy" />`;
            }
        );
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
        s = s.replace(/`([^`]+)`/g, '<code class="chat-code">$1</code>');
        s = s.replace(
            /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener" class="text-violet-600 dark:text-violet-400 underline">$1</a>'
        );
        s = s.replace(
            /^&gt; (.+)$/gm,
            '<span class="block border-l-2 border-violet-400 pl-2 text-zinc-500 dark:text-zinc-400">$1</span>'
        );
        s = s.replace(/\n/g, '<br/>');
        return s;
    }

    function canModify(m: ChatMessage): boolean {
        if (!user) return false;
        return m.authorId === user.uid || isAdmin(user.uid);
    }
</script>

<section
    class="mb-8 overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900/40 shadow-sm"
>
    <div
        class="flex items-center gap-2 border-b border-zinc-300 px-4 py-2.5 dark:border-zinc-700"
    >
        <MessageCircle class="h-4 w-4 text-red-600 dark:text-red-500" />
        <h2 class="text-sm font-bold text-red-600 dark:text-red-500">Live Chat</h2>
        <span class="text-[11px] text-zinc-500">Markdown · images supported</span>
    </div>

    <div bind:this={listEl} class="h-72 space-y-3 overflow-y-auto px-3 py-3 sm:h-80">
        {#if messages.length === 0}
            <p class="py-10 text-center text-sm text-zinc-500">No messages yet. Say hi!</p>
        {:else}
            {#each messages as m (m.id)}
                <div class="group flex gap-2.5">
                    {#if m.authorPhoto}
                        <img
                            src={m.authorPhoto}
                            alt=""
                            class="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover"
                        />
                    {:else}
                        <div
                            class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                        >
                            {m.authorName.slice(0, 1).toUpperCase()}
                        </div>
                    {/if}

                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span class="text-xs font-bold text-amber-600 dark:text-amber-400"
                                >{m.authorName}</span
                            >
                            <span class="text-[10px] text-zinc-400">{formatForumDate(m.createdAt)}</span>
                            {#if m.editedAt}
                                <span class="text-[10px] text-zinc-400">(edited)</span>
                            {/if}
                        </div>

                        {#if editingId === m.id}
                            <div class="mt-1 space-y-2">
                                {#if pendingImages.length > 0}
                                    <div class="flex flex-wrap gap-2">
                                        {#each pendingImages as img (img.id)}
                                            <div class="relative">
                                                <img
                                                    src={img.preview}
                                                    alt="preview"
                                                    class="h-16 w-16 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
                                                />
                                                <button
                                                    onclick={() => removePending(img.id)}
                                                    class="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-white shadow hover:bg-red-500"
                                                    title="Remove"
                                                >
                                                    <X class="h-3 w-3" />
                                                </button>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}

                                <div class="flex gap-2">
                                    <textarea
                                        bind:value={editText}
                                        rows="2"
                                        class="min-h-[40px] flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-black outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                                    ></textarea>
                                    <button
                                        onclick={pickImage}
                                        class="rounded-lg border border-zinc-300 p-2 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                        title="Add image"
                                    >
                                        <ImagePlus class="h-4 w-4" />
                                    </button>
                                </div>

                                <div class="flex gap-2">
                                    <button
                                        onclick={saveEdit}
                                        disabled={sending}
                                        class="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onclick={cancelEdit}
                                        class="rounded px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        {:else}
                            <div
                                class="mt-0.5 break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200"
                            >
                                {@html renderMarkdown(m.body)}
                            </div>
                        {/if}
                    </div>

                    {#if editingId !== m.id}
                        <div
                            class="flex shrink-0 gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"
                        >
                            {#if user}
                                <button
                                    onclick={() => replyTo(m)}
                                    class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-violet-600 dark:hover:bg-zinc-800 dark:hover:text-violet-400"
                                    title="Reply"
                                >
                                    <Reply class="h-3.5 w-3.5" />
                                </button>
                            {/if}
                            {#if canModify(m)}
                                <button
                                    onclick={() => startEdit(m)}
                                    class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                                    title="Edit"
                                >
                                    <Pencil class="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onclick={() => handleDelete(m.id)}
                                    class="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                                    title="Delete"
                                >
                                    <Trash2 class="h-3.5 w-3.5" />
                                </button>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>

    <!-- Composer -->
    <div class="border-t border-zinc-300 p-3 dark:border-zinc-700">
        {#if error}
            <p class="mb-2 text-xs text-red-500">{error}</p>
        {/if}

        {#if user}
            {#if replyingTo}
                <div class="mb-2 flex items-center justify-between rounded-md bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    <span class="truncate">
                        Replying to <strong class="text-amber-600 dark:text-amber-400">@{replyingTo.authorName}</strong>
                    </span>
                    <button 
                        onclick={cancelReply}
                        class="ml-2 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-500 dark:hover:bg-zinc-700"
                        title="Batalkan Balasan"
                    >
                        <X class="h-3.5 w-3.5" />
                    </button>
                </div>
            {/if}

            {#if pendingImages.length > 0 && editingId === null}
                <div class="mb-2 flex flex-wrap gap-2">
                    {#each pendingImages as img (img.id)}
                        <div class="relative">
                            <img
                                src={img.preview}
                                alt="preview"
                                class="h-16 w-16 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
                            />
                            <button
                                onclick={() => removePending(img.id)}
                                class="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-white shadow hover:bg-red-500"
                                title="Remove"
                            >
                                <X class="h-3 w-3" />
                            </button>
                        </div>
                    {/each}
                </div>
            {/if}

            <div class="flex gap-2">
                <textarea
                    bind:value={input}
                    onkeydown={onKeydown}
                    rows="2"
                    placeholder="Write a message… (Enter to send)"
                    class="min-h-[40px] flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                ></textarea>

                <div class="flex flex-col gap-1">
                    <button
                        onclick={pickImage}
                        class="rounded-lg border border-zinc-300 p-2 text-zinc-500 transition hover:bg-zinc-50 hover:text-violet-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        title="Upload image"
                    >
                        <ImagePlus class="h-4 w-4" />
                    </button>
                    <button
                        onclick={handleSend}
                        disabled={sending || (!input.trim() && pendingImages.length === 0)}
                        class="rounded-lg bg-violet-600 p-2 text-white transition hover:bg-violet-500 disabled:opacity-40"
                        title="Send"
                    >
                        <Send class="h-4 w-4" />
                    </button>
                </div>
            </div>

            <input
                bind:this={fileInput}
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                onchange={onFileChange}
            />
            <p class="mt-1.5 text-[10px] text-zinc-400">
                **bold** · *italic* · `code` · max 4 images · auto-compressed
            </p>
        {:else}
            <p class="py-2 text-center text-sm text-zinc-500">Login to join the chat</p>
        {/if}
    </div>
</section>

<style>
    :global(.chat-img) {
        max-width: 240px;
        max-height: 180px;
        border-radius: 8px;
        margin-top: 4px;
        display: block;
        object-fit: contain;
    }
    :global(.chat-code) {
        font-family: ui-monospace, monospace;
        font-size: 0.85em;
        background: rgba(0, 0, 0, 0.06);
        padding: 1px 5px;
        border-radius: 4px;
    }
    :global(.dark .chat-code) {
        background: rgba(255, 255, 255, 0.08);
    }
    :global(.chat-mention) {
        font-weight: 700;
        color: #d97706; /* amber-600 */
    }
    :global(.dark .chat-mention) {
        color: #fbbf24; /* amber-400 */
    }
</style>