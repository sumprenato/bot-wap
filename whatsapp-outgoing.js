const { AsyncLocalStorage } = require("node:async_hooks");

// Serialize application sends on one socket and make each original payload
// recoverable before Baileys encrypts it for the recipient and companion devices.
function createOutgoingSender({ send, retryStore, generateId, isCurrent }) {
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();
  const assertCurrent = () => {
    if (!isCurrent())
      throw Object.assign(
        new Error(
          "O WhatsApp está reconectando. O envio ainda não foi iniciado.",
        ),
        { code: "WHATSAPP_NOT_READY", deliveryAttempted: false },
      );
  };

  async function patchMessageBeforeSending(message) {
    const outgoing = context.getStore();
    if (outgoing && !outgoing.persisted && !message.deviceSentMessage) {
      assertCurrent();
      await retryStore.persist({ key: outgoing.key, message });
      outgoing.persisted = true;
      assertCurrent();
    }
    return message;
  }

  function sendMessage(jid, message, options = {}, beforeSend) {
    const result = queue.then(async () => {
      assertCurrent();
      await beforeSend?.();
      assertCurrent();
      const messageId = options.messageId || generateId();
      const outgoing = {
        key: { remoteJid: jid, id: messageId, fromMe: true },
        persisted: false,
      };
      return context.run(outgoing, async () => {
        const sent = await send(jid, message, { ...options, messageId });
        if (isCurrent()) {
          retryStore.remember(sent);
          if (!outgoing.persisted) await retryStore.persist(sent);
        }
        return sent;
      });
    });
    queue = result.catch(() => {});
    return result;
  }

  return { sendMessage, patchMessageBeforeSending };
}

module.exports = { createOutgoingSender };
