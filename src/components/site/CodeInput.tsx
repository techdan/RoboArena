"use client";

import { useState } from "react";

const CODE_LENGTH = 6;

/** Keep letters and digits only, uppercased, so pasted "abc-234" becomes "ABC234". */
export const normalizeRoomCode = (value: string): string =>
  value
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, CODE_LENGTH);

/**
 * Six scoreboard cells over one real text input, so typing, paste, autofill
 * and screen readers all work on a single ordinary field.
 */
export function CodeInput({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (code: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const caret = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <div className="site-code-input">
      <span className="site-code" aria-hidden="true">
        {Array.from({ length: CODE_LENGTH }, (_, index) => (
          <span
            key={index}
            className="site-code-cell"
            data-empty={value[index] === undefined ? "true" : "false"}
            data-caret={focused && index === caret ? "true" : "false"}
          >
            {value[index] ?? "·"}
          </span>
        ))}
      </span>
      <input
        id={id}
        name="room-code"
        value={value}
        onChange={(event) => onChange(normalizeRoomCode(event.currentTarget.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={CODE_LENGTH + 4}
        required
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}
