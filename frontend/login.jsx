import React, { useEffect, useState } from "react";
import { api, loginDestination } from "./api";
import { Icon } from './icons';

export function LoginThemeSwitch() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  return <div className="auth-theme-switch" role="group" aria-label="Tema da tela de acesso">{[['dark', 'moon', 'Tema escuro'], ['light', 'sun', 'Tema claro']].map(([value, icon, label]) => <button key={value} type="button" aria-label={label} title={label} aria-pressed={theme === value} onClick={() => {
    document.documentElement.dataset.theme = value;
    window.BotWapStorage?.local.set('bwap-theme', value);
    setTheme(value);
  }}><Icon name={icon} size={16}/></button>)}</div>;
}

export function LoginCard() {
  const [mode, setMode] = useState("login"),
    [fields, setFields] = useState({
      username: "",
      password: "",
      displayName: "",
      confirmPassword: "",
    });
  const [visible, setVisible] = useState(false),
    [rememberLogin, setRememberLogin] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const register = mode === "register";
  useEffect(() => {
    api("/api/session")
      .then((data) => {
        if (data.authenticated && data.rememberLogin === true) {
          location.replace(loginDestination(data.authorization, data.destination));
        }
      })
      .catch(() => {});
  }, []);
  const input = (name) => ({
    value: fields[name],
    onChange: (event) =>
      setFields((previous) => ({ ...previous, [name]: event.target.value })),
  });
  return (
    <div className="login-card" data-react-component="Login">
      <div className="login-card-icon"><Icon name="conversation" size={23}/></div>
      <div className="login-header">
        <p className="login-kicker">Acesso ao painel</p>
        <h1 id="authTitle">
          {register ? (
            <>
              Crie seu <em>acesso.</em>
            </>
          ) : (
            <>
              Boas-vindas.
            </>
          )}
        </h1>
        <p id="authDescription">
          {register
            ? "Cadastre um operador para acompanhar os atendimentos."
            : "Entre para acompanhar suas conversas e cuidar de cada atendimento."}
        </p>
      </div>
      <div className="auth-tabs" role="tablist" aria-label="Acesso ao painel">
        {[
          ["login", "Entrar", "loginTab"],
          ["register", "Criar acesso", "registerTab"],
        ].map(([value, label, id]) => (
          <button
            key={value}
            id={id}
            type="button"
            role="tab"
            className={"auth-tab" + (mode === value ? " is-active" : "")}
            aria-selected={mode === value}
            aria-controls="loginForm"
            tabIndex={mode === value ? 0 : -1}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : mode === 'login' ? 'register' : 'login';
              setMode(next); setError('');
              document.getElementById(next === 'login' ? 'loginTab' : 'registerTab')?.focus();
            }}
            onClick={() => {
              setMode(value);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        id="loginForm"
        role="tabpanel"
        aria-labelledby={register ? 'registerTab' : 'loginTab'}
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const invalid = [...event.currentTarget.elements].find(
            (item) => item.willValidate && !item.validity.valid,
          );
          if (invalid) {
            setError(invalid.validationMessage);
            invalid.focus();
            return;
          }
          setBusy(true);
          setError("");
          try {
            const result = await api("/api/" + mode, "POST", { ...fields, rememberLogin: !register && rememberLogin });
            location.replace(loginDestination(result.authorization, result.destination));
          } catch (failure) {
            setError(failure.message);
            setBusy(false);
          }
        }}
      >
        <div className="input-group">
          <label htmlFor="username">Usuário</label>
          <div className="auth-input"><Icon name="user" size={17}/>
          <input
            {...input("username")}
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="ID para entrar no painel"
            minLength={3}
            maxLength={40}
            pattern="[A-Za-z0-9_.-]+"
            required
          />
          </div>
        </div>
        {register && (
          <div className="input-group register-fields" id="displayNameField">
            <label htmlFor="displayName">Nome no painel</label>
            <div className="auth-input"><Icon name="user" size={17}/>
            <input
              {...input("displayName")}
              id="displayName"
              autoComplete="name"
              maxLength={60}
              required
              placeholder="Nome que aparecerá nas mensagens"
            />
            </div>
          </div>
        )}
        <div className="input-group">
          <label htmlFor="password">Senha</label>
          <div className="password-field">
            <Icon name="lock" size={17}/>
            <input
              {...input("password")}
              id="password"
              type={visible ? "text" : "password"}
              required
              autoComplete={register ? "new-password" : "current-password"}
              placeholder="Sua senha"
              minLength={register ? 6 : undefined}
            />
            <button
              type="button"
              id="togglePassword"
              aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              <Icon name={visible ? 'eyeOff' : 'eye'} size={18}/>
            </button>
          </div>
        </div>
        {register && (
          <div className="register-fields" id="registerFields">
            <div className="input-group">
              <label htmlFor="confirmPassword">Confirmar senha</label>
              <div className="auth-input"><Icon name="lock" size={17}/>
              <input
                {...input("confirmPassword")}
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                placeholder="Repita sua senha"
              />
              </div>
            </div>
          </div>
        )}
        {!register && (
          <div className="remember-login">
            <button
              type="button"
              id="rememberLogin"
              className="remember-toggle"
              role="switch"
              aria-checked={rememberLogin}
              aria-describedby="rememberLoginHint"
              disabled={busy}
              onClick={() => setRememberLogin((value) => !value)}
            >
              <span className="remember-track" aria-hidden="true"><span /></span>
              Lembrar o login
            </button>
            <p id="rememberLoginHint">
              {rememberLogin
                ? "Mantenha o acesso neste navegador por 2 horas, mesmo ao fechá-lo."
                : "Acesso até fechar o navegador, por no máximo 2 horas."}
            </p>
          </div>
        )}
        <button
          type="submit"
          className={"login-btn" + (busy ? " is-loading" : "")}
          id="authSubmit"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Entrando…" : register ? "Criar acesso" : "Entrar no Painel"}
          {!busy && <Icon name="arrowRight" size={17}/>}
        </button>
        <p id="errorMsg" className="error-msg" role="alert" hidden={!error}>
          {error}
        </p>
      </form>
      <p className="login-footnote">
        <Icon name="lock" size={12}/> ambiente protegido e privado
      </p>
    </div>
  );
}
