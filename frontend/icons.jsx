import React from "react";

const paths = {
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="m3 3 18 18M10.6 5.1 12 5c7 0 10 7 10 7a18 18 0 0 1-3.3 4.3M6.2 6.2A19 19 0 0 0 2 12s3 7 10 7a12 12 0 0 0 5.1-1.1M10 10a3 3 0 0 0 4 4"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  arrowRight: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></>,
  moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>,
  conversation: <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2A8.5 8.5 0 0 1 21 11.5Z"/><path d="M7 10h9M7 14h5"/></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  arrowUpRight: <path d="M6 18 18 6M6 6h12v12"/>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/></>,
  pencil: <><path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5" /></>,
  doubleCheck: <><path d="m2 12 4 4L16 6M10 15l3 3L23 8" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  more: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
  contact: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5h4M17 10h4M18 15h3" /></>,
  tag: <><path d="M20 13 13 20 3 10V3h7Z" /><circle cx="7" cy="7" r="1" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  transfer: <><path d="M4 7h16m-5-5 5 5-5 5M20 17H4m5-5-5 5 5 5" /></>,
  block: <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  photo: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1" /><path d="m3 17 6-6 4 4 3-3 5 5" /></>,
  department: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3" /></>,
  paperclip: <path d="m21 11-9 9a6 6 0 0 1-8-8L13 3a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8" />,
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8 14a4 4 0 0 0 8 0M8 8h.01M16 8h.01" /></>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>,
  muted: <><path d="m11 4-6 5H2v6h3l6 5ZM16 9l5 6M21 9l-5 6" /></>,
};

export function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
