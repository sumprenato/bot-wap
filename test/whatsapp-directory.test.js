const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { WhatsAppDirectory } = require("../whatsapp-directory");

function socketFixture() {
  const ev = new EventEmitter(),
    resets = [],
    syncs = [],
    pictures = [];
  return {
    ev,
    user: { id: "5511000000000:1@s.whatsapp.net" },
    profilePictureUrl: async (jid) => {
      pictures.push(jid);
      return `https://photo.invalid/${jid}`;
    },
    resyncAppState: async (...args) => {
      syncs.push(args);
    },
    keys: { set: async (value) => resets.push(value) },
    resets,
    syncs,
    pictures,
  };
}

test("WhatsApp directory imports full saved address book, deduplicates photos and requests a fresh snapshot", async () => {
  const socket = socketFixture(),
    saved = [],
    events = [];
  const store = {
    saveContact: async (contact) => {
      saved.push(contact);
      return contact;
    },
    getKnownJid: async (number) => `${number}@s.whatsapp.net`,
  };
  const directory = new WhatsAppDirectory({
    socket,
    store,
    authKeys: socket.keys,
    emit: (name, payload) => events.push([name, payload]),
    connected: () => true,
  });
  socket.ev.emit("messaging-history.set", {
    chats: [{ id: "551188887777@s.whatsapp.net", name: "Agenda" }],
    contacts: [
      { id: "551199998888@s.whatsapp.net", name: "Cliente" },
      { id: "551122223333@s.whatsapp.net", notify: "Perfil desconhecido" },
      { id: "551122224444@s.whatsapp.net", verifiedName: "Empresa desconhecida" },
      { id: "grupo@g.us", name: "Grupo" },
    ],
  });
  await directory.queue;
  assert.deepEqual(saved.map((item) => item.number).sort(), [
    "551188887777",
    "551199998888",
  ]);
  assert.ok(saved.every((item) => item.preserveActivity));
  assert.ok(saved.every((item) => item.nameSource === 'whatsapp'));
  assert.equal(
    events.filter(([name]) => name === "contacts:updated").length,
    0,
  );
  await directory.sync();
  assert.equal(events.filter(([name]) => name === 'contacts:updated').length, 1);
  assert.equal(events.filter(([name]) => name === 'contact').length, 0);
  assert.deepEqual(socket.syncs, [[["critical_unblock_low"], true]]);
  assert.equal(socket.resets.length, 1);
  const [first, second] = await Promise.all([
    directory.profile("551199998888"),
    directory.profile("551199998888"),
  ]);
  assert.equal(first.profilePic, second.profilePic);
  assert.deepEqual(socket.pictures, ["551199998888@s.whatsapp.net"]);
  assert.match((await directory.profile("me")).profilePic, /5511000000000/);
});
