import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Router } from "./router";
import { LoginCard, LoginThemeSwitch } from "./login";
import { captureLayout, Template, UI } from "./template";
import { InteractionEffects } from "./motion";

const page = document.body.dataset.page;
// Keep the server's route-specific first frame, then let one React root own the site.
const layout = captureLayout(document.body);
const host = document.createElement("div");
host.id = "site-root";
document.body.replaceChildren(host);
document.documentElement.dataset.framework = "react";
const root = createRoot(host);
if (page) flushSync(() => root.render(<Router layout={layout} page={page} />));
else {
  const context = {
    attributes: () => ({}),
    replace: (node) =>
      node.props.className?.split(" ").includes("login-card") ? (
        <LoginCard />
      ) : node.props.id === 'loginThemeSwitch' ? <LoginThemeSwitch /> : undefined,
    slot: () => undefined,
    actions: {},
    submits: {},
    fields: {},
    setField: () => {},
    setFile: () => {},
  };
  flushSync(() =>
    root.render(
      <UI.Provider value={context}>
        <Template nodes={layout.nodes} />
        <div id="interaction-effects" aria-hidden="true">
          <InteractionEffects />
        </div>
      </UI.Provider>,
    ),
  );
}
