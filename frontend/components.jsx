import React, { useContext, useEffect, useId, useRef, useState } from "react";
import { UI, TemplateNode } from "./template";
import { actionPermission } from './access';

export function ActionMenu({ label, children }) {
  const ctx = useContext(UI), id = useId(), menu = useRef(null), trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const available = (nodes) => React.Children.toArray(nodes).some((child) => React.isValidElement(child) && (child.type === React.Fragment ? available(child.props.children) : !ctx.can || ctx.can(actionPermission(child.props))));
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (!menu.current?.contains(event.target)) menu.current?.hidePopover(); };
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  if (!available(children)) return null;
  return <div className="record-actions"><button ref={trigger} type="button" className="record-actions-trigger" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => {
    const panel = menu.current;
    if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
    const rect = trigger.current.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232))}px`;
    panel.style.top = `${rect.bottom + 6}px`; panel.showPopover();
    if (rect.bottom + 6 + panel.offsetHeight > window.innerHeight - 8) panel.style.top = `${Math.max(8, rect.top - panel.offsetHeight - 6)}px`;
  }}>⋯</button><div ref={menu} id={id} popover="auto" className="record-actions-menu" role="group" aria-label={label} onToggle={(event) => setOpen(event.newState === 'open')} onClick={(event) => { if (event.target.closest('button')) menu.current.hidePopover(); }}>{children}</div></div>;
}

export function Action({ action, children, ...props }) {
  const ctx = useContext(UI),
    [busy, setBusy] = useState(false);
  if (ctx.can && !ctx.can(actionPermission(props))) return null;
  delete props.permission;
  return (
    <button
      type="button"
      {...props}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      onClick={async (event) => {
        if (busy) return;
        setBusy(true);
        try {
          await action(event);
        } catch (error) {
          ctx.notify(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}
export function Empty({ children }) {
  return <p className="panel-empty">{children}</p>;
}
export function Notice() {
  const ctx = useContext(UI);
  return (
    ctx.notice && (
      <div
        className={`page-notice page-notice--${ctx.notice.type}`}
        role="status"
      >
        <span>{ctx.notice.text}</span>
        <button
          className="text-action"
          type="button"
          onClick={() => ctx.setNotice(null)}
        >
          Dispensar
        </button>
      </div>
    )
  );
}
export function DataTable({
  kind,
  rows,
  headings,
  row,
  empty = "Nenhum registro encontrado.",
}) {
  const [page, setPage] = useState(0),
    [size, setSize] = useState(10);
  const maximum = Math.max(0, Math.ceil(rows.length / size) - 1),
    current = Math.min(page, maximum);
  useEffect(() => {
    setPage(0);
  }, [rows.length]);
  const start = current * size;
  return (
    <>
      <div
        className="data-table-wrap"
        role="region"
        tabIndex={0}
        aria-label={kind}
      >
        <table className="data-table">
          <thead>
            <tr>
              {headings.map((item) => (
                <th scope="col" key={item}>
                  {item}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
                rows.slice(start, start + size).map((item) => {
                  const entry = row(item);
                  return React.cloneElement(entry, {}, React.Children.toArray(entry.props.children).map((cell, index) => React.isValidElement(cell) ? React.cloneElement(cell, { 'data-label': headings[index] }) : cell));
                })
            ) : (
              <tr>
                <td colSpan={headings.length} className="table-empty">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <label>
          Linhas por página{" "}
          <select
            aria-label="Linhas por página"
            value={size}
            onChange={(event) => {
              setSize(Number(event.target.value));
              setPage(0);
            }}
          >
            {[10, 25, 50].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span aria-live="polite">
          {rows.length ? start + 1 : 0}–{Math.min(start + size, rows.length)} de{" "}
          {rows.length}
        </span>
        <button
          type="button"
          aria-label="Página anterior"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Próxima página"
          disabled={current === maximum}
          onClick={() => setPage(current + 1)}
        >
          ›
        </button>
      </div>
    </>
  );
}
export function ResourceForm({ definition }) {
  const ctx = useContext(UI),
    [values, setValues] = useState(
      Object.fromEntries(
        definition.fields.map((field) => [field.name, field.value ?? ""]),
      ),
    );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="inline-editor resource-editor">
      <div className="editor-panel">
        <h2>{definition.title}</h2>
        <p className="editor-description">{definition.description}</p>
        <form
          className="profile-form"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const invalid = [...event.currentTarget.elements].find(
              (input) => input.willValidate && !input.validity.valid,
            );
            if (invalid) {
              setError(
                `${invalid.labels?.[0]?.textContent || "Campo"}: ${invalid.validationMessage}`,
              );
              invalid.focus();
              return;
            }
            setBusy(true);
            setError("");
            try {
              await definition.save(values);
              ctx.closeEditor();
            } catch (failure) {
              setError(failure.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {definition.fields.map((field) => {
            const id = "editor-" + field.name;
            const common = {
              id,
              name: field.name,
              value: values[field.name],
              required: field.required,
              maxLength: field.maxLength,
              min: field.min,
              step: field.step,
              placeholder: field.placeholder,
              pattern: field.pattern,
              onChange: (event) =>
                setValues((previous) => ({
                  ...previous,
                  [field.name]: event.target.value,
                })),
            };
            return (
              <div className="profile-field" key={field.name}>
                <label htmlFor={id}>{field.label}</label>
                {field.type === "textarea" ? (
                  <textarea {...common} rows={3} />
                ) : field.type === 'select' ? (
                  <select {...common}>{(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                ) : (
                  <input {...common} type={field.type || "text"} />
                )}
                {field.name === "color" && (
                  <div className="color-options">
                    {[
                      ["Verde", "#3ddc84"],
                      ["Azul", "#5c8df6"],
                      ["Roxo", "#8e5cf6"],
                      ["Amarelo", "#f2b84b"],
                      ["Vermelho", "#f07070"],
                      ["Rosa", "#ec4899"],
                      ["Cinza", "#94a3b8"],
                    ].map(([label, color]) => (
                      <button
                        key={color}
                        type="button"
                        className="color-option"
                        aria-pressed={values.color.toLowerCase() === color}
                        style={{ "--swatch": color }}
                        onClick={() =>
                          setValues((previous) => ({ ...previous, color }))
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <p className="profile-error" role="alert" hidden={!error}>
            {error}
          </p>
          <div className="confirm-actions">
            <button
              type="button"
              className="confirm-cancel"
              disabled={busy}
              onClick={ctx.closeEditor}
            >
              Cancelar
            </button>
            <button type="submit" className="profile-save" disabled={busy}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
export function Workspace() {
  const ctx = useContext(UI);
  const ref = useRef(null);
  useEffect(() => {
    if (ctx.editor)
      ref.current
        ?.querySelector("input:not([type=hidden]),textarea,select,button")
        ?.focus();
  }, [ctx.editor?.id]);
  return (
    <div ref={ref}>
      <Notice />
      {ctx.confirmation && (
        <div className="inline-editor" id="confirmModal">
          <div className="editor-panel editor-panel--sm">
            <h2 id="confirmTitle">{ctx.confirmation.title}</h2>
            <p>{ctx.confirmation.body}</p>
            <div className="confirm-actions">
              <button
                id="confirmCancel"
                type="button"
                className="confirm-cancel"
                onClick={() => ctx.answer(false)}
              >
                Cancelar
              </button>
              <button
                id="confirmOk"
                type="button"
                className="profile-save"
                onClick={() => ctx.answer(true)}
              >
                {ctx.confirmation.okText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {ctx.editor?.resource ? (
        <ResourceForm key={ctx.editor.id} definition={ctx.editor.resource} />
      ) : (
        ctx.editor &&
        ctx.layout.editors[ctx.editor.id] && (
          <TemplateNode
            key={ctx.editor.id}
            node={{
              ...ctx.layout.editors[ctx.editor.id],
              props: {
                ...ctx.layout.editors[ctx.editor.id].props,
                hidden: false,
              },
            }}
            editor
          />
        )
      )}
    </div>
  );
}
export function useSiteMotion(root) {
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    if (!root.current) return;
    const seen = new WeakSet(),
      animations = new Set();
    const selectors =
      ".metric-card,.campaign-card,.chip-card,.flow-card,.webhook-card,.kanban-card,.data-table tbody tr,.tag-settings-item,.inline-editor,.page-notice";
    const animate = (element, index = 0) => {
      if (
        preference.matches ||
        seen.has(element) ||
        element.hidden ||
        !element.getClientRects().length ||
        element.closest("[hidden]")
      )
        return;
      seen.add(element);
      const animation = element.animate(
        [
          { opacity: 1, translate: "0 6px" },
          { opacity: 1, translate: "0 0" },
        ],
        {
          duration: 300,
          delay: Math.min(index, 5) * 35,
          easing: "cubic-bezier(.2,.75,.25,1)",
        },
      );
      animations.add(animation);
      animation.finished
        .catch(() => {})
        .finally(() => animations.delete(animation));
    };
    [...root.current.querySelectorAll(selectors)].forEach(animate);
    const observer = new MutationObserver((records) => {
      let index = 0;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(selectors)) animate(node, index++);
          for (const item of node.querySelectorAll(selectors))
            animate(item, index++);
        }
      }
    });
    observer.observe(root.current, { childList: true, subtree: true });
    const cancel = () => {
      for (const animation of animations) animation.cancel();
      animations.clear();
    };
    preference.addEventListener("change", cancel);
    return () => {
      observer.disconnect();
      cancel();
      preference.removeEventListener("change", cancel);
    };
  }, []);
}
