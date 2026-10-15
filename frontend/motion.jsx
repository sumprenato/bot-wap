import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const formats = {
  number: new Intl.NumberFormat('pt-BR'),
  money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
  percent: new Intl.NumberFormat('pt-BR'),
};

// Only the visual span changes per frame; assistive technology gets the final value.
export function AnimatedNumber({ value, format = 'number' }) {
  const element = useRef(null), displayed = useRef(0);
  const target = Number(value) || 0;
  const formatter = formats[format] || formats.number;
  const print = amount => formatter.format(amount) + (format === 'percent' ? '%' : '');
  const label = print(target);
  useLayoutEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const start = displayed.current;
    let frame, started;
    const finish = () => {
      cancelAnimationFrame(frame);
      displayed.current = target;
      if (element.current) element.current.textContent = print(target);
    };
    const tick = time => {
      started ??= time;
      const progress = Math.min(1, (time - started) / 640);
      const amount = start + (target - start) * (1 - Math.pow(1 - progress, 3));
      displayed.current = amount;
      if (element.current) element.current.textContent = print(format === 'number' ? Math.round(amount) : amount);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else finish();
    };
    if (preference.matches || document.hidden || start === target) finish();
    else {
      element.current.textContent = print(format === 'number' ? Math.round(start) : start);
      frame = requestAnimationFrame(tick);
    }
    const onVisibility = () => { if (document.hidden) finish(); };
    preference.addEventListener('change', finish);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      preference.removeEventListener('change', finish);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [target, format]);
  return <span className="animated-number" aria-label={label}><span ref={element} aria-hidden="true">{label}</span></span>;
}

const controls =
  'button, a[href], [role="button"], .convo-item, .contact-item, #dashCardOpen, #dashCardFinalized';

function Ripple({ ripple, onRemove }) {
  useEffect(() => {
    // Also clean up when an animation is interrupted or the tab is hidden.
    const timer = window.setTimeout(() => onRemove(ripple.id), 600);
    return () => window.clearTimeout(timer);
  }, [ripple.id, onRemove]);

  return (
    <span className="motion-clip" style={ripple.bounds}>
      <span
        className="motion-ripple"
        onAnimationEnd={() => onRemove(ripple.id)}
        style={{
          left: ripple.x,
          top: ripple.y,
          width: ripple.size,
          height: ripple.size,
        }}
      />
    </span>
  );
}

export function InteractionEffects() {
  const [ripples, setRipples] = useState([]);
  const remove = useCallback(
    (id) => setRipples((items) => items.filter((item) => item.id !== id)),
    [],
  );

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let sequence = 0;
    const clear = () => setRipples((items) => (items.length ? [] : items));
    const activate = (event) => {
      if (preference.matches || !(event.target instanceof Element)) return;
      if (
        event.type === "pointerdown" &&
        (event.button !== 0 || !event.isPrimary)
      )
        return;
      // Pointer interactions start immediately; detail=0 also covers keyboard activation.
      if (event.type === "click" && event.detail !== 0) return;
      const control = event.target.closest(controls);
      if (
        !control ||
        control.closest('[inert], [aria-disabled="true"]') ||
        control.matches(":disabled")
      )
        return;
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x =
        event.type === "click" ? rect.width / 2 : event.clientX - rect.left;
      const y =
        event.type === "click" ? rect.height / 2 : event.clientY - rect.top;
      const size =
        2 *
        Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
      const ripple = {
        id: ++sequence,
        x,
        y,
        size,
        bounds: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          borderRadius: getComputedStyle(control).borderRadius,
          color: getComputedStyle(control).color,
        },
      };
      setRipples((items) => [...items.slice(-7), ripple]);
    };
    document.addEventListener("pointerdown", activate, true);
    document.addEventListener("click", activate, true);
    document.addEventListener("scroll", clear, true);
    document.addEventListener("visibilitychange", clear);
    window.addEventListener("resize", clear);
    window.addEventListener("blur", clear);
    preference.addEventListener("change", clear);
    return () => {
      document.removeEventListener("pointerdown", activate, true);
      document.removeEventListener("click", activate, true);
      document.removeEventListener("scroll", clear, true);
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("resize", clear);
      window.removeEventListener("blur", clear);
      preference.removeEventListener("change", clear);
    };
  }, []);

  return ripples.map((ripple) => (
    <Ripple key={ripple.id} ripple={ripple} onRemove={remove} />
  ));
}
