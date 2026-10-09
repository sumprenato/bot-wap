document.addEventListener('DOMContentLoaded', async () => {
  if (await Auth.redirectIfLogged()) return;

  let authMode = 'login';
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const registerFields = document.getElementById('registerFields');
  const displayNameField = document.getElementById('displayNameField');
  const displayName = document.getElementById('displayName');
  const whatsappNumber = document.getElementById('whatsappNumber');
  const authTitle = document.getElementById('authTitle');
  const authDescription = document.getElementById('authDescription');
  const authSubmit = document.getElementById('authSubmit');
  const confirmPassword = document.getElementById('confirmPassword');
  const errorMsg = document.getElementById('errorMsg');

  function formatWhatsappNumber(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 13);
    if (!digits) return '';
    if (!digits.startsWith('55')) return `+${digits}`;
    if (digits.length <= 2) return `+${digits}`;
    if (digits.length <= 4) return `+55 (${digits.slice(2)}`;
    if (digits.length <= 9) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4)}`;
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  whatsappNumber.addEventListener('input', () => {
    whatsappNumber.value = formatWhatsappNumber(whatsappNumber.value);
  });

  function setAuthMode(mode) {
    authMode = mode;
    const isRegister = mode === 'register';
    loginTab.classList.toggle('is-active', !isRegister);
    registerTab.classList.toggle('is-active', isRegister);
    loginTab.setAttribute('aria-selected', String(!isRegister));
    registerTab.setAttribute('aria-selected', String(isRegister));
    registerFields.hidden = !isRegister;
    displayNameField.hidden = !isRegister;
    confirmPassword.required = isRegister;
    displayName.required = isRegister;
    authTitle.innerHTML = isRegister ? 'Crie seu <em>acesso.</em>' : 'Seu espaço.<br><em>Sua conexão.</em>';
    authDescription.textContent = isRegister ? 'Cadastre um operador para acompanhar os atendimentos.' : 'Entre para acompanhar suas conversas e cuidar de cada atendimento.';
    authSubmit.textContent = isRegister ? 'Criar acesso' : 'Entrar no Painel';
    errorMsg.hidden = true;
  }

  loginTab.addEventListener('click', () => setAuthMode('login'));
  registerTab.addEventListener('click', () => setAuthMode('register'));

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    errorMsg.hidden = true;
    const originalText = authSubmit.textContent;
    authSubmit.textContent = authMode === 'register' ? 'Criando acesso…' : 'Autenticando…';
    authSubmit.classList.add('is-loading');
    authSubmit.disabled = true;

    try {
      const response = await BotWapApi.request(`/api/${authMode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          displayName: displayName.value,
          whatsappNumber: whatsappNumber.value,
          password,
          confirmPassword: confirmPassword.value,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        authSubmit.textContent = '✓ Entrando…';
        window.location.replace(Auth.loginDestination());
        return;
      }
      errorMsg.textContent = data.error || (authMode === 'register' ? 'Não foi possível criar o acesso.' : 'Credenciais inválidas');
    } catch {
      errorMsg.textContent = 'Erro de conexão ao servidor.';
    }
    errorMsg.hidden = false;
    authSubmit.textContent = originalText;
    authSubmit.classList.remove('is-loading');
    authSubmit.disabled = false;
  });

  document.getElementById('togglePassword').addEventListener('click', function () {
    const password = document.getElementById('password');
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    this.textContent = visible ? 'mostrar' : 'ocultar';
    this.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha');
  });
});
