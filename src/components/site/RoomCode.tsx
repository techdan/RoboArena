/** A room code drawn as lit scoreboard cells; read aloud one character at a time. */
export function RoomCode({
  code,
  size = "md",
}: {
  readonly code: string;
  readonly size?: "sm" | "md";
}) {
  return (
    <span
      className="site-code"
      data-size={size}
      role="img"
      aria-label={`Room code ${code.split("").join(" ")}`}
    >
      {code.split("").map((character, index) => (
        <span key={index} className="site-code-cell" aria-hidden="true">
          {character}
        </span>
      ))}
    </span>
  );
}
