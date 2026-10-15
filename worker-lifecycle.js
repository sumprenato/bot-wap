// IPC loss must stop a worker: otherwise a replacement server creates a second
// socket with the same credentials and both processes keep replacing each other.
function installWorkerLifecycle({ worker = process, stop, close, timeoutMs = 5000 }) {
  let stopping = false, result = null, exitCode = 0, exited = false;
  const exit = code => { if (!exited) { exited = true; worker.exit(code); } };
  const shutdown = (code = 0) => {
    exitCode = Math.max(exitCode, code);
    if (result) return result;
    stopping = true;
    const deadline = setTimeout(() => exit(1), timeoutMs);
    deadline.unref?.();
    result = (async () => {
      try { await stop(); await close(); }
      catch { exitCode = 1; }
      finally { clearTimeout(deadline); exit(exitCode); }
    })();
    return result;
  };
  worker.on('disconnect', () => shutdown());
  worker.on('SIGTERM', () => shutdown());
  worker.on('SIGINT', () => shutdown());
  if (worker.connected === false) shutdown();
  return { shutdown, get stopping() { return stopping; } };
}

module.exports = { installWorkerLifecycle };
