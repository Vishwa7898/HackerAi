const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const fileInput = document.querySelector('#file-input');
const attachmentPreview = document.querySelector('#attachment-preview');
const attachFileButton = document.querySelector('#attach-file-button');
const sendButton = document.querySelector('#send-button');
const charCount = document.querySelector('#char-count');
const welcome = document.querySelector('#welcome');
const messageList = document.querySelector('#message-list');
const historyList = document.querySelector('#history-list');
const newChatButton = document.querySelector('#new-chat-button');
const connection = document.querySelector('#connection-status');
const connectionLabel = document.querySelector('#connection-label');
const modelSelect = document.querySelector('#model-select');
const authButton = document.querySelector('#auth-button');
const accountAvatar = document.querySelector('#account-avatar');
const toast = document.querySelector('#toast');
const storageKey = 'hackerai-chat-history';
const modelStorageKey = 'hackerai-model';
let toastTimer;
let availableModels = [];
let firebaseEnabled = false;
let firebaseAuth = null;
let firebaseUser = null;
let firebaseSyncEnabled = false;
let firebaseSaveTimer;
let authChangeId = 0;

function loadConversations(key = storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(saved)) throw new Error('Saved chat history has an invalid format.');
    return saved.filter((conversation) =>
      conversation
      && typeof conversation.id === 'string'
      && typeof conversation.title === 'string'
      && Array.isArray(conversation.messages)
      && conversation.messages.every((message) =>
        message
        && ['user', 'assistant'].includes(message.role)
        && typeof message.content === 'string'
        && (message.attachments === undefined || (Array.isArray(message.attachments)
          && message.attachments.every((attachment) => attachment
            && typeof attachment.name === 'string'
            && typeof attachment.kind === 'string'
            && (typeof attachment.text === 'string' || typeof attachment.data === 'string'))))
      )
    ).map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => message.image && !message.attachments
        ? {
          ...message,
          attachments: [{
            id: 'legacy-image',
            kind: 'image',
            name: message.imageName || 'image.jpg',
            data: message.image
          }]
        }
        : message)
    }));
  } catch (error) {
    showToast(`Could not load chat history: ${error.message}`);
    return [];
  }
}

let conversations = loadConversations();
let activeConversationId = conversations[0]?.id || null;
let isSending = false;
let selectedAttachments = [];
const textExtensions = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'jsonc', 'html', 'htm', 'css', 'scss', 'sass',
  'less', 'md', 'mdx', 'txt', 'rst', 'py', 'pyi', 'java', 'kt', 'kts', 'scala', 'groovy', 'c',
  'h', 'cc', 'cpp', 'hpp', 'cs', 'fs', 'go', 'rs', 'php', 'rb', 'swift', 'sql', 'sh', 'bash',
  'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'yml', 'yaml', 'toml', 'xml', 'csv', 'ini', 'cfg', 'conf',
  'env', 'properties', 'dockerfile', 'makefile', 'gitignore', 'gitattributes', 'editorconfig',
  'gradle', 'kt', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'ipynb'
]);

function saveConversations() {
  try {
    const savedConversations = conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.filter((message) => !message.attachments?.some((attachment) => attachment.kind === 'pdf'))
    }));
    const key = firebaseUser ? `${storageKey}-${firebaseUser.uid}` : storageKey;
    localStorage.setItem(key, JSON.stringify(savedConversations));
    if (firebaseUser) scheduleFirebaseSave();
    return true;
  } catch (error) {
    showToast(`Could not save chat history: ${error.message}`);
    return false;
  }
}

function activeConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId) || null;
}

