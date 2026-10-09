import React, { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Application } from "./app";
import { captureLayout } from "./template";

export function Router({ layout, page }) {
  const initial = {
    layout,
    page,
    title: document.title,
    url: location.pathname + location.search,
  };
  const [route, setRoute] = useState(initial),
    request = useRef(null),
    saved = useRef(new Map([[initial.url, initial]]));
  const current = useRef(route);
  current.current = route;
  async function navigate(url, { pop = false } = {}) {
    if (!pop && url === location.pathname + location.search) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      let next = saved.current.get(url);
      if (!next) {
        const response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.redirected && new URL(response.url).pathname === "/") {
          location.replace("/?redirect=" + encodeURIComponent(url));
          return;
        }
        if (!response.ok)
          throw Error("Não foi possível abrir a página. Tente novamente.");
        const parsed = new DOMParser().parseFromString(
          await response.text(),
          "text/html",
        );
        if (!parsed.body.dataset.page) throw Error("Página inválida.");
        const styles = [...parsed.querySelectorAll("link[rel=stylesheet]")].map(
          (link) => link.getAttribute("href"),
        );
        await Promise.all(
          styles
            .filter(
              (href) => href && !document.querySelector(`link[href="${href}"]`),
            )
            .map(
              (href) =>
                new Promise((resolve) => {
                  const link = document.createElement("link");
                  link.rel = "stylesheet";
                  link.href = href;
                  link.onload = link.onerror = resolve;
                  document.head.append(link);
                }),
            ),
        );
        next = {
          layout: captureLayout(parsed.body),
          page: parsed.body.dataset.page,
          title: parsed.title,
          url,
        };
        saved.current.set(url, next);
      }
      if (controller.signal.aborted) return;
      if (!pop) history.pushState({ page: next.page }, "", url);
      // The shell and socket remain mounted. Only the requested page changes.
      flushSync(() => setRoute(next));
    } catch (error) {
      if (error.name === "AbortError") return;
      window.dispatchEvent(
        new CustomEvent("app:navigation-error", { detail: error.message }),
      );
      if (pop) {
        history.replaceState(
          {},
          "",
          current.current.url || "/" + current.current.page,
        );
      }
    }
  }
  useLayoutEffect(() => {
    document.body.dataset.page = route.page;
    document.title = route.title;
  }, [route]);
  useLayoutEffect(() => {
    const pop = () =>
      navigate(location.pathname + location.search, { pop: true });
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
    };
  }, []);
  return (
    <Application
      layout={route.layout}
      page={route.page}
      title={route.title}
      onNavigate={navigate}
    />
  );
}
