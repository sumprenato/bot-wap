import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, cleanNumber } from './api';

const preview = message => message.caption || message.text || `[${message.type || 'Mensagem'}]`;
export function QuotedMessage({ quote, contactName, messages }) {
  return <button type="button" className="message-quote" onClick={() => {
    const source = messages.find(message => message.id === quote.id || quote.whatsappId && message.whatsappId === quote.whatsappId);
    if (!source) return;
    const element = document.querySelector(`[data-message-id="${source.id}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element?.focus({ preventScroll: true });
  }}><strong>{quote.from === 'admin' ? 'Você' : contactName}</strong><span>{preview(quote)}</span></button>;
}

function MessageOperation({ ctx, operation, close, complete, messages }) {
  const ref = useRef(null), [target, setTarget] = useState(''), [everyone, setEveryone] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const rows = messages.filter(message => operation.ids.includes(message.id));
  const canDeleteEveryone = rows.length === operation.ids.length && rows.every(message => message.from === 'admin' && message.whatsappId);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  const targets = new Map([
    ...Object.values(ctx.data.state.conversations || {}).map(item => [item.number, item.name || item.phoneNumber || item.number]),
    ...ctx.data.contacts.map(item => [item.number, item.name || item.number]),
  ]);
  const forwarding = operation.type === 'forward';
  return <dialog ref={ref} className="message-operation-dialog" aria-labelledby="message-operation-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setError('');
      try {
        const result = await api(`/api/conversation/${ctx.selected}/messages/${forwarding ? 'forward' : 'delete'}`, 'POST', {
          chipId: ctx.data.state.chipId, messageIds: operation.ids,
          ...(forwarding ? { targetNumber: cleanNumber(target) } : { forEveryone: everyone }),
        });
        if (result.conversation && String(result.conversation.chipId) === String(ctx.current().data.state.chipId)) ctx.setData(previous => ({ ...previous, state: { ...previous.state, conversations: { ...previous.state.conversations, [result.conversation.number]: result.conversation } } }));
        complete(); close();
      } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    }}>
      <h2 id="message-operation-title">{forwarding ? 'Encaminhar' : 'Apagar'} {operation.ids.length === 1 ? 'mensagem' : `${operation.ids.length} mensagens`}</h2>
      {forwarding ? <><label htmlFor="message-forward-target">Destinatário</label><input id="message-forward-target" list="message-forward-contacts" required autoFocus placeholder="Selecione um contato ou informe o telefone" value={target} onChange={event => setTarget(event.target.value)} disabled={busy} /><datalist id="message-forward-contacts">{[...targets].map(([number, label]) => <option key={number} value={number}>{label}</option>)}</datalist><p>As mensagens serão enviadas pelo canal atual.</p></> : <><p>{everyone ? 'As mensagens enviadas serão apagadas também no WhatsApp para todos.' : 'As mensagens serão removidas do histórico deste painel.'}</p>{canDeleteEveryone && <label className="message-delete-everyone"><input type="checkbox" checked={everyone} onChange={event => setEveryone(event.target.checked)} disabled={busy} />Apagar também no WhatsApp para todos</label>}</>}
      {error && <p role="alert" className="profile-error">{error}</p>}
      <div className="confirm-actions"><button type="button" className="confirm-cancel" disabled={busy} onClick={close}>Cancelar</button><button type="submit" className="profile-save" disabled={busy || ctx.contactsBlocked || (forwarding || everyone) && !(ctx.data.state.channelStatus || ctx.data.state.status)?.connected}>{busy ? 'Aguarde…' : forwarding ? 'Encaminhar' : 'Apagar'}</button></div>
    </form>
  </dialog>;
}

export function useMessageActions(ctx, messages) {
  const [menu, setMenu] = useState(null), [chosen, setChosen] = useState([]), [operation, setOperation] = useState(null), menuRef = useRef(null);
  useEffect(() => { setMenu(null); setChosen([]); setOperation(null); }, [ctx.selected, ctx.data.state.chipId]);
  useEffect(() => {
    setChosen(previous => previous.some(id => !messages.some(message => message.id === id)) ? previous.filter(id => messages.some(message => message.id === id)) : previous);
    if (ctx.contactsBlocked) { setMenu(null); setOperation(null); }
  }, [messages, ctx.contactsBlocked]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const element = menuRef.current;
    if (!element.matches(':popover-open')) element.showPopover();
    element.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - element.offsetHeight - 8))}px`;
    element.querySelector('button:not(:disabled)')?.focus();
  }, [menu]);
  const select = id => {
    if (!chosen.includes(id) && chosen.length >= 30) { ctx.notify('Selecione no máximo 30 mensagens por vez.'); return; }
    setChosen(previous => {
    if (previous.includes(id)) return previous.filter(value => value !== id);
    if (previous.length >= 30) return previous;
    return [...previous, id];
    });
  };
  const open = (event, message) => {
    if (ctx.contactsBlocked || operation) return;
    if (chosen.length) { select(message.id); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ message, x: event.clientX || rect.right - 190, y: event.clientY || rect.bottom });
  };
  const launch = (type, ids) => { setMenu(null); setOperation({ type, ids }); };
  return {
    chosen,
    bubble: message => ({
      tabIndex: 0, 'data-message-id': message.id, 'aria-label': `Mensagem: ${preview(message)}`,
      onClick: event => { if (!event.target.closest('button,a,input,audio,video,[role="button"]') && !window.getSelection()?.toString()) open(event, message); },
      onKeyDown: event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); open(event, message); } },
    }),
    trigger: message => <><button type="button" className="message-menu-trigger" aria-label="Opções da mensagem" onClick={event => open(event, message)}>⌄</button>{chosen.length > 0 && <input className="message-selection-check" type="checkbox" aria-label="Selecionar mensagem" checked={chosen.includes(message.id)} onChange={() => select(message.id)} />}</>,
    toolbar: chosen.length > 0 && <div className="message-selection-toolbar" role="group" aria-label="Mensagens selecionadas"><span>{chosen.length} selecionada{chosen.length > 1 ? 's' : ''}</span>{ctx.can('atendimento.responder') && <button type="button" onClick={() => launch('forward', chosen)}>Encaminhar</button>}{ctx.can('atendimento.excluir') && <button type="button" onClick={() => launch('delete', chosen)}>Apagar</button>}<button type="button" onClick={() => setChosen([])}>Cancelar seleção</button></div>,
    tools: <>
      {menu && <div ref={menuRef} popover="auto" className="message-actions-menu" role="group" aria-label="Ações da mensagem" onToggle={event => { if (event.newState === 'closed') setMenu(null); }}>
        {ctx.can('atendimento.responder') && <button type="button" disabled={!menu.message.whatsappId} title={!menu.message.whatsappId ? 'Esta mensagem antiga não possui o identificador do WhatsApp.' : undefined} onClick={() => {
          ctx.setReplyTarget({ chipId: ctx.data.state.chipId, number: ctx.selected, message: menu.message }); setMenu(null);
          requestAnimationFrame(() => document.getElementById('composerInput')?.focus({ preventScroll: true }));
        }}>Responder</button>}
        <button type="button" onClick={() => { select(menu.message.id); setMenu(null); }}>Selecionar</button>
        {ctx.can('atendimento.responder') && <button type="button" onClick={() => launch('forward', [menu.message.id])}>Encaminhar</button>}
        {ctx.can('atendimento.excluir') && <button type="button" className="is-danger" onClick={() => launch('delete', [menu.message.id])}>Apagar</button>}
      </div>}
      {operation && <MessageOperation ctx={ctx} operation={operation} messages={messages} close={() => setOperation(null)} complete={() => setChosen([])} />}
    </>,
  };
}