async function firebaseFetch(url, options = {}, user = firebaseUser) {
  const headers = new Headers(options.headers || {});
  if (user) headers.set('authorization', `Bearer ${await user.getIdToken()}`);
  const response = await fetch(url, { ...options, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Firebase request failed.');
  return result;
}

function scheduleFirebaseSave() {
  clearTimeout(firebaseSaveTimer);
  if (!firebaseSyncEnabled) return;
  firebaseSaveTimer = setTimeout(async () => {
    const user = firebaseUser;
    if (!user) return;
    try {
      const savedConversations = conversations
        .map((conversation) => ({
          ...conversation,
          messages: conversation.messages.filter((message) => !message.attachments?.some((attachment) => attachment.kind === 'pdf'))
        }))
        .slice(0, 100);
      await firebaseFetch('/api/conversations', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversations: savedConversations })
      }, user);
    } catch (error) {
      firebaseSyncEnabled = false;
      showToast(`Could not sync conversations: ${error.message}`);
    }
  }, 500);
}

async function logFirebaseAuthError(error) {
  const report = {
    source: 'firebase-auth',
    code: typeof error?.code === 'string' ? error.code.slice(0, 100) : 'auth/unknown',
    message: typeof error?.message === 'string' ? error.message.slice(0, 500) : 'No error message provided.'
  };
  console.error('Firebase sign-in failed:', { code: report.code, message: report.message });
  try {
    await fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report)
    });
  } catch {
    console.warn('Could not send Firebase sign-in error to the server terminal.');
  }
}

function getGoogleSignInError(error) {
  if (error.code === 'auth/operation-not-allowed') {
    return 'Enable Google under Firebase Console > Authentication > Sign-in method.';
  }
  if (error.code === 'auth/unauthorized-domain') {
    return 'Add this site to Firebase Console > Authentication > Settings > Authorized domains.';
  }
  if (error.code === 'auth/popup-blocked') {
    return 'Allow popups for this site, then try Google sign-in again.';
  }
  return error.message || 'Google sign-in failed.';
}

async function initializeFirebase() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Could not load sign-in configuration.');
    if (!config.firebaseEnabled) return;
    if (!window.firebase?.auth) throw new Error('Firebase sign-in could not be loaded. Check your connection.');

    firebaseEnabled = true;
    firebase.initializeApp(config.firebaseConfig);
    if (config.firebaseConfig.measurementId && window.firebase.analytics) {
      try {
        firebase.analytics();
      } catch (error) {
        console.warn('Firebase Analytics is unavailable in this browser.');
      }
    }
    firebaseAuth = firebase.auth();
    authButton.hidden = false;
    authButton.addEventListener('click', async () => {
      authButton.disabled = true;
      try {
        if (firebaseUser) {
          await firebaseAuth.signOut();
        } else {
          await firebaseAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        }
      } catch (error) {
        void logFirebaseAuthError(error);
        showToast(getGoogleSignInError(error));
      } finally {
        authButton.disabled = false;
      }
    });

    firebaseAuth.onAuthStateChanged(async (user) => {
      const changeId = ++authChangeId;
      clearTimeout(firebaseSaveTimer);
      firebaseUser = user;
      authButton.textContent = user ? 'Sign out' : 'Sign in with Google';
      authButton.title = user?.displayName || 'Sign in with Google';
      accountAvatar.textContent = user?.displayName?.trim()?.[0]?.toUpperCase() || 'L';
      accountAvatar.title = user?.email || 'Learner';
      authButton.disabled = true;
      try {
        if (user) {
          const previousActiveId = activeConversationId;
          const accountConversations = loadConversations(`${storageKey}-${user.uid}`);
          let cloudConversations = [];
          try {
            const cloudData = await firebaseFetch('/api/conversations', {}, user);
            cloudConversations = cloudData.conversations;
            firebaseSyncEnabled = true;
          } catch (error) {
            firebaseSyncEnabled = false;
            if (changeId === authChangeId) {
              showToast(`Signed in with Google. Cloud history is unavailable: ${error.message}`);
            }
          }
          if (changeId !== authChangeId) return;
          const anonymousConversations = loadConversations();
          const merged = new Map();
          [...anonymousConversations, ...accountConversations, ...cloudConversations].forEach((conversation) => {
            merged.set(conversation.id, conversation);
          });
          conversations = [...merged.values()].sort((first, second) => second.updatedAt - first.updatedAt).slice(0, 100);
          activeConversationId = conversations.some((conversation) => conversation.id === previousActiveId)
            ? previousActiveId
            : conversations[0]?.id || null;
          if (anonymousConversations.length) localStorage.removeItem(storageKey);
          saveConversations();
        } else {
          firebaseSyncEnabled = false;
          conversations = loadConversations();
          activeConversationId = conversations[0]?.id || null;
        }
        renderConversation();
      } catch (error) {
        if (changeId === authChangeId) showToast(error.message);
      } finally {
        if (changeId === authChangeId) authButton.disabled = false;
      }
    });
  } catch (error) {
    console.error('Firebase setup failed:', error.name || 'UnknownError');
    showToast(error.message);
  }
}

