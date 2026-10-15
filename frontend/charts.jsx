import React, { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatedNumber } from './motion';

const number = value => Number(value || 0).toLocaleString('pt-BR');
const dateLabel = date => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const fullDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function DetailContent({ title, items, footer }) {
  return <><strong className="chart-detail-title">{title}</strong><dl>{items.map(item => <div key={item.label}><dt>{item.color && <i style={{ background: item.color }}/>} {item.label}</dt><dd>{item.value}</dd></div>)}</dl>{footer && <p className="chart-detail-footer">{footer}</p>}</>;
}

function FloatingDetail({ anchor, id, ...content }) {
  const ref = useRef(null), [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    const rect = ref.current.getBoundingClientRect();
    setPosition({
      left: clamp(anchor.x - rect.width / 2, 12, innerWidth - rect.width - 12),
      top: anchor.y + 12 + rect.height <= innerHeight - 12 ? anchor.y + 12 : Math.max(12, anchor.top - rect.height - 12),
    });
  }, [anchor, content.title]);
  return createPortal(<div ref={ref} id={id} role="tooltip" className="chart-detail chart-detail--floating" style={position}><DetailContent {...content}/></div>, document.body);
}

// Adds inspectable details to an existing element without changing its click action.
export function ChartDetail({ children, ...content }) {
  const id = useId(), [anchor, setAnchor] = useState(null);
  const trigger = useRef(null), visible = useRef(false);
  const show = event => {
    visible.current = true;
    window.dispatchEvent(new CustomEvent('chart:detail', { detail: id }));
    trigger.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.bottom, top: rect.top });
  };
  const hide = () => { visible.current = false; setAnchor(null); };
  useEffect(() => {
    if (!anchor) return;
    let frame;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!visible.current) return;
        const rect = trigger.current?.getBoundingClientRect();
        if (!rect || rect.bottom < 0 || rect.top > innerHeight) hide();
        else setAnchor({ x: rect.left + rect.width / 2, y: rect.bottom, top: rect.top });
      });
    };
    const outside = event => { if (!trigger.current?.contains(event.target)) hide(); };
    const another = event => { if (event.detail !== id) hide(); };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('chart:detail', another);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('chart:detail', another); };
  }, [Boolean(anchor)]);
  const combine = (name, action) => event => { children.props[name]?.(event); action(event); };
  return <>{cloneElement(children, {
    'aria-describedby': anchor ? id : children.props['aria-describedby'],
    onPointerEnter: combine('onPointerEnter', show),
    onPointerLeave: combine('onPointerLeave', event => { if (event.pointerType !== 'touch') hide(); }),
    onPointerDown: combine('onPointerDown', event => { if (event.pointerType === 'touch') show(event); }),
    onFocus: combine('onFocus', show), onBlur: combine('onBlur', hide),
    onKeyDown: combine('onKeyDown', event => { if (event.key === 'Escape') hide(); }),
  })}{anchor && <FloatingDetail id={id} anchor={anchor} {...content}/>}</>;
}

