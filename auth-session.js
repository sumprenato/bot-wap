const LOGIN_DURATION_MS = 2 * 60 * 60 * 1000;

function isAuthenticated(session) {
  return Boolean(session?.userId && Number.isFinite(session.authExpiresAt)
    && session.authExpiresAt > Date.now());
}

async function startSession(req, userId, rememberLogin = false) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
  req.session.userId = userId;
  req.session.authExpiresAt = Date.now() + LOGIN_DURATION_MS;
  req.session.rememberLogin = rememberLogin === true;
  req.session.cookie.maxAge = rememberLogin === true ? LOGIN_DURATION_MS : null;
  await new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

function enforceSessionExpiry(req, res, next) {
  if (!req.session?.userId) return next();
  if (!isAuthenticated(req.session)) {
    return req.session.regenerate((error) => {
      if (error) return next(error);
      res.clearCookie('connect.sid', { path: '/' });
      next();
    });
  }
  // Requests must never extend the original two-hour deadline.
  if (req.session.rememberLogin) {
    req.session.cookie.maxAge = req.session.authExpiresAt - Date.now();
  }
  next();
}

module.exports = { LOGIN_DURATION_MS, isAuthenticated, startSession, enforceSessionExpiry };