function renderHistory() {
  historyList.replaceChildren();
  [...conversations]
    .sort((first, second) => second.updatedAt - first.updatedAt)
    .forEach((conversation) => {
      const item = document.createElement('button');
      item.className = 'history-item';
      item.type = 'button';
      item.textContent = conversation.title;
      item.title = conversation.title;
      item.disabled = isSending;
      if (conversation.id === activeConversationId) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      }
      item.addEventListener('click', () => {
        if (isSending) return;
        activeConversationId = conversation.id;
        renderConversation();
      });
      historyList.append(item);
    });
}

function renderConversation() {
  const conversation = activeConversation();
  messageList.replaceChildren();
  welcome.hidden = Boolean(conversation?.messages.length);
  conversation?.messages.forEach(({ role, content, attachments }) => addMessage(role, content, false, attachments));
  renderHistory();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatInlineMarkdown(value) {
  const codeSpans = [];
  let html = escapeHtml(value).replace(/`([^`\n]+)`/g, (_, code) => {
    const marker = `\u0000${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${code}</code>`);
    return marker;
  });

  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>');

  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => codeSpans[Number(index)]);
}

function renderListBlock(lines, startIndex) {
  const itemPattern = /^([ \t]*)([-*+]|\d+\.)\s+(.+)$/;

  function parseAt(index, indentation) {
    const firstItem = lines[index].match(itemPattern);
    const ordered = /^\d/.test(firstItem[2]);
    const tag = ordered ? 'ol' : 'ul';
    const items = [];

    while (index < lines.length) {
      const item = lines[index].match(itemPattern);
      if (!item) break;

      const itemIndentation = item[1].length;
      if (itemIndentation < indentation) break;
      if (itemIndentation > indentation) {
        if (!items.length) break;
        const nested = parseAt(index, itemIndentation);
        items[items.length - 1] = `${items[items.length - 1].slice(0, -5)}${nested.html}</li>`;
        index = nested.nextIndex;
        continue;
      }
      if (/^\d/.test(item[2]) !== ordered) break;

      items.push(`<li>${formatInlineMarkdown(item[3])}</li>`);
      index += 1;
    }

    return { html: `<${tag}>${items.join('')}</${tag}>`, nextIndex: index };
  }

  const firstItem = lines[startIndex].match(itemPattern);
  return parseAt(startIndex, firstItem[1].length);
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      index += 1;
      const code = [];
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*(?:-{2,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    const isTableSeparator = (candidate) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(candidate);
    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const headers = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      const headerHtml = headers.map((cell) => `<th>${formatInlineMarkdown(cell)}</th>`).join('');
      const rowsHtml = rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${formatInlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('');
      blocks.push(`<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const list = renderListBlock(lines, index);
      blocks.push(list.html);
      index = list.nextIndex;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()
      && !/^\s*```/.test(lines[index])
      && !/^(#{1,6})\s+/.test(lines[index])
      && !/^\s*([-*+]|\d+\.)\s+/.test(lines[index])
      && !/^\s*(?:-{2,}|\*{3,}|_{3,})\s*$/.test(lines[index])
      && !(lines[index].includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]))) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${paragraph.map(formatInlineMarkdown).join('<br>')}</p>`);
  }

  return blocks.join('');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
}

