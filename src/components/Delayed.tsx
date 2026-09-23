import { useEffect, useState, type ReactNode } from "react";
import { SLOW_MS } from "../hooks/useQuietLoad";

// Shows its children only once the wait has become long enough to be worth
// mentioning. A screen that arrives in 200 ms says nothing at all.
export function Delayed({ ms = SLOW_MS, children }: { ms?: number; children: ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShow(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return show ? <>{children}</> : null;
}
