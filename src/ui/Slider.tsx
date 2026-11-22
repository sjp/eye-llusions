import { useId } from "preact/hooks";

type Props = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  /** Called on every movement of the thumb. */
  onInput: (value: number) => void;
  /** Called when the user lets go or finishes a keyboard step. */
  onCommit: () => void;
};

export function Slider({ label, min, max, step, value, format, onInput, onCommit }: Props) {
  const id = useId();
  return (
    <div class="slider">
      <label for={id}>{label}</label>
      <output for={id}>{format(value)}</output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onInput={(event) => {
          onInput(event.currentTarget.valueAsNumber);
        }}
        onChange={onCommit}
      />
    </div>
  );
}
