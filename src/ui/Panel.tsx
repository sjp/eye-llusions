import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

/** A titled section of the control sheet. */
export function Panel({ title, children }: { title: string; children: ComponentChildren }) {
  const id = useId();
  return (
    <section class="panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}