function addMessage(role, content, pending = false, attachments = []) {
  const row = document.createElement('div');
  row.className = `message ${role}${pending ? ' pending' : ''}`;

  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'assistant' ? 'h.' : 'L';

  const text = document.createElement('div');
  text.className = 'message-content';
  if (attachments.length) {
    const fileList = document.createElement('div');
    fileList.className = 'message-attachments';
    attachments.forEach((attachment) => {
      const fileItem = document.createElement('div');
      fileItem.className = `message-attachment${attachment.kind === 'image' ? ' has-image' : ''}`;
      if (attachment.kind === 'image' && typeof attachment.data === 'string'
        && /^data:image\/jpeg;base64,[a-z\d+/]+=*$/i.test(attachment.data)) {
        const preview = document.createElement('img');
        preview.className = 'message-image';
        preview.src = attachment.data;
        preview.alt = `Attached image: ${attachment.name}`;
        fileItem.append(preview);
      }
      const name = document.createElement('span');
      name.className = 'message-attachment-name';
      name.textContent = attachment.name;
      fileItem.append(name);
      fileList.append(fileItem);
    });
    text.append(fileList);
  }
  if (role === 'assistant' && !pending) {
    text.classList.add('markdown-body');
    text.innerHTML = renderMarkdown(content);
  } else if (content) {
    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    messageText.textContent = content;
    text.append(messageText);
  }
  if (role === 'assistant' && pending) {
    text.textContent = content;
  }
  row.append(avatar, text);
  messageList.append(row);
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return { row, text };
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  charCount.textContent = `${input.value.length} / 4000`;
}