export function DailyChart({ rows, type }) {
  const gradient = useId().replace(/:/g, ''), detailId = useId(), instructionsId = useId();
  const host = useRef(null), drag = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 255 });
  const [viewport, setViewport] = useState({ start: 0, count: rows.length });
  const [active, setActive] = useState(null), [selection, setSelection] = useState(null), [dragging, setDragging] = useState(false);
  const count = clamp(viewport.count, Math.min(3, rows.length), rows.length);
  const start = clamp(viewport.start, 0, rows.length - count);
  const visible = rows.slice(start, start + count), zoomed = count < rows.length;
  const plotWidth = size.width - 60, baseline = size.height - 40;
  const maximum = Math.ceil(Math.max(1, ...visible.flatMap(row => [row.received, row.sent])) / 4) * 4;
  const x = index => type === 'bars' ? 42 + (index + .5) * plotWidth / count : 42 + index * plotWidth / Math.max(1, count - 1);
  const y = value => baseline - value / maximum * (size.height - 65);
  const path = field => visible.map((row, index) => `${index ? 'L' : 'M'}${x(index)},${y(row[field])}`).join(' ');
  const selected = active !== null && active >= start && active < start + count ? rows[active] : null;
  const selectedX = selected ? x(active - start) : 0;
  const total = selected ? selected.received + selected.sent : 0;
  const previous = active > 0 ? rows[active - 1].received + rows[active - 1].sent : null;
  const comparison = previous === null ? 'Primeiro dia do período selecionado.' : previous === 0
    ? total ? 'O dia anterior não teve mensagens.' : 'Sem mensagens neste dia e no anterior.'
    : `${total > previous ? '+' : ''}${number(Math.round((total - previous) / previous * 100))}% em relação ao dia anterior (${number(previous)} mensagens).`;
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(250, entry.contentRect.width), height: entry.contentRect.height }));
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const outside = event => {
      if (!host.current?.closest('.interactive-chart').contains(event.target)) setActive(null);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches || document.hidden) return;
    const animations = [];
    host.current.querySelectorAll('.analytics-series').forEach(series => {
      if (type === 'bars') series.querySelectorAll('rect').forEach((bar, index) => {
        animations.push(bar.animate([{ transform: 'scaleY(0)', opacity: .4 }, { transform: 'scaleY(1)', opacity: 1 }], {
          duration: 480, delay: Math.min(index, 12) * 16, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards',
        }));
      });
      else {
        animations.push(series.querySelector('[data-chart-line]').animate([
          { strokeDasharray: '1', strokeDashoffset: '1' }, { strokeDasharray: '1', strokeDashoffset: '0' },
        ], { duration: 720, easing: 'cubic-bezier(.22,1,.36,1)' }));
        animations.push(series.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 480 }));
      }
    });
    const finish = () => animations.forEach(animation => animation.cancel());
    preference.addEventListener('change', finish);
    return () => { finish(); preference.removeEventListener('change', finish); };
  }, [rows, type]);
  const point = event => {
    const rect = host.current.getBoundingClientRect();
    return clamp((event.clientX - rect.left) * size.width / rect.width, 42, size.width - 18);
  };
  const indexAt = coordinate => start + clamp(type === 'bars'
    ? Math.floor((coordinate - 42) / plotWidth * count)
    : Math.round((coordinate - 42) / plotWidth * (count - 1)), 0, count - 1);
  const reset = () => { setViewport({ start: 0, count: rows.length }); setSelection(null); setActive(null); };
  const zoom = direction => {
    const next = clamp(direction > 0 ? Math.ceil(count / 1.7) : Math.ceil(count * 1.7), Math.min(3, rows.length), rows.length);
    const center = selected ? active : start + (count - 1) / 2;
    setViewport({ start: clamp(Math.round(center - (next - 1) / 2), 0, rows.length - next), count: next });
  };
  const endDrag = (event, cancel = false) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (!cancel && !zoomed && current.moved && selection) {
      const first = Math.min(selection[0], selection[1]), last = Math.max(selection[0], selection[1]);
      if (last > first) {
        const nextCount = Math.min(rows.length, Math.max(3, last - first + 1));
        setViewport({ start: Math.min(first, rows.length - nextCount), count: nextCount });
      }
    }
    drag.current = null; setDragging(false); setSelection(null);
    if (host.current.hasPointerCapture(event.pointerId)) host.current.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = event => {
    if (event.key === 'Escape') { setActive(null); return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1); return; }
    if (event.key === '-') { event.preventDefault(); zoom(-1); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : active === null ? start : clamp(active + (event.key === 'ArrowRight' ? 1 : -1), 0, rows.length - 1);
    setActive(next);
    if (next < start || next >= start + count) setViewport({ start: clamp(next < start ? next : next - count + 1, 0, rows.length - count), count });
  };
  return <div className={`interactive-chart${dragging ? ' is-dragging' : ''}`}>
    <div className="chart-explorer-tools"><span id={instructionsId}>Passe o cursor ou toque para ver detalhes. {zoomed ? 'Arraste para navegar.' : 'Arraste para ampliar.'}</span><div role="group" aria-label="Zoom do gráfico"><button type="button" aria-label="Diminuir zoom do gráfico" disabled={!zoomed} onClick={() => zoom(-1)}>−</button><button type="button" aria-label="Ampliar gráfico" disabled={count <= Math.min(3, rows.length)} onClick={() => zoom(1)}>+</button><button type="button" disabled={!zoomed} onClick={reset}>Restaurar</button></div></div>
    <div className="chart-explorer-plot">
      <svg ref={host} className="analytics-daily-svg" viewBox={`0 0 ${size.width} ${size.height}`} role="group" tabIndex="0"
        aria-label={`Mensagens por dia em ${type === 'bars' ? 'barras' : type === 'area' ? 'área' : 'linhas'}. Use as setas para explorar os dias.`}
        aria-describedby={selected ? `${instructionsId} ${detailId}` : instructionsId}
        onKeyDown={onKeyDown} onFocus={() => setActive(value => value ?? start)}
        onBlur={() => { if (!drag.current) setActive(null); }} onDoubleClick={reset}
        onPointerLeave={event => { if (!drag.current && event.pointerType !== 'touch') setActive(null); }}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          const coordinate = point(event), index = indexAt(coordinate);
          setActive(index); setDragging(true);
          drag.current = { id: event.pointerId, x: coordinate, start, index, moved: false };
          host.current.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const coordinate = point(event), current = drag.current;
          if (current && current.id === event.pointerId) {
            const delta = coordinate - current.x;
            if (Math.abs(delta) > 6) current.moved = true;
            if (current.moved && zoomed) {
              setViewport({ start: clamp(current.start - Math.round(delta / plotWidth * (count - 1)), 0, rows.length - count), count });
              setActive(null);
            } else if (current.moved) setSelection([current.index, indexAt(coordinate)]);
          } else if (event.pointerType !== 'touch') setActive(indexAt(coordinate));
        }}
        onPointerUp={event => endDrag(event)} onPointerCancel={event => endDrag(event, true)}
        onLostPointerCapture={event => endDrag(event, true)}>
        <defs>{['received', 'sent'].map(field => <linearGradient key={field} id={`${gradient}-${field}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={field === 'received' ? 'var(--analytics-green)' : 'var(--analytics-purple)'} stopOpacity=".25"/><stop offset="1" stopColor={field === 'received' ? 'var(--analytics-green)' : 'var(--analytics-purple)'} stopOpacity=".02"/></linearGradient>)}</defs>
        {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}><line x1="42" x2={size.width - 18} y1={y(maximum * fraction)} y2={y(maximum * fraction)} className="analytics-grid-line"/><text x="30" y={y(maximum * fraction) + 4} textAnchor="end">{number(maximum * fraction)}</text></g>)}
        {selected && <rect className="chart-active-band" x={clamp(selectedX - plotWidth / count / 2, 42, size.width - 18)} y="20" width={Math.min(plotWidth / count, size.width - 18 - Math.max(42, selectedX - plotWidth / count / 2))} height={baseline - 20} rx="4"/>}
        {['received', 'sent'].map(field => <g key={field} className={`analytics-series ${field}`}>
          {type === 'area' && <path d={`${path(field)} L${x(count - 1)},${baseline} L${x(0)},${baseline} Z`} fill={`url(#${gradient}-${field})`}/>}
          {type !== 'bars' && <path data-chart-line="" pathLength="1" d={path(field)} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
          {visible.map((row, index) => type === 'bars'
            ? <rect key={row.date} className={active === start + index ? 'is-active' : ''} x={42 + index * plotWidth / count + (field === 'sent' ? plotWidth / count / 2 : 0)} y={y(row[field])} width={Math.max(1, plotWidth / count / 2 - 2)} height={baseline - y(row[field])} rx="3" fill="currentColor"/>
            : <circle key={row.date} className={active === start + index ? 'is-active' : ''} cx={x(index)} cy={y(row[field])} r={active === start + index ? 6 : 3.5} fill="var(--surface)" stroke="currentColor" strokeWidth="2"/>)}
        </g>)}
        {selected && <line className="chart-crosshair" x1={selectedX} x2={selectedX} y1="20" y2={baseline}/>}
        {selection && <rect className="chart-brush" x={Math.min(x(selection[0] - start), x(selection[1] - start))} y="20" width={Math.abs(x(selection[0] - start) - x(selection[1] - start))} height={baseline - 20} rx="4"/>}
        {visible.map((row, index) => index % Math.ceil(count / Math.max(2, Math.floor(plotWidth / 75))) === 0 && <text key={row.date} x={x(index)} y={size.height - 15} textAnchor="middle">{dateLabel(row.date)}</text>)}
      </svg>
      {selected && !dragging && <div id={detailId} role="tooltip" className="chart-detail chart-detail--daily" style={{ left: clamp(selectedX > size.width / 2 ? selectedX - 250 : selectedX + 14, 6, size.width - 246) }}>
        <DetailContent title={fullDate(selected.date)} items={[
          { label: 'Recebidas', value: number(selected.received), color: 'var(--analytics-green)' },
          { label: 'Enviadas', value: number(selected.sent), color: 'var(--analytics-purple)' },
          { label: 'Total do dia', value: `${number(total)} mensagens` },
          { label: 'Participação no período', value: `${number(Math.round(total / Math.max(1, rows.reduce((sum, row) => sum + row.received + row.sent, 0)) * 100))}%` },
        ]} footer={comparison}/>
      </div>}
    </div>
    {zoomed && <label className="chart-pan-control"><span>{dateLabel(visible[0].date)} — {dateLabel(visible.at(-1).date)} · {count} de {rows.length} dias</span><input type="range" min="0" max={rows.length - count} value={start} aria-label="Navegar pelo período do gráfico" onChange={event => { setViewport({ start: Number(event.target.value), count }); setActive(null); }}/></label>}
    <span className="chart-screenreader" role="status" aria-live="polite">{selected ? `${fullDate(selected.date)}: ${number(selected.received)} recebidas, ${number(selected.sent)} enviadas, ${number(total)} no total. ${comparison}` : ''}</span>
  </div>;
}

export function AttendanceChart({ counts }) {
  const [active, setActive] = useState(null);
  const total = counts.reduce((sum, row) => sum + row.value, 0);
  let cursor = 0;
  const segments = counts.map((row, index) => {
    const start = cursor; cursor += total ? row.value / total * 100 : 0;
    const color = active === null || active === index ? row.color : `color-mix(in srgb, ${row.color} 30%, var(--surface))`;
    return `${color} ${start}% ${cursor}%`;
  });
  return <><div className="analytics-donut" role="img" aria-label={counts.map(row => `${row.name}: ${row.value}`).join(', ')}
    onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect(), dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
      if (Math.hypot(dx, dy) < rect.width / 2 - 22 || !total) { setActive(null); return; }
      const fraction = ((Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360) / 360;
      let sum = 0;
      setActive(counts.findIndex(row => { sum += row.value / total; return fraction < sum; }));
    }} onPointerLeave={() => setActive(null)}
    style={{ background: total ? `conic-gradient(${segments.join(',')})` : 'var(--surface-3)' }}>
    <div><strong>{active !== null && active >= 0 ? number(counts[active].value) : <AnimatedNumber value={total}/>}</strong><span>{active !== null && active >= 0 ? counts[active].name : 'Total de conversas'}</span>{active !== null && active >= 0 && <small>{total ? Math.round(counts[active].value / total * 100) : 0}% do total</small>}</div>
  </div><div className="analytics-status-legend">{counts.map((row, index) => <ChartDetail key={row.name} title={row.name} items={[{ label: 'Conversas', value: number(row.value), color: row.color }, { label: 'Participação', value: `${total ? number(Math.round(row.value / total * 100)) : 0}%` }]} footer="Situação atual dos atendimentos.">
    <button type="button" className="analytics-status-item" aria-pressed={active === index} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)} onKeyDown={event => { if (event.key === 'Escape') setActive(null); }}><span><i style={{ background: row.color }}/>{row.name}</span><strong>{number(row.value)} <small>{total ? Math.round(row.value / total * 100) : 0}%</small></strong></button>
  </ChartDetail>)}</div></>;
}
