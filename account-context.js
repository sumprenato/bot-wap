const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const accountId = () => context.getStore()?.accountId || 1;
const actorId = () => context.getStore()?.actorId || accountId();
const departmentId = () => context.getStore()?.departmentId || null;
module.exports = { accountId, actorId, departmentId, withAccount: (id, fn, userId, department) => context.run({ accountId: Number(id), actorId: Number(userId || id), departmentId: department || null }, fn) };
