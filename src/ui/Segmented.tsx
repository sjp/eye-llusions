import { useId } from "preact/hooks";

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  legend: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** A row of mutually exclusive choices, built from native radio buttons. */
export function Segmented<T extends string>({ legend, options, value, onChange }: Props<T>) {
  const name = useId();
  return (
    <fieldset class="segmented">
      <legend>{legend}</legend>
      <div class="segmented-options">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
