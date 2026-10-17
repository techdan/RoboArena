import { PLAYER_COLORS, type PlayerColor } from "../../lib/setup/validate";

const COLOR_NAMES: Readonly<Record<PlayerColor, string>> = {
  red: "Red",
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
};

/** Named team-colour choices; the dot alone never carries the meaning. */
export function TeamColorPicker({
  value,
  onChange,
  disabled = false,
  legend = "Team colour",
}: {
  readonly value: PlayerColor;
  readonly onChange: (color: PlayerColor) => void;
  readonly disabled?: boolean;
  readonly legend?: string;
}) {
  return (
    <fieldset className="site-fieldset" disabled={disabled}>
      <legend className="site-label">{legend}</legend>
      <div className="site-team-picker">
        {PLAYER_COLORS.map((choice) => (
          <button
            key={choice}
            type="button"
            className="site-team-option"
            data-team={choice}
            aria-pressed={value === choice}
            onClick={() => onChange(choice)}
          >
            {COLOR_NAMES[choice]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
