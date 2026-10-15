const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-inbox-'));
const screenshots = path.resolve(__dirname, '../.tmp');
fs.mkdirSync(screenshots, { recursive: true });
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = 'inbox-test';
process.env.ADMIN_PASSWORD = 'inbox-test-password';
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');
const store = require('../store');

function audioFixture() {
  const samples = 16000 * 3, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return 'data:audio/wav;base64,' + wav.toString('base64');
}

function animatedWebpFixture(frames, size = 32) {
  const chunk = (name, data) => {
    const header = Buffer.alloc(8); header.write(name); header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
  };
  const dimensions = Buffer.alloc(10); dimensions[0] = 2;
  dimensions.writeUIntLE(size - 1, 4, 3); dimensions.writeUIntLE(size - 1, 7, 3);
  const chunks = [chunk('VP8X', dimensions), chunk('ANIM', Buffer.alloc(6))];
  for (const url of frames) {
    const webp = Buffer.from(url.split(',')[1], 'base64'), imageChunks = [];
    for (let offset = 12; offset + 8 <= webp.length;) {
      const length = webp.readUInt32LE(offset + 4), end = offset + 8 + length + length % 2;
      if (['ALPH', 'VP8 ', 'VP8L'].includes(webp.toString('ascii', offset, offset + 4))) imageChunks.push(webp.subarray(offset, end));
      offset = end;
    }
    const frame = Buffer.alloc(16);
    frame.writeUIntLE(size - 1, 6, 3); frame.writeUIntLE(size - 1, 9, 3);
    frame.writeUIntLE(400, 12, 3); frame[15] = 2;
    chunks.push(chunk('ANMF', Buffer.concat([frame, ...imageChunks])));
  }
  const data = Buffer.concat(chunks), header = Buffer.alloc(12);
  header.write('RIFF'); header.writeUInt32LE(data.length + 4, 4); header.write('WEBP', 8);
  return 'data:image/webp;base64,' + Buffer.concat([header, data]).toString('base64');
}