function renderSelectedAttachments() {
  attachmentPreview.replaceChildren();
  attachmentPreview.hidden = selectedAttachments.length === 0;
  selectedAttachments.forEach((attachment, index) => {
    const item = document.createElement('div');
    item.className = 'attachment-chip';
    if (attachment.kind === 'image') {
      const image = document.createElement('img');
      image.src = attachment.data;
      image.alt = '';
      item.append(image);
    } else {
      const icon = document.createElement('span');
      icon.className = 'attachment-file-icon';
      icon.textContent = attachment.kind === 'pdf' ? 'PDF' : 'FILE';
      item.append(icon);
    }
    const name = document.createElement('span');
    name.className = 'attachment-chip-name';
    name.textContent = attachment.name;
    item.append(name);
    const remove = document.createElement('button');
    remove.className = 'remove-image-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${attachment.name}`);
    remove.addEventListener('click', () => {
      selectedAttachments.splice(index, 1);
      renderSelectedAttachments();
    });
    item.append(remove);
    attachmentPreview.append(item);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The selected image could not be read.'));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener('error', () => reject(new Error('The selected image could not be read.')));
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'].includes(file.type)
    && !['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(extension)) {
    throw new Error('Choose a JPG, PNG, WebP, GIF, BMP, or AVIF image.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 10 MB.');
  }

  const source = await readFileAsDataUrl(file);
  const image = new Image();
  image.src = source;
  await image.decode();
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is not available in this browser.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let data = canvas.toDataURL('image/jpeg', 0.78);
  let quality = 0.68;
  while (data.length > 700_000 && quality >= 0.4) {
    data = canvas.toDataURL('image/jpeg', quality);
    quality -= 0.1;
  }
  if (data.length > 700_000) throw new Error('This image is too large to attach. Choose a smaller image.');
  return { id: crypto.randomUUID(), kind: 'image', data, name: file.name.slice(0, 160) || 'image.jpg' };
}

async function prepareFile(file) {
  const name = file.name.replace(/[\\/]/g, '_').slice(0, 160) || 'attachment';
  const extension = name.toLowerCase().split('.').pop();
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(extension)) return prepareImage(file);
  if (extension === 'pdf' && (!file.type || file.type === 'application/pdf')) {
    if (file.size > 5 * 1024 * 1024) throw new Error(`${name} exceeds the 5 MB PDF limit.`);
    return { id: crypto.randomUUID(), kind: 'pdf', data: await readFileAsDataUrl(file), name };
  }
  if (!textExtensions.has(extension)) {
    throw new Error(`${name} is not a supported image, PDF, or code/text file.`);
  }
  if (file.size > 512 * 1024) throw new Error(`${name} exceeds the 512 KB per-file text limit.`);
  const text = await file.text();
  if (text.includes('\u0000')) throw new Error(`${name} is binary. Only readable text/code files are supported.`);
  return { id: crypto.randomUUID(), kind: 'text', text, name };
}

async function sendMessage(value) {
  const content = value.trim();
  if ((!content && !selectedAttachments.length) || isSending) return;
  if (firebaseEnabled && !firebaseUser) {
    showToast('Sign in with Google before sending a message.');
    return;
  }
  if (!modelSelect.value) {
    showToast('Wait for the free model list to load before sending a message.');
    return;
  }
  if (selectedAttachments.some((attachment) => attachment.kind === 'image')
    && !availableModels.find((model) => model.id === modelSelect.value)?.supportsImages) {
    showToast('Choose a model that supports images before sending this attachment.');
    return;
  }

  let conversation = activeConversation();
  const isNewConversation = !conversation;
  if (!conversation) {
    conversation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title: (content || selectedAttachments[0]?.name || 'File question').length > 42
        ? `${(content || selectedAttachments[0]?.name || 'File question').slice(0, 39)}...`
        : (content || selectedAttachments[0]?.name || 'File question'),
      messages: [],
      updatedAt: Date.now()
    };
    conversations.unshift(conversation);
    activeConversationId = conversation.id;
  }

  const attachments = selectedAttachments;
  isSending = true;
  conversation.messages.push({
    role: 'user',
    content,
    ...(attachments.length ? { attachments } : {})
  });
  conversation.updatedAt = Date.now();
  saveConversations();
  renderHistory();
  welcome.hidden = true;
  addMessage('user', content, false, attachments);
  input.value = '';
  resizeInput();
  selectedAttachments = [];
  fileInput.value = '';
  renderSelectedAttachments();
  sendButton.disabled = true;
  attachFileButton.disabled = true;
  newChatButton.disabled = true;
  sendButton.querySelector('span:first-child').textContent = 'Sending';
  const pending = addMessage('assistant', 'Preparing your answer...', true);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(firebaseUser ? { authorization: `Bearer ${await firebaseUser.getIdToken()}` } : {})
      },
      body: JSON.stringify({ messages: conversation.messages, modelId: modelSelect.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not connect to the AI service.');

    const extractedFiles = new Map((result.extractedFiles || []).map((file) => [file.id, file.text]));
    conversation.messages.forEach((message) => {
      message.attachments?.forEach((attachment, index) => {
        if (extractedFiles.has(attachment.id)) {
          message.attachments[index] = { id: attachment.id, kind: 'text', name: attachment.name, text: extractedFiles.get(attachment.id) };
        }
      });
    });
    conversation.messages.push({ role: 'assistant', content: result.answer });
    conversation.updatedAt = Date.now();
    saveConversations();
    pending.text.innerHTML = renderMarkdown(result.answer);
    pending.text.classList.add('markdown-body');
    pending.row.classList.remove('pending');
  } catch (error) {
    conversation.messages.pop();
    selectedAttachments = attachments;
    renderSelectedAttachments();
    input.value = content;
    resizeInput();
    if (isNewConversation) {
      conversations = conversations.filter((item) => item.id !== conversation.id);
      activeConversationId = null;
    }
    saveConversations();
    renderConversation();
    showToast(error.message);
  } finally {
    isSending = false;
    sendButton.disabled = false;
    attachFileButton.disabled = false;
    newChatButton.disabled = false;
    renderHistory();
    sendButton.querySelector('span:first-child').textContent = 'Send';
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener('input', resizeInput);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

attachFileButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files || []);
  fileInput.value = '';
  if (!files.length) return;
  if (selectedAttachments.length + files.length > 20) {
    showToast('Attach up to 20 files per message.');
    return;
  }
  const totalFileBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalFileBytes > 20 * 1024 * 1024) {
    showToast('The selected files must total no more than 20 MB before image resizing.');
    return;
  }
  try {
    const newAttachments = [];
    for (const file of files) newAttachments.push(await prepareFile(file));
    const allAttachments = [...selectedAttachments, ...newAttachments];
    const textBytes = allAttachments
      .filter((attachment) => attachment.kind === 'text')
      .reduce((total, attachment) => total + new TextEncoder().encode(attachment.text).length, 0);
    if (textBytes > 2 * 1024 * 1024) throw new Error('Text/code attachments must total no more than 2 MB per message.');
    const textCharacters = allAttachments
      .filter((attachment) => attachment.kind === 'text')
      .reduce((total, attachment) => total + attachment.text.length, 0);
    if (textCharacters > 350_000) throw new Error('Text/code attachments must total no more than 350,000 characters per message.');
    const encodedBytes = allAttachments.reduce((total, attachment) => total + (attachment.data?.length || 0), 0);
    if (encodedBytes > 10_000_000) throw new Error('Combined image and PDF uploads must stay under 10 MB per message.');
    selectedAttachments.push(...newAttachments);
    renderSelectedAttachments();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => sendMessage(button.dataset.prompt));
});

