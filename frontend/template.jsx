import React, { createContext, useContext } from "react";

export const UI = createContext(null);
const names = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  autocomplete: "autoComplete",
  autocapitalize: "autoCapitalize",
  inputmode: "inputMode",
  spellcheck: "spellCheck",
  colspan: "colSpan",
  rowspan: "rowSpan",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "stop-color": "stopColor",
  "stroke-dasharray": "strokeDasharray",
};
const boolean = new Set([
  "hidden",
  "required",
  "disabled",
  "multiple",
  "readOnly",
  "autoFocus",
  "controls",
  "loop",
  "muted",
  "open",
]);

function propsFor(el) {
  const props = {};
  for (const attr of el.attributes) {
    if (
      /^on/i.test(attr.name) ||
      ["style", "checked", "selected"].includes(attr.name) ||
      (attr.name === "value" &&
        el.tagName !== "OPTION" &&
        el.type !== "checkbox")
    )
      continue;
    const name = names[attr.name] || attr.name;
    props[name] = boolean.has(name) ? true : attr.value;
  }
  if (el.hasAttribute("style")) {
    props.style = {};
    for (const key of el.style) {
      const name = key.startsWith("--")
        ? key
        : key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      props.style[name] = el.style.getPropertyValue(key);
    }
  }
  return props;
}

function serialize(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE || node.tagName === "SCRIPT")
    return null;
  const result = {
    tag: node.localName,
    props: propsFor(node),
    children: [...node.childNodes]
      .map(serialize)
      .filter((item) => item !== null),
  };
  if (node.matches("main.chat,.app"))
    result.key = node.matches(".app") ? "app-shell" : "main-content";
  if (["input", "select", "textarea"].includes(result.tag)) {
    result.initial = node.type === "checkbox" ? node.checked : node.value;
    result.field = node.id || `${node.name}:${node.value}`;
  }
  return result;
}

export function captureLayout(host) {
  const clone = host.cloneNode(true);
  for (const [target, group] of [
    ["chipsPageHost", "chipsGroup"],
    ["tagsPageHost", "tagsGroup"],
    ["departmentsPageHost", "deptsGroup"],
    ["departmentsPageHost", "departmentsGroup"],
  ]) {
    const destination = clone.querySelector("#" + target);
    const content = clone.querySelector("#" + group);
    if (destination && content) destination.append(content);
  }
  const editors = {};
  const fields = {};
  clone.querySelectorAll("input,select,textarea").forEach((el) => {
    if (el.id || el.name)
      fields[el.id || `${el.name}:${el.value}`] =
        el.type === "checkbox" ? el.checked : el.value;
  });
  clone.querySelectorAll(".inline-editor").forEach((el) => {
    editors[el.id] = serialize(el);
    el.remove();
  });
  clone.querySelectorAll("[data-page-view]").forEach((view) => {
    const workspace = document.createElement("div");
    workspace.className = "page-workspace";
    workspace.id = "pageWorkspace";
    const heading = view.querySelector(".page-heading,.chat-header");
    if (heading) heading.after(workspace);
    else view.prepend(workspace);
  });
  return {
    nodes: [...clone.childNodes].map(serialize).filter((item) => item !== null),
    editors,
    fields,
  };
}

export function TemplateNode({ node, editor = false }) {
  const ctx = useContext(UI);
  if (typeof node === "string") return node;
  if (!node) return null;
  const replacement = ctx.replace?.(node);
  if (replacement !== undefined) return replacement;
  const { tag, props: original, children, field } = node;
  const id = original.id;
  const props = { ...original, ...ctx.attributes(id, node) };
  let content = ctx.slot(id, node);
  if (content === undefined)
    content = children.map((child, index) => (
      <TemplateNode
        key={
          (typeof child === "object" && (child?.props?.id || child?.key)) ||
          index
        }
        node={child}
        editor={editor}
      />
    ));
  if (ctx.actions[id] && props.type !== "submit")
    props.onClick = ctx.actions[id];
  if (tag === "form") {
    props.noValidate = true;
    props.onSubmit = (event) => {
      event.preventDefault();
      if (ctx.submits[id]) ctx.submits[id](event);
    };
  }
  if (field) {
    if (tag === "input" && props.type === "file") {
      props.key = ctx.fileKeys?.[id] || 0;
      props.onChange = (event) =>
        ctx.setFile(id, event.target.files[0] || null);
    } else if (props.type === "checkbox") {
      props.checked = !!ctx.fields[field];
      props.onChange = (event) => ctx.setField(field, event.target.checked);
    } else {
      props.value = ctx.fields[field] ?? node.initial ?? "";
      props.onChange = (event) => ctx.setField(field, event.target.value);
    }
    if (tag === "input" || tag === "textarea") content = undefined;
    if (id === "composerInput") props.onKeyDown = ctx.composerKey;
    if (id === "newChatInput")
      props.onKeyDown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          ctx.actions.newChatBtn();
        }
      };
  }
  if (props.contenteditable) {
    props.contentEditable = props.contenteditable;
    delete props.contenteditable;
    props.suppressContentEditableWarning = true;
  }
  if (
    tag === "input" ||
    ["img", "br", "hr", "path", "circle", "rect", "line", "polyline"].includes(
      tag,
    )
  ) {
    if (["input", "img", "br", "hr"].includes(tag))
      return React.createElement(tag, props);
  }
  if (props.className?.split(" ").includes("app"))
    props.className += ctx.collapsed ? " app--collapsed" : "";
  if (props["data-theme"]) {
    props.onClick = () => ctx.setTheme(props["data-theme"]);
    props.className = `theme-btn${ctx.theme === props["data-theme"] ? " is-active" : ""}`;
    props["aria-pressed"] = ctx.theme === props["data-theme"];
  }
  if (props["data-tab"]) {
    const active = ctx.tab === props["data-tab"];
    props.className = "list-tab" + (active ? " is-active" : "");
    props.onClick = () => ctx.setTab(props["data-tab"]);
  }
  if (props["data-filter"]) {
    props.className =
      "filter-btn" + (ctx.filter === props["data-filter"] ? " is-active" : "");
    props.onClick = () => ctx.setFilter(props["data-filter"]);
  }
  if (props["data-alpha"]) {
    props.onClick = () => ctx.setAlpha(props["data-alpha"]);
    props.className =
      "alpha-btn" + (ctx.alpha === props["data-alpha"] ? " is-active" : "");
  }
  if (props["data-page-link"] && tag !== "a")
    props.onClick = () => ctx.navigate(props["data-page-link"]);
  if (tag === "a" && (props["data-page"] || props["data-page-link"]))
    props.onClick = (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      ctx.navigate(props["data-page"] || props["data-page-link"]);
    };
  if (props["data-chart-days"]) {
    props.onClick = () => ctx.setChartDays(Number(props["data-chart-days"]));
    props.className =
      ctx.chartDays === Number(props["data-chart-days"]) ? "is-active" : "";
  }
  return React.createElement(tag, props, content);
}

export function Template({ nodes }) {
  return nodes.map((node, index) => (
    <TemplateNode node={node} key={node?.props?.id || node?.key || index} />
  ));
}