async function main() {
  let browser;
  try {
    await db.ready;
    const number = '5511999997777', at = new Date().toISOString();
    const audio = audioFixture();
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="380" height="220" viewBox="0 0 380 220"><rect width="380" height="220" rx="12" fill="#f4a58a"/><path d="M190 170 95 90a40 40 0 0 1 95-35 40 40 0 0 1 95 35Z" fill="#a3482e"/><text x="190" y="202" text-anchor="middle" fill="#302322" font-family="sans-serif" font-size="14">Obrigado pela sua mensagem!</text></svg>');
    const conversation = { number, name: 'Fernanda', messages: [
      { id: 1, from: 'client', type: 'audio', mediaUrl: audio, text: '[TRANSCRIÇÃO]\nEu amei, mas você vai lá no Instagram postar e me marcar.', at },
      { id: 2, from: 'client', text: '😄 😄 😄 😄 😄', at },
      { id: 3, from: 'admin', text: 'Combinado! 😊', at, deliveryStatus: 2 },
      { id: 4, from: 'admin', type: 'audio', mediaUrl: audio, at, deliveryStatus: 3 },
      { id: 5, from: 'admin', type: 'image', mediaUrl: image, at, deliveryStatus: 4 },
    ] };
    conversation.messages.forEach((message, index) => { message.whatsappId = `fixture-wa-${index + 1}`; });
    const state = { conversations: { [number]: conversation, '5511999912345': { number: '5511999912345', name: 'Agenda sem conversa', messages: [] } }, activeTarget: number, status: { connected: true } };
    let sentMedia = null, sentName, sentText;
    let replyGate = null, textReplies = 0, failNextReply = false;
    let lastReplyTo, lastForward, lastDelete;
    bot.ensureWorker = () => ({ child: { connected: true } });
    bot.request = async (_, action, payload) => {
      if (action === 'state') return state;
      if (action === 'status') return { status: state.status };
      if (action === 'profile-picture') return { profilePic: '', connected: false };
      if (action === 'contacts') return store.getContacts();
      if (action === 'sync-contacts') {
        state.status.contactsSync = { syncing: false, verified: true, stage: 'ready', error: '' };
        io.emit('status', state.status);
        return { connected: true, synced: true };
      }
      if (action === 'assume') { state.activeTarget = payload.number; return { activeTarget: payload.number }; }
      if (action === 'reply') {
        textReplies++;
        if (replyGate) await replyGate;
        if (failNextReply) { failNextReply = false; throw new Error('Falha simulada no envio'); }
        sentName = payload.displayName; sentText = payload.text;
        lastReplyTo = payload.replyTo;
        const source = conversation.messages.find(message => message.id === Number(payload.replyTo));
        conversation.messages.push({ id: conversation.messages.length + 100, whatsappId: `reply-${conversation.messages.length}`, from: 'admin', text: payload.text, at, replyTo: source ? { id: source.id, whatsappId: source.whatsappId, from: source.from, text: source.caption || source.text, type: source.type } : null });
        return { conversation: { ...conversation, partialMessages: true, messages: conversation.messages.slice(-1) }, activeTarget: number };
      }
      if (action === 'reply-media') {
        sentName = payload.displayName;
        sentMedia = payload.media;
        lastReplyTo = payload.replyTo;
        conversation.messages.push({ from: 'admin', type: payload.media.type, mediaUrl: payload.media.mediaUrl, at });
        return { conversation, activeTarget: number };
      }
      if (action === 'forward-messages') {
        lastForward = payload;
        const target = state.conversations[payload.targetNumber] ||= { number: payload.targetNumber, name: '', messages: [] };
        target.messages.push(...conversation.messages.filter(message => payload.messageIds.includes(message.id)).map((message, index) => ({ ...message, id: 500 + index, from: 'admin', forwarded: true })));
        return { conversation: target };
      }
      if (action === 'delete-messages') {
        lastDelete = payload;
        conversation.messages = conversation.messages.filter(message => !payload.messageIds.includes(message.id));
        return { conversation: { ...conversation, mutation: 'delete' } };
      }
      return { ok: true };
    };
    await store.saveContact({ number, name: 'Fernanda', nameSource: 'whatsapp', tags: [] });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const context = await browser.newContext({ permissions: ['microphone'] });
    await context.addInitScript(() => {
      window.__notificationTones = 0;
      const originalOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) {
        window.__notificationTones++;
        return originalOscillator.apply(this, args);
      };
      const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await acquire(...args);
        window.__testMicrophone = stream;
        return stream;
      };
    });
    await context.request.post(base + '/api/login', { data: { username: 'inbox-test', password: 'inbox-test-password' } });
    const department = await (await context.request.post(base + '/api/departments', { data: { name: 'Suporte Comercial' } })).json();
    conversation.departmentId = department.department.id;
    await context.request.post(base + '/api/chips', { data: { name: 'Teste', departmentId: department.department.id } });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => { errors.push(error.message); console.error('[BROWSER]', error.message); });
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(base + '/atendimento');
        await page.evaluate(({ theme, number }) => {
          localStorage.setItem('bwap-theme', theme);
          sessionStorage.setItem('bwap-workspace-state', JSON.stringify({ selectedNumber: number }));
        }, { theme, number });
        await page.reload();
        await page.locator('.convo-item').filter({ hasText: 'Fernanda' }).first().click();
        await page.waitForFunction(() => document.getElementById('chatTitle')?.textContent === 'Fernanda');
        await page.locator('#chatTitle').waitFor({ state: 'visible' });
        await page.locator('.audio-time').first().getByText('0:00 / 0:03').waitFor();
        await page.waitForFunction(() => document.getElementById('chatDepartment')?.textContent === 'Suporte Comercial')
        assert.equal(await page.locator('#chatDepartment').innerText(), 'Suporte Comercial');
        assert.equal(await page.locator('#chatStatus').innerText(), 'Atendimento humano');
        assert.equal(await page.locator('.message-receipt[aria-label="Enviado"]').count(), 1);
        assert.equal(await page.locator('.message-receipt[aria-label="Entregue"]').count(), 1);
        assert.equal(await page.locator('.message-receipt[aria-label="Visualizado"]').count(), 1);
        assert.equal(await page.locator('.message-receipt[aria-label="Visualizado"]').evaluate(element => getComputedStyle(element).color), 'rgb(83, 189, 235)');
        assert.equal(await page.locator('.bubble.client .message-receipt').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        const header = await page.locator('.chat-header').boundingBox();
        assert.ok(header.height < 160, 'The contact header must stay compact');
        await page.locator('#inboxPage').screenshot({ path: path.join(screenshots, `atendimento-${theme}-${width}.png`) });
        await page.locator('#chatMoreDetails summary').click();
        const menu = await page.locator('#chatMoreMenu').boundingBox();
        assert.ok(menu.x >= 0 && menu.x + menu.width <= width, 'The actions menu must stay inside the screen');
        await page.locator('#inboxPage').screenshot({ path: path.join(screenshots, `atendimento-menu-${theme}-${width}.png`) });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#chatMoreDetails').evaluate(element => element.open), false);
        console.log(`PASS: inbox layout, audio metadata and actions menu, ${theme}, ${width}px`);
      }
    }
    assert.equal(await page.getByRole('button', { name: 'Ver foto do contato' }).count(), 0);
    await page.locator('#chatMoreDetails summary').click();
    await page.getByRole('button', { name: 'Ativar notificações', exact: true }).click();
    await page.getByRole('button', { name: 'Desativar assinatura', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#composerSignature').innerText(), '');
    await page.reload();
    await page.locator('#chatMoreDetails summary').click();
    await page.getByRole('button', { name: 'Desativar notificações', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Ativar assinatura', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#composerInput').fill('Mensagem sem assinatura');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => document.getElementById('composerInput').value === '');
    await page.waitForFunction(() => !document.getElementById('sendBtn').disabled);
    assert.equal(sentName, null); assert.equal(sentText, 'Mensagem sem assinatura');
    conversation.messages.push({ id: 50, from: 'client', text: 'Nova mensagem', at });
    io.emit('message', { ...conversation });
    await page.waitForFunction(() => window.__notificationTones === 2);
    conversation.messages.find((message) => message.id === 3).deliveryStatus = 4;
    io.emit('message', { ...conversation });
    await page.locator('.message-receipt[aria-label="Visualizado"]').nth(1).waitFor();
    assert.equal(await page.evaluate(() => window.__notificationTones), 2, 'receipt updates must not sound like new incoming messages');
    io.emit('message', { ...conversation });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__notificationTones), 2);
    await page.locator('#chatMoreDetails summary').click();
    await page.getByRole('button', { name: 'Desativar notificações', exact: true }).click();
    await page.getByRole('button', { name: 'Ativar assinatura', exact: true }).click();
    await page.keyboard.press('Escape');
    conversation.messages.push({ id: 51, from: 'client', text: 'Mensagem silenciosa', at });
    io.emit('message', { ...conversation });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__notificationTones), 2);
    await page.locator('#composerInput').fill('Mensagem com assinatura');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => document.getElementById('composerInput').value === '');
    await page.waitForFunction(() => !document.getElementById('sendBtn').disabled);
    assert.equal(sentName, 'inbox-test');
    console.log('PASS: signature toggles and persistence, incoming sound, duplicate suppression and disabling sounds');
    await page.getByRole('button', { name: 'Silenciar áudio', exact: true }).first().click();
    assert.equal(await page.locator('.react-audio-player audio').first().evaluate(element => element.muted), true);
    await page.getByRole('button', { name: 'Ativar som do áudio', exact: true }).click();
    await page.getByRole('button', { name: 'Reproduzir áudio', exact: true }).first().click();
    await page.getByRole('button', { name: 'Pausar áudio', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pausar áudio', exact: true }).click();
    await page.getByLabel('Opções do áudio', { exact: true }).first().click();
    await page.getByLabel('Velocidade do áudio', { exact: true }).first().selectOption('1.5');
    assert.equal(await page.locator('.react-audio-player audio').first().evaluate(element => element.playbackRate), 1.5);

    // Exercise real browser capture with a synthetic microphone; no WhatsApp traffic.
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click();
    await page.getByRole('button', { name: 'Concluir gravação', exact: true }).waitFor();
    await page.waitForTimeout(650);
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor();
    assert.equal(await page.locator('#filePreview').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__testMicrophone.getTracks().every(track => track.readyState === 'ended')), true);
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click();
    await page.getByRole('button', { name: 'Concluir gravação', exact: true }).waitFor();
    await page.waitForTimeout(650);
    await page.getByRole('button', { name: 'Concluir gravação', exact: true }).click();
    await page.locator('.attachment-audio-preview').waitFor();
    await page.waitForFunction(() => window.__testMicrophone.getTracks().every(track => track.readyState === 'ended'));
    assert.equal(sentMedia, null, 'Recording must be reviewed before sending');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => document.getElementById('filePreview').hidden);
    assert.equal(sentMedia.type, 'audio');
    assert.match(sentMedia.mimeType, /^audio\/(mp4|ogg)/);
    assert.ok(sentMedia.buffer.length > 0);
    assert.deepEqual(errors, []);
    console.log('PASS: mute, playback speed, real microphone capture, discard, track cleanup and audio upload');
    const stickerFrames = await page.evaluate(() => ['#e33434', '#3366dd'].map(color => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 32, 32);
      return canvas.toDataURL('image/webp');
    }));
    conversation.messages.push(
      { id: 'sticker-static', from: 'client', type: 'image', mimeType: 'image/webp', mediaUrl: stickerFrames[0], fileName: 'sticker-static.webp', at },
      { id: 'sticker-animated', from: 'admin', type: 'gif', mimeType: 'image/webp', mediaUrl: animatedWebpFixture(stickerFrames), fileName: 'sticker-animated.webp', at },
    );
    io.emit('message', conversation);
    const staticSticker = page.getByAltText('sticker-static.webp', { exact: true });
    const animatedSticker = page.getByAltText('sticker-animated.webp', { exact: true });
    await staticSticker.scrollIntoViewIfNeeded(); await staticSticker.evaluate(image => image.decode());
    await animatedSticker.scrollIntoViewIfNeeded(); await animatedSticker.evaluate(image => image.decode());
    assert.equal(await animatedSticker.evaluate(image => image.naturalWidth), 32);
    const firstFrame = await animatedSticker.screenshot(); let animationChanged = false;
    for (let frame = 0; frame < 5 && !animationChanged; frame++) {
      await page.waitForTimeout(150);
      animationChanged = !firstFrame.equals(await animatedSticker.screenshot());
    }
    assert.ok(animationChanged, 'the actual animated WebP must change frames in the browser');
    await staticSticker.click();
    assert.equal(await staticSticker.getAttribute('aria-expanded'), 'true');
    await staticSticker.click();
    console.log('PASS: static and animated WhatsApp WebP stickers decode, animate and expand in the chat');
    let finishReply;
    replyGate = new Promise(resolve => { finishReply = resolve; });
    const beforeReplies = textReplies;
    await page.locator('#composerInput').fill('Primeira mensagem com envio lento');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('composerInput').value === '' && document.getElementById('sendBtn').disabled);
    assert.equal(await page.locator('#composerInput').isDisabled(), false);
    assert.equal(await page.locator('#composerInput').evaluate(element => document.activeElement === element), true);
    await page.keyboard.type('Proxima mensagem sem clicar');
    io.emit('message', { ...conversation });
    io.emit('contacts:updated', { synced: true });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#composerInput').inputValue(), 'Proxima mensagem sem clicar');
    assert.equal(await page.locator('#composerInput').evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Enter');
    assert.equal(textReplies, beforeReplies + 1, 'a second Enter during upload must not duplicate the request');
    finishReply(); replyGate = null;
    await page.waitForFunction(() => !document.getElementById('sendBtn').disabled);
    assert.equal(await page.locator('#composerInput').inputValue(), 'Proxima mensagem sem clicar', 'the next draft survives the previous send');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('sendBtn').disabled && document.getElementById('composerInput').value === '');
    assert.equal(sentText, 'Proxima mensagem sem clicar');
    failNextReply = true;
    await page.locator('#composerInput').fill('Rascunho preservado quando falha');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('composerInput').value === 'Rascunho preservado quando falha' && !document.getElementById('sendBtn').disabled);
    assert.equal(await page.locator('#composerInput').evaluate(element => document.activeElement === element), true);
    await page.locator('#composerInput').fill('');
    const mediaBeforePaste = sentMedia;
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      canvas.getContext('2d').fillRect(0, 0, 16, 16);
      const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const clipboardData = new DataTransfer(); clipboardData.items.add(new File([image], 'imagem-colada.png', { type: 'image/png' }));
      document.getElementById('composerInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await page.getByAltText('Imagem anexada para envio', { exact: true }).waitFor();
    assert.equal(sentMedia, mediaBeforePaste, 'pasting only stages an attachment for review');
    await page.locator('#composerInput').fill('Legenda da imagem colada');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => document.getElementById('filePreview').hidden && !document.getElementById('sendBtn').disabled);
    assert.equal(sentMedia.type, 'image'); assert.equal(sentMedia.fileName, 'imagem-colada.png');
    assert.equal(sentMedia.caption, 'Legenda da imagem colada');
    assert.equal(await page.locator('#composerInput').evaluate(element => document.activeElement === element), true);
    await page.evaluate(() => {
      const clipboardData = new DataTransfer(); clipboardData.items.add(new File(['documento colado'], 'documento.txt', { type: 'text/plain' }));
      document.getElementById('composerInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await page.locator('#filePreviewName').getByText('documento.txt', { exact: true }).waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('filePreview').hidden && !document.getElementById('sendBtn').disabled);
    assert.equal(sentMedia.type, 'document'); assert.equal(sentMedia.buffer.toString(), 'documento colado');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('Texto normal da area de transferencia'));
    await page.keyboard.press('Control+V');
    await page.waitForFunction(() => document.getElementById('composerInput').value === 'Texto normal da area de transferencia');
    await page.locator('#composerInput').fill('');
    console.log('PASS: stable composer focus, next draft during send, no duplicate Enter, failure recovery and reviewed clipboard image/document/plain-text paste');
    await page.locator('#conversationSearch').click();
    await page.locator('.convo-item.active').click();
    await page.waitForFunction(() => document.activeElement?.id === 'composerInput');
    await page.locator('[data-message-id="2"] .bubble-text').click();
    await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshots, 'message-options-mobile.png') });
    await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).getByRole('button', { name: 'Responder', exact: true }).click();
    await page.locator('#messageReplyPreview').getByText('Respondendo a Fernanda', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshots, 'message-reply-mobile.png') });
    assert.equal(await page.locator('#composerInput').evaluate(element => document.activeElement === element), true);
    await page.keyboard.type('Resposta a uma mensagem especifica'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('sendBtn').disabled && !!document.querySelector('.message-quote'));
    assert.equal(lastReplyTo, 2);
    await page.locator('.message-quote').last().click();
    await page.waitForFunction(() => document.activeElement?.dataset.messageId === '2');
    await page.locator('[data-message-id="5"] .message-menu-trigger').click();
    await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).getByRole('button', { name: 'Responder', exact: true }).click();
    await page.getByRole('button', { name: 'Cancelar resposta', exact: true }).click();
    assert.equal(await page.locator('#messageReplyPreview').innerText(), '');
    await page.locator('[data-message-id="1"] .message-menu-trigger').click();
    await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).getByRole('button', { name: 'Selecionar', exact: true }).click();
    await page.locator('[data-message-id="2"] .message-selection-check').check();
    const selectedMessages = page.getByRole('group', { name: 'Mensagens selecionadas', exact: true });
    assert.match(await selectedMessages.innerText(), /2 selecionadas/);
    await selectedMessages.getByRole('button', { name: 'Encaminhar', exact: true }).click();
    await page.getByLabel('Destinatário', { exact: true }).fill('5511999912345');
    await page.screenshot({ path: path.join(screenshots, 'message-forward-mobile.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Encaminhar', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(lastForward.messageIds, [1, 2]); assert.equal(lastForward.targetNumber, '5511999912345');
    assert.equal(state.conversations['5511999912345'].messages.length, 2);
    // Remove the isolated forwarding fixture so later inbox counts stay focused on real test conversations.
    delete state.conversations['5511999912345'];
    const localDeleteMessage = conversation.messages.find(message => message.text === 'Resposta a uma mensagem especifica');
    await page.locator(`[data-message-id="${localDeleteMessage.id}"] .message-menu-trigger`).click();
    await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).getByRole('button', { name: 'Apagar', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apagar', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(lastDelete.forEveryone, false);
    assert.equal(await page.locator(`[data-message-id="${localDeleteMessage.id}"]`).count(), 0);
    await page.locator('[data-message-id="3"] .message-menu-trigger').click();
    await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).getByRole('button', { name: 'Apagar', exact: true }).click();
    await page.getByLabel('Apagar também no WhatsApp para todos', { exact: true }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Apagar', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(lastDelete.forEveryone, true);
    console.log('PASS: left-click message menu, quoted replies and source navigation, multi-select forwarding, local deletion and delete for everyone');
    const unsavedLid = '123456789012345', unsavedPhone = '5511988881234';
    state.conversations[unsavedLid] = { number: unsavedLid, aliases: [unsavedPhone], name: '', messages: [{ from: 'client', text: 'Contato sem cadastro', at }], lastMessage: 'Contato sem cadastro', lastMessageAt: at };
    await page.evaluate((lid) => {
      const workspace = JSON.parse(sessionStorage.getItem('bwap-workspace-state'));
      workspace.selectedNumber = lid;
      sessionStorage.setItem('bwap-workspace-state', JSON.stringify(workspace));
    }, unsavedLid);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('chatTitle')?.textContent === '+55 (11) 98888-1234');
    assert.match(await page.locator('#chatSub').innerText(), /98888-1234/);
    await page.locator('#chatMoreDetails summary').click();
    await page.getByRole('button', { name: 'Dados do contato', exact: true }).click();
    assert.equal(await page.locator('#chatMoreNumber').innerText(), '+55 (11) 98888-1234');
    await page.keyboard.press('Escape');
    await page.locator('#conversationSearch').fill(unsavedPhone);
    assert.match(await page.locator('#convoList').innerText(), /98888-1234/);
    console.log('PASS: unsaved LID contacts show their phone in the list, header, details and search');
    await page.locator('#conversationSearch').fill('');
    assert.equal((await page.locator('#convoList').innerText()).includes('Agenda sem conversa'), false);
    assert.equal(await page.locator('#convoCount').innerText(), '2');
    state.status.contactsSync = { syncing: true, verified: false, stage: 'loading', error: '' };
    io.emit('status', state.status);
    await page.locator('.contacts-sync-overlay').waitFor();
    assert.equal(await page.locator('.react-page').evaluate(element => element.inert), true);
    const messagesBefore = conversation.messages.length;
    const blockedText = await context.request.post(base + '/api/reply', { data: { number, text: 'Bloqueado durante a carga' } });
    assert.equal(blockedText.status(), 423);
    const blockedMedia = await context.request.post(base + '/api/reply-media', { multipart: {
      number, file: { name: 'sync.txt', mimeType: 'text/plain', buffer: Buffer.from('blocked') },
    } });
    assert.equal(blockedMedia.status(), 423);
    assert.equal(conversation.messages.length, messagesBefore);
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.contacts-sync-overlay').isVisible(), true);
    await page.reload();
    await page.locator('.contacts-sync-overlay').waitFor();
    await page.screenshot({ path: path.join(screenshots, 'contacts-sync-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(screenshots, 'contacts-sync-mobile.png') });
    state.status.contactsSync = { syncing: true, verified: false, stage: 'verifying', error: '' };
    io.emit('status', state.status);
    await page.getByRole('heading', { name: 'Verificando os contatos', exact: true }).waitFor();
    state.status.contactsSync = { syncing: false, verified: false, stage: 'error', error: 'Falha de rede' };
    io.emit('status', state.status);
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor();
    assert.equal(await page.locator('.react-page').evaluate(element => element.inert), true);
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await page.locator('.contacts-sync-overlay').waitFor({ state: 'hidden' });
    state.status.contactsSync = { syncing: false, verified: true, stage: 'ready', error: '' };
    io.emit('status', state.status); io.emit('contacts:updated', { synced: true });
    await page.locator('.contacts-sync-overlay').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.react-page').evaluate(element => element.inert), false);
    assert.equal((await context.request.post(base + '/api/reply', { data: { number, text: 'Liberado após a verificação' } })).status(), 200);
    const secondChip = await (await context.request.post(base + '/api/chips', { data: { name: 'Segundo teste', departmentId: department.department.id } })).json();
    await page.reload();
    await page.locator('#chatTitle').waitFor();
    await page.waitForLoadState('networkidle');
    io.emit('chip:status', { chipId: secondChip.chip.id, connected: true, contactsSync: { syncing: true, verified: false, stage: 'loading' } });
    await page.locator('.contacts-sync-overlay').waitFor();
    io.emit('status', { ...state.status, chipId: 1 });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.contacts-sync-overlay').isVisible(), true, 'one ready chip must not unlock another syncing chip');
    io.emit('chip:status', { chipId: secondChip.chip.id, connected: true, contactsSync: { syncing: false, verified: true, stage: 'ready' } });
    await page.locator('.contacts-sync-overlay').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('PASS: full-panel loader, keyboard blocking, refresh persistence, text/media rejection, verification, failure recovery and unlock');
    conversation.messages = Array.from({ length: 5000 }, (_, index) => ({ id: 10000 + index, whatsappId: `large-${index}`, from: index % 2 ? 'admin' : 'client', text: `Histórico extenso ${index}`, at: new Date(Date.now() - (5000 - index) * 1000).toISOString() }));
    await page.evaluate(number => {
      const workspace = JSON.parse(sessionStorage.getItem('bwap-workspace-state'));
      workspace.selectedNumber = number;
      sessionStorage.setItem('bwap-workspace-state', JSON.stringify(workspace));
    }, number);
    await page.reload();
    await page.getByText('Histórico extenso 4999', { exact: true }).waitFor();
    assert.equal(await page.locator('.message-bubble').count(), 100, 'large histories render in blocks without deleting records');
    await page.evaluate(() => {
      window.historyTypingMutations = 0;
      new MutationObserver(records => { window.historyTypingMutations += records.length; }).observe(document.querySelector('.react-messages'), { childList: true, characterData: true, subtree: true });
    });
    const started = Date.now();
    await page.locator('#composerInput').pressSequentially('Envio com cinco mil mensagens');
    const typingMs = Date.now() - started;
    assert.equal(await page.evaluate(() => window.historyTypingMutations), 0, 'typing must not redraw or reformat message history');
    io.emit('message', { ...conversation, partialMessages: true, messages: [{ ...conversation.messages[4999], deliveryStatus: 4 }] });
    await page.locator('[data-message-id="14999"] [aria-label="Visualizado"]').waitFor();
    assert.equal(await page.locator('.message-bubble').count(), 100);
    await page.locator('#sendBtn').click();
    await page.locator('.bubble-text').filter({ hasText: 'Envio com cinco mil mensagens' }).waitFor();
    assert.equal(conversation.messages.length, 5001);
    assert.equal(await page.locator('.message-bubble').count(), 100);
    await page.getByRole('button', { name: /Carregar mensagens anteriores/ }).click();
    assert.equal(await page.locator('.message-bubble').count(), 200);
    assert.equal(conversation.messages.length, 5001, 'loading earlier messages never truncates storage');
    assert.deepEqual(errors, []);
    console.log(`PASS: 5,000-message history, 100 visible rows, typing without history mutations (${typingMs} ms), partial receipts, sending and earlier-message loading`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => io.close(resolve));
    await db.close();
    const resolved = path.resolve(storageDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('bot-wap-inbox-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
