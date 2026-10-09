import React, { useContext, useEffect, useRef, useState } from "react";
import { UI } from "./template";
import { api } from "./api";

const photos = new Map(),
  pending = new Map(),
  listeners = new Set(),
  queue = [];
let activeRequests = 0;
function pump() {
  while (activeRequests < 4 && queue.length) {
    const task = queue.shift();
    activeRequests++;
    api("/api/whatsapp/profile/" + encodeURIComponent(task.number) + (task.chipId ? '?chipId=' + encodeURIComponent(task.chipId) : ''))
      .then((result) => {
        const url = result.profilePic || "";
        if (result.connected)
          photos.set(task.key, {
            url,
            expires: Date.now() + (url ? 60 * 60 * 1000 : 5 * 60 * 1000),
          });
        task.resolve(url);
      })
      .catch(() => task.resolve(""))
      .finally(() => {
        activeRequests--;
        pending.delete(task.key);
        pump();
      });
  }
}
function photo(key, number, chipId) {
  const cached = photos.get(key);
  if (cached?.expires > Date.now()) return Promise.resolve(cached.url);
  if (pending.has(key)) return pending.get(key);
  const request = new Promise((resolve) => {
    queue.push({ key, number, chipId, resolve });
  });
  pending.set(key, request);
  pump();
  return request;
}
export function invalidatePhotos(number) {
  for (const key of photos.keys())
    if (!number || key.endsWith(":" + number) || key.endsWith(":me"))
      photos.delete(key);
  for (const listener of listeners) listener(number);
}
export function Avatar({
  number,
  label = "Contato",
  className = "",
  url = "",
}) {
  const ctx = useContext(UI),
    host = useRef(null),
    [revision, setRevision] = useState(0);
  const scope = `${ctx.data.state.user?.username || ""}:${ctx.data.state.chipId || ""}:${ctx.data.state.status?.admin || ""}`;
  const key = `${scope}:${number || ""}`;
  const [picture, setPicture] = useState({ key: "", url: "" }),
    [failed, setFailed] = useState("");
  useEffect(() => {
    const changed = (value) => {
      if (!value || value === number || number === "me")
        setRevision((value) => value + 1);
    };
    listeners.add(changed);
    return () => listeners.delete(changed);
  }, [number]);
  useEffect(() => {
    let alive = true,
      observer;
    if (!number || !ctx.data.state.status?.connected || url) return;
    const load = () =>
      photo(key, number, ctx.data.state.chipId).then((value) => {
        if (alive) {
          setPicture({ key, url: value });
          setFailed("");
        }
      });
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "80px" },
    );
    if (host.current) observer.observe(host.current);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [key, number, ctx.data.state.status?.connected, url, revision]);
  const source =
    url || (picture.key === key ? picture.url : photos.get(key)?.url || "");
  return (
    <span ref={host} className={`whatsapp-avatar ${className}`.trim()}>
      {source && failed !== source ? (
        <img
          src={source}
          alt={"Foto de WhatsApp de " + label}
          onError={() => setFailed(source)}
        />
      ) : (
        label.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
