import React, { useEffect, useRef, useState } from "react";
import { api, phone } from "./api";
import { Action, DataTable } from "./components";
import { Icon } from "./icons";

function ChipDialog({ title, close, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const panel = ref.current;
    panel.querySelector("input,button,select")?.focus();
    const keyboard = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const controls = [...panel.querySelectorAll("button,input,select,a[href]")].filter((item) => !item.disabled);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); previous?.focus(); };
  }, [close]);
  return <div className="chip-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={ref} className="chip-modal" role="dialog" aria-modal="true" aria-labelledby="chip-dialog-title">
      <header><h2 id="chip-dialog-title">{title}</h2><button type="button" className="chip-modal-close" aria-label="Fechar" onClick={close}>×</button></header>
      {children}
    </section>
  </div>;
}

export function Chips({ ctx }) {
  const [edit, setEdit] = useState(null), [qrId, setQrId] = useState(null);
  const [name, setName] = useState(""), [department, setDepartment] = useState("");
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => {
    const dismiss = (event) => {
      document.querySelectorAll('.chip-row-menu[open]').forEach((menu) => {
        if ((event.type === 'keydown' && event.key === 'Escape') || (event.type === 'pointerdown' && !menu.contains(event.target))) menu.open = false;
      });
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); };
  }, []);
  const close = React.useCallback(() => { if (!saving) { setEdit(null); setQrId(null); setError(""); } }, [saving]);
  const qrChip = ctx.data.chips.find((chip) => String(chip.id) === String(qrId));
  const openEditor = (chip = {}) => { setName(chip.name || ""); setDepartment(String(chip.department_id || "")); setError(""); setEdit(chip); };
  const connect = async (chip) => { setQrId(chip.id); };
  return <>
    <div className="chips-toolbar"><p>O telefone é identificado automaticamente ao conectar.</p>{ctx.can('chips.gerenciar') && <button type="button" className="text-action text-action--primary" id="newChipBtn" onClick={() => openEditor()}>+ Novo chip</button>}</div>
    <DataTable kind="Meus chips" rows={ctx.data.chips} headings={["Nome", "Tipo", "Status", "Telefone", "Atendimento", "Departamento", "Ações"]} empty="Nenhum chip cadastrado. Clique em Novo chip para conectar seu WhatsApp."
      row={(chip) => <tr key={chip.id} data-chip-id={chip.id}>
        <td><span className="chip-name">{chip.name}</span>{!!chip.is_primary && <small className="chip-primary-label">Padrão</small>}</td>
        <td><span className="chip-type">Conexão direta</span></td>
        <td><span className={`chip-status-pill ${chip._connected ? "is-online" : "is-offline"}`}><span className="chip-status-dot" />{chip._connected ? "Conectado" : chip._error ? "Conexão recusada" : chip._qr ? "Aguardando QR" : "Conectando"}</span></td>
        <td className="chip-number">{chip.number ? phone(chip.number) : "Aguardando conexão"}</td>
        <td><span className="chip-human"><Icon name="user" size={16} />Humano</span></td>
        <td><label className="chip-department-field"><span className="sr-only">Departamento de {chip.name}</span><select value={chip.department_id || ""} disabled={saving || !ctx.can('chips.gerenciar')} onChange={(event) => ctx.execute(`chip-dept-${chip.id}`, async () => { await api(`/api/chips/${chip.id}/department`, "PUT", { departmentId: event.target.value }); await ctx.load("chips"); })}>{ctx.data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></td>
        <td><details className="chip-row-menu" hidden={!ctx.can('chips.gerenciar')}><summary aria-label={`Ações de ${chip.name}`}><Icon name="more" /></summary><div>
          <Action action={(event) => { event.currentTarget.closest("details").open = false; return connect(chip); }}>{chip._connected ? "Ver conexão" : "Conectar por QR Code"}</Action>
          {!chip.is_primary && <Action action={async (event) => { event.currentTarget.closest("details").open = false; await api(`/api/chips/${chip.id}/primary`, "POST"); await ctx.load("chips"); }}>Usar como padrão</Action>}
          <button type="button" onClick={(event) => { event.currentTarget.closest("details").open = false; openEditor(chip); }}>Editar canal</button>
          {chip._connected && <Action action={async (event) => { event.currentTarget.closest("details").open = false; if (await ctx.confirm({ title: "Desconectar chip?", body: "Use a mesma conta ao escanear o QR Code novamente. Para outro WhatsApp, crie um novo chip.", okText: "Desconectar" })) { await api(`/api/chips/${chip.id}/disconnect`, "POST"); await ctx.load("chips"); setQrId(chip.id); } }}>Desconectar</Action>}
          <Action className="chip-danger" action={async (event) => { event.currentTarget.closest("details").open = false; if (await ctx.confirm({ title: "Remover chip?", body: `O canal ${chip.name} será removido.`, okText: "Remover" })) { await api(`/api/chips/${chip.id}`, "DELETE"); await ctx.load("chips"); } }}>Remover chip</Action>
        </div></details></td>
      </tr>} />
    {edit && ctx.can('chips.gerenciar') && <ChipDialog title={edit.id ? "Editar canal WhatsApp" : "Novo chip WhatsApp"} close={close}>
      <p className="chip-modal-description">Conecte pelo QR Code, como no WhatsApp Web. O número será preenchido automaticamente após a leitura.</p>
      <form onSubmit={async (event) => { event.preventDefault(); if (saving) return; if (!name.trim() || !department) { setError("Informe o nome do canal e selecione um departamento."); return; } setSaving(true); setError(""); try {
        const result = await api(edit.id ? `/api/chips/${edit.id}/department` : "/api/chips", edit.id ? "PUT" : "POST", { name: name.trim(), departmentId: department });
        await ctx.load("chips"); setEdit(null); if (!edit.id) setQrId(result.chip.id);
      } catch (failure) { setError(failure.message); } finally { setSaving(false); } }}>
        <div className="profile-field"><label htmlFor="chipNameInput">Nome do canal</label><input id="chipNameInput" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Ex.: Comercial, Suporte" disabled={saving} required /></div>
        <div className="profile-field"><label htmlFor="chipDepartmentInput">Departamento padrão</label><select id="chipDepartmentInput" value={department} onChange={(event) => setDepartment(event.target.value)} disabled={saving} required><option value="">Selecione um departamento</option>{ctx.data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        {!ctx.data.departments.length && <p>Crie um departamento na página <a href="/departamentos">Departamentos</a> antes de salvar.</p>}
        <p className="chip-form-note"><Icon name="user" size={18} />Primeiro atendimento: humano</p>
        {error && <p className="profile-error" role="alert">{error}</p>}
        <footer><button type="button" className="text-action" disabled={saving} onClick={close}>Cancelar</button><button className="text-action text-action--primary" id="addChipBtn" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button></footer>
      </form>
    </ChipDialog>}
    {qrChip && ctx.can('chips.gerenciar') && <ChipDialog title={`WhatsApp · ${qrChip.name}`} close={close}>
      {qrChip._connected ? <div className="chip-connected"><Icon name="check" size={40} /><h3>WhatsApp conectado</h3><p>{phone(qrChip.number)}</p></div> : <>
        <p className="chip-modal-description">No WhatsApp, abra <strong>Aparelhos conectados → Conectar dispositivo</strong> e escaneie este QR Code.</p>
        {qrChip._error && <p className="profile-error" role="alert">{qrChip._error}</p>}
        <div className="chip-qr-area">{qrChip._qr ? <img className="chip-qr-img" src={qrChip._qr} alt={`QR Code para conectar ${qrChip.name}`} /> : <p role="status">Gerando QR Code…</p>}</div>
        <p className="chip-form-note">{qrChip.number ? `Reconecte o mesmo WhatsApp: ${phone(qrChip.number)}.` : "O telefone da conta conectada aparecerá na lista automaticamente."}</p>
      </>}
      <footer><button type="button" className="text-action" onClick={close}>Fechar</button></footer>
    </ChipDialog>}
  </>;
}
