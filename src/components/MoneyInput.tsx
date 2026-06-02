'use client';

// Text input that shows the amount with es-AR thousand separators
// (e.g. 4.500.000) while storing a plain integer. Avoids miscounting
// zeros on the large ARS amounts common in Argentina.
export function MoneyInput({
  value,
  onChange,
  placeholder,
  className,
  style,
  autoFocus,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  const display = value > 0 ? value.toLocaleString('es-AR') : '';
  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      className={className}
      style={style}
      autoFocus={autoFocus}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '');
        onChange(digits ? parseInt(digits, 10) : 0);
      }}
    />
  );
}
