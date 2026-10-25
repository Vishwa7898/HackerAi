const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const imageInput = document.querySelector('#image-input');
const imagePreview = document.querySelector('#image-preview');
const imagePreviewImage = document.querySelector('#image-preview-img');
const imagePreviewName = document.querySelector('#image-preview-name');
const attachImageButton = document.querySelector('#attach-image-button');
const removeImageButton = document.querySelector('#remove-image-button');
const sendButton = document.querySelector('#send-button');
const charCount = document.querySelector('#char-count');
const welcome = document.querySelector('#welcome');
const messageList = document.querySelector('#message-list');
const historyList = document.querySelector('#history-list');
const newChatButton = document.querySelector('#new-chat-button');
const connection = document.querySelector('#connection-status');
const connectionLabel = document.querySelector('#connection-label');
const toast = document.querySelector('#toast');
const storageKey = 'hackerai-chat-history';
let toastTimer;

function loadConversations() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
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
      )
    );
  } catch (error) {
    showToast(`Could not load chat history: ${error.message}`);
    return [];
  }
}

let conversations = loadConversations();
let activeConversationId = conversations[0]?.id || null;
let isSending = false;
let selectedImage = null;

function saveConversations() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(conversations));
    return true;
  } catch (error) {
    showToast(`Could not save chat history: ${error.message}`);
    return false;
  }
}

function activeConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId) || null;
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
  conversation?.messages.forEach(({ role, content, image, imageName }) => addMessage(role, content, false, image, imageName));
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

function addMessage(role, content, pending = false, image = null, imageName = '') {
  const row = document.createElement('div');
  row.className = `message ${role}${pending ? ' pending' : ''}`;

  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'assistant' ? 'h.' : 'L';

  const text = document.createElement('div');
  text.className = 'message-content';
  if (image && /^data:image\/(?:jpeg|png|webp);base64,[a-z\d+/]+=*$/i.test(image)) {
    const preview = document.createElement('img');
    preview.className = 'message-image';
    preview.src = image;
    preview.alt = imageName ? `Attached image: ${imageName}` : 'Attached image';
    text.append(preview);
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

function clearSelectedImage() {
  selectedImage = null;
  imageInput.value = '';
  imagePreview.hidden = true;
  imagePreviewImage.removeAttribute('src');
  imagePreviewName.textContent = '';
}

function showSelectedImage(image) {
  selectedImage = image;
  imagePreviewImage.src = image.data;
  imagePreviewName.textContent = image.name;
  imagePreview.hidden = false;
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
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
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
  return { data, name: file.name.slice(0, 160) || 'image.jpg' };
}

async function sendMessage(value) {
  const content = value.trim();
  if ((!content && !selectedImage) || isSending) return;

  let conversation = activeConversation();
  const isNewConversation = !conversation;
  if (!conversation) {
    conversation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title: (content || 'Image question').length > 42 ? `${(content || 'Image question').slice(0, 39)}...` : (content || 'Image question'),
      messages: [],
      updatedAt: Date.now()
    };
    conversations.unshift(conversation);
    activeConversationId = conversation.id;
  }

  const attachedImage = selectedImage;
  isSending = true;
  conversation.messages.push({
    role: 'user',
    content,
    ...(attachedImage ? { image: attachedImage.data, imageName: attachedImage.name } : {})
  });
  conversation.updatedAt = Date.now();
  saveConversations();
  renderHistory();
  welcome.hidden = true;
  addMessage('user', content, false, attachedImage?.data, attachedImage?.name);
  input.value = '';
  resizeInput();
  clearSelectedImage();
  sendButton.disabled = true;
  attachImageButton.disabled = true;
  newChatButton.disabled = true;
  sendButton.querySelector('span:first-child').textContent = 'Sending';
  const pending = addMessage('assistant', 'Preparing your answer...', true);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: conversation.messages })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not connect to the AI service.');

    conversation.messages.push({ role: 'assistant', content: result.answer });
    conversation.updatedAt = Date.now();
    saveConversations();
    pending.text.innerHTML = renderMarkdown(result.answer);
    pending.text.classList.add('markdown-body');
    pending.row.classList.remove('pending');
  } catch (error) {
    conversation.messages.pop();
    if (attachedImage) {
      showSelectedImage(attachedImage);
      input.value = content;
      resizeInput();
    }
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
    attachImageButton.disabled = false;
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

attachImageButton.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', async () => {
  const [file] = imageInput.files || [];
  if (!file) return;
  try {
    showSelectedImage(await prepareImage(file));
  } catch (error) {
    imageInput.value = '';
    showToast(error.message);
  }
});
removeImageButton.addEventListener('click', clearSelectedImage);

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

fetch('/api/status')
  .then((response) => response.json())
  .then((status) => {
    connection.classList.add(status.configured ? 'ready' : 'error');
    connectionLabel.textContent = status.configured ? `AI ready · ${status.model}` : 'Configure the API key';
  })
  .catch(() => {
    connection.classList.add('error');
    connectionLabel.textContent = 'Server connection unavailable';
  });