newChatButton.addEventListener('click', () => {
  if (isSending) return;
  activeConversationId = null;
  renderConversation();
  input.value = '';
  resizeInput();
  input.focus();
});

renderConversation();
initializeFirebase();

fetch('/api/models')
  .then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the model list.');
    if (!Array.isArray(result.models) || result.models.length === 0) throw new Error('No free models are currently available.');
    availableModels = result.models;
    modelSelect.replaceChildren();
    availableModels.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.name.replace(/\s*\(free\)\s*$/i, '')}${model.supportsImages ? ' · vision' : ''}`;
      option.title = `${model.useCase} · ${Math.round(model.contextLength / 1000)}K context · Free`;
      modelSelect.append(option);
    });
    const preferredModel = localStorage.getItem(modelStorageKey);
    modelSelect.value = availableModels.some((model) => model.id === preferredModel)
      ? preferredModel
      : availableModels.some((model) => model.id === 'nvidia/nemotron-3-ultra-550b-a55b:free')
        ? 'nvidia/nemotron-3-ultra-550b-a55b:free'
        : availableModels[0].id;
    modelSelect.disabled = false;
    if (connection.classList.contains('ready')) {
      connectionLabel.textContent = `AI ready · ${modelSelect.selectedOptions[0].textContent}`;
    }
  })
  .catch((error) => {
    modelSelect.replaceChildren(new Option('Models unavailable', ''));
    modelSelect.disabled = true;
    showToast(error.message);
  });

modelSelect.addEventListener('change', () => {
  if (connection.classList.contains('ready')) {
    connectionLabel.textContent = `AI ready · ${modelSelect.selectedOptions[0].textContent}`;
  }
  try {
    localStorage.setItem(modelStorageKey, modelSelect.value);
  } catch (error) {
    showToast(`Could not save model preference: ${error.message}`);
  }
});

fetch('/api/status')
  .then((response) => response.json())
  .then((status) => {
    connection.classList.add(status.configured ? 'ready' : 'error');
    connectionLabel.textContent = status.configured
      ? `AI ready · ${modelSelect.selectedOptions[0]?.textContent || status.model}`
      : 'Configure the API key';
  })
  .catch(() => {
    connection.classList.add('error');
    connectionLabel.textContent = 'Server connection unavailable';
  });