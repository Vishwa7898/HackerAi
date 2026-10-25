const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const charCount = document.querySelector('#char-count');
const welcome = document.querySelector('#welcome');
const messageList = document.querySelector('#message-list');
const connection = document.querySelector('#connection-status');
const connectionLabel = document.querySelector('#connection-label');
const toast = document.querySelector('#toast');
const messages = [];
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
}

function addMessage(role, content, pending = false) {
  const row = document.createElement('div');
  row.className = `message ${role}${pending ? ' pending' : ''}`;

  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'assistant' ? 'h.' : 'L';

  const text = document.createElement('div');
  text.className = 'message-content';
  text.textContent = content;
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

async function sendMessage(value) {
  const content = value.trim();
  if (!content || sendButton.disabled) return;

  welcome.hidden = true;
  messages.push({ role: 'user', content });
  addMessage('user', content);
  input.value = '';
  resizeInput();
  sendButton.disabled = true;
  sendButton.querySelector('span:first-child').textContent = 'Sending';
  const pending = addMessage('assistant', 'Preparing your answer...', true);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not connect to the AI service.');

    pending.text.textContent = result.answer;
    pending.row.classList.remove('pending');
    messages.push({ role: 'assistant', content: result.answer });
  } catch (error) {
    pending.row.remove();
    messages.pop();
    showToast(error.message);
  } finally {
    sendButton.disabled = false;
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

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => sendMessage(button.dataset.prompt));
});

document.querySelectorAll('.topic').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.topic').forEach((topic) => topic.classList.remove('active'));
    button.classList.add('active');
    input.value = button.dataset.prompt;
    resizeInput();
    input.focus();
  });
});

